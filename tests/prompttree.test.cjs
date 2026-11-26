'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Script } = require('node:vm');
const root = path.resolve(__dirname, '..'), skill = path.join(root, 'skills/prompttree');
const W = require('../skills/prompttree/lib/workflow.cjs'), S = require('../skills/prompttree/lib/store.cjs');
const { diff, patch, validationCases, validationHistories } = require('../skills/prompttree/lib/report.cjs');
const { editSize } = require('../skills/prompttree/lib/edit-size.cjs');

const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function setup(t, change = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompttree-test-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  fs.copyFileSync(path.join(__dirname, 'fixtures/prompttree-evaluator.cjs'), path.join(dir, 'evaluate.cjs'));
  const base = { messages:[{ role:'system', content:'RULE firstonly {{text}}' }], output_schema:{ type:'object' } };
  const candidate = structuredClone(base); candidate.messages[0].content = 'RULE allrows {{text}}';
  write(path.join(dir, 'prompt.json'), base); write(path.join(dir, 'candidate.json'), candidate);
  write(path.join(dir, 'search.json'), [{ case_id:'SEARCH-1', input:['a','b'], expected:['a','b'] }]);
  write(path.join(dir, 'validation.json'), [{ case_id:'VALIDATION-1', input:['VALIDATION_ONLY_SECRET','c'], expected:['VALIDATION_ONLY_SECRET','c'] }]);
  const project = { schema_version:'prompttree-project-v1', project_id:'fixture', execution_kind:'mock', workspace:dir, prompt_entry:'prompt.json',
    policy:{ editable_paths:['/messages/0/content'], required_literals:{ '/messages/0/content':['RULE'] } },
    evaluate_argv:[process.execPath, 'evaluate.cjs','--candidate','{candidate_file}','--dataset','{dataset_file}','--request','{request_file}','--output','{result_file}',
      '--fault',change.fault || 'none'],
    protected_files:['evaluate.cjs'], runner_timeout_seconds:change.timeout || 10, target_calls_per_case_bound:change.bound || 0, call_bound_kind:'none',
    remote_effects:change.remote ?? false, env_required:[] };
  if (change.original) project.original_evaluate_argv = [...project.evaluate_argv];
  const task = { schema_version:'prompttree-task-v1', mode:'probe', objective:'Exercise a controlled integration fixture', primary_metric:'accuracy', metrics:['accuracy'],
    datasets:{ search:{ path:'search.json', expected_cases:1 }, validation:{ path:'validation.json', expected_cases:1 } },
    budget:{ max_attempts:30, max_evaluations:20, max_target_calls:100, max_wall_time_seconds:120 },
    allow_cache:true, rules:[{ id:'R1', version:'1', source:'test-spec' }], evidence:{ search_cases_visible:true, export_search_cases:false } };
  if (change.maxEvaluations) task.budget.max_evaluations = change.maxEvaluations;
  if (change.maxCalls !== undefined) task.budget.max_target_calls = change.maxCalls;
  if (change.mode) task.mode = change.mode;
  const projectFile = path.join(dir, 'project.json'), taskFile = path.join(dir, 'task.json'), run = path.join(dir, 'experiment');
  write(projectFile, project); write(taskFile, task);
  return { dir, project, task, projectFile, taskFile, run, base, candidate,
    candidateFile:path.join(dir, 'candidate.json'), prepare:() => W.prepare({ project:projectFile, task:taskFile, run }) };
}
async function baseline(f) {
  const first = await W.evaluate({ run:f.run, baseline:true, split:'search', requestId:'baseline-search' });
  await W.evaluate({ run:f.run, baseline:true, split:'validation', requestId:'baseline-validation' });
  return first;
}
function proposal(f, source) {
  const value = { parent_event_id:'E-000', evidence_refs:[source.run_id + '/SEARCH-1'],
    rule_refs:[{ id:'R1', version:'1', source:'test-spec' }], operator:'ENUMERATE', hypothesis:'Enumerating returns all fixture tokens',
    expected_effect:'Complete list', regression_risk:'Review extra tokens', secondary_source_ids:[] };
  const file = path.join(f.dir, 'proposal.json'); write(file, value); return { file, value };
}
function candidateInput(f, p, split = 'search', id = 'candidate-search') {
  return { run:f.run, candidate:f.candidateFile, proposal:p.file, split, requestId:id };
}
test('portable CLI completes Probe, reopens records and produces safe independent offline artifacts', async t => {
  const f = setup(t), copied = path.join(f.dir, 'copied-skill'); fs.cpSync(skill, copied, { recursive:true });
  f.project.prompt_sources = ['support/prompt.json', 'billing/prompt.json'];
  for (const file of f.project.prompt_sources) {
    fs.mkdirSync(path.join(f.dir, path.dirname(file)));
    write(path.join(f.dir, file), f.base);
  }
  f.project.baseline_accuracy_report = 'support/accuracy_report.json';
  write(path.join(f.dir, f.project.baseline_accuracy_report), { accuracy:0 });
  write(f.projectFile, f.project);
  const cli = path.join(copied, 'scripts/prompttree.cjs');
  const call = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args, '--run',f.run], { encoding:'utf8' }));
  call('prepare','--project',f.projectFile,'--task',f.taskFile);
  const source = call('evaluate','--baseline','--split','search','--request-id','baseline-search');
  call('evaluate','--baseline','--split','validation','--request-id','baseline-validation');
  const p = proposal(f, source);
  f.candidate.messages[0].content += ' </script><script>untrusted()</script>'; write(f.candidateFile, f.candidate);
  const c = call('evaluate','--candidate',f.candidateFile,'--proposal',p.file,'--split','search','--request-id','candidate-search');
  const v = call('evaluate','--candidate',f.candidateFile,'--proposal',p.file,'--split','validation','--request-id','candidate-validation');
  assert.equal(v.result.cases, undefined);
  assert.equal(call('prepare').phase, 'searching');
  const result = call('finalize','--version',c.version_id,'--reason','target_reached');
  const origin = result.manifest.baseline_source;
  assert.deepEqual(origin.prompt_sources.map(item => item.file), f.project.prompt_sources);
  assert.equal(origin.prompt_entry.file, f.project.prompt_entry);
  assert.equal(origin.accuracy_report.file, f.project.baseline_accuracy_report);
  assert.equal(origin.version_id, source.version_id);
  for (const item of [origin.prompt_entry, ...origin.prompt_sources, origin.accuracy_report]) {
    assert.equal(item.sha256, require('node:crypto').hash('sha256', fs.readFileSync(path.join(f.dir, item.file))));
  }
  assert.equal(result.manifest.comparison.baseline.value, 0);
  assert.equal(result.manifest.comparison.candidate.value, 1);
  assert.equal(result.manifest.test_status, 'not_tested'); assert.equal(result.manifest.release_decision, null);
  assert.equal(result.manifest.counts.derivations, 2); assert.equal(result.manifest.counts.evaluations, 4);
  const html = fs.readFileSync(result.report, 'utf8');
  const logo = fs.readFileSync(path.join(copied, 'assets/prompt-tree-mark.png'), 'base64');
  assert.ok(html.includes('src="data:image/png;base64,' + logo + '"'));
  assert.ok(!html.includes('</script><script>untrusted()'));
  assert.ok(!html.includes('VALIDATION_ONLY_SECRET'));
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(html));
  assert.ok(!/\.innerHTML\s*=/.test(html));
  const data = JSON.parse(html.match(/id="report-data">([\s\S]*?)<\/script>/)[1]);
  const english = fs.readFileSync(result.report_en, 'utf8');
  assert.match(english, /<html lang="en">/);
  assert.match(english, />Prompt comparison</);
  assert.match(html, />Prompt 对比</);
  assert.deepEqual(JSON.parse(english.match(/id="report-data">([\s\S]*?)<\/script>/)[1]), data);
  assert.doesNotThrow(() => new Script(english.match(/id="report-ui">([\s\S]*?)<\/script>/)[1]));
  assert.equal(data.validation_cases, undefined);
  assert.equal(data.validation_histories, undefined);
  assert.ok(data.nodes[1].prompt.includes('</script><script>untrusted()'));
  assert.doesNotThrow(() => new Script(html.match(/id="report-ui">([\s\S]*?)<\/script>/)[1]));
  const again = call('finalize');
  assert.equal(again.manifest.selected_run_id, result.manifest.selected_run_id);
  assert.throws(() => call('evaluate','--baseline','--split','search','--request-id','after-final'));
});
test('request replay, content reuse and independent repeats have different run accounting', async t => {
  const f = setup(t); await f.prepare(); const b = await baseline(f), p = proposal(f, b);
  const c = await W.evaluate(candidateInput(f, p));
  assert.equal((await W.evaluate(candidateInput(f, p))).idempotent, true);
  p.value.hypothesis = 'A distinct path to the same content'; write(p.file, p.value);
  const reuse = await W.evaluate(candidateInput(f, p, 'search', 'different-path'));
  assert.equal(reuse.source_run_id, c.run_id);
  const repeated = await W.evaluate({ ...candidateInput(f, p, 'search','independent-repeat'), repeat:true });
  assert.notEqual(repeated.run_id, c.run_id);
  const state = W.status(S.open(f.run));
  assert.equal(state.versions, 2); assert.equal(state.derivations, 3);
  assert.equal(state.budget.evaluations, 4); assert.equal(state.budget.cache_reuses, 1);
  const trace = fs.readFileSync(path.join(f.dir, 'trace.txt'),'utf8').trim().split('\n');
  assert.equal(trace.length, 4);
  p.value.hypothesis = 'Conflict'; write(p.file,p.value);
  await assert.rejects(W.evaluate(candidateInput(f,p,'search','different-path')), { code:'REQUEST_CONFLICT' });
});
test('fixed role, required literals, runtime slots and no-op candidates are handled before model execution', async t => {
  const f = setup(t); await f.prepare(); const b = await baseline(f), p = proposal(f,b);
  for (const [id, mutate] of [
    ['role',x => { x.messages[0].role = 'user'; }],
    ['literal',x => { x.messages[0].content = 'allrows {{text}}'; }],
    ['slot',x => { x.messages[0].content = 'RULE allrows {{different}}'; }]
  ]) {
    const candidate = structuredClone(f.base); mutate(candidate); write(f.candidateFile,candidate);
    await assert.rejects(W.evaluate(candidateInput(f,p,'search',id)), { code:'POLICY_VIOLATION' });
  }
  write(f.candidateFile,f.base);
  assert.equal((await W.evaluate(candidateInput(f,p,'search','noop'))).outcome,'no_change');
  const state = W.status(S.open(f.run)); assert.equal(state.budget.evaluations,2); assert.equal(state.versions,1);
});
test('evidence binds to the actual parent failure and approved business rules', async t => {
  const f = setup(t); await f.prepare(); const b = await baseline(f), p = proposal(f,b);
  p.value.evidence_refs = [b.run_id + '/NOT-A-CASE']; write(p.file,p.value);
  await assert.rejects(W.evaluate(candidateInput(f,p)), { code:'INVALID_EVIDENCE' });
  p.value.evidence_refs = [b.run_id + '/SEARCH-1']; p.value.rule_refs[0].source = 'invented'; write(p.file,p.value);
  await assert.rejects(W.evaluate(candidateInput(f,p,'search','bad-rule')), { code:'INVALID_RULE' });
  assert.equal(W.usage(S.open(f.run)).evaluations,2);
});
test('baseline and budgets gate execution; exhausted runs can still deliver the baseline', async t => {
  const f = setup(t,{ maxEvaluations:2 }); const ready = await f.prepare();
  await assert.rejects(W.evaluate({ run:f.run, candidate:f.candidateFile, split:'search', requestId:'too-early' }), { code:'BASELINE_REQUIRED' });
  const b = await baseline(f), p = proposal(f,b);
  await assert.rejects(W.evaluate(candidateInput(f,p)), { code:'BUDGET_EXHAUSTED' });
  assert.equal(W.usage(S.open(f.run)).evaluations,2);
  const result = W.finalize({ run:f.run, version:ready.baseline_version_id, reason:'budget_exhausted' });
  assert.equal(result.manifest.comparison.delta,0);
  const over = setup(t,{ bound:3, maxCalls:2 }); await over.prepare();
  await assert.rejects(W.evaluate({run:over.run,baseline:true,split:'search',requestId:'bound'}),{ code:'BUDGET_EXHAUSTED' });
  assert.equal(fs.existsSync(path.join(over.dir,'trace.txt')),false);
});
test('a task can omit the aggregate model-call limit and still record usage', async t => {
  const f = setup(t, { bound:501 });
  delete f.task.budget.max_target_calls;
  write(f.taskFile, f.task);
  await f.prepare();
  const result = await baseline(f);
  assert.equal(result.ok, true);
  assert.equal(W.usage(S.open(f.run)).simulated_calls, 2);
});
test('changed protected code and tampered result blobs cannot silently be reused', async t => {
  const f = setup(t); await f.prepare(); const b = await baseline(f), p = proposal(f,b);
  fs.appendFileSync(path.join(f.dir,'evaluate.cjs'),'\n// change\n');
  await assert.rejects(W.evaluate(candidateInput(f,p)), { code:'CONTRACT_CHANGED' });
  const resultPath = path.join(f.run,b.result_path); fs.appendFileSync(resultPath,' ');
  assert.throws(() => S.open(f.run), { code:'INTEGRITY_ERROR' });
});
test('incomplete event tails and corrupt contracts require attention', async t => {
  const f = setup(t); await f.prepare(); fs.appendFileSync(path.join(f.run,'events.jsonl'),'{"partial":');
  assert.throws(() => S.open(f.run), { code:'INTEGRITY_ERROR' });
  const other = setup(t); await other.prepare();
  const c = JSON.parse(fs.readFileSync(path.join(other.run,'contract.json'))); c.task.objective = 'changed'; write(path.join(other.run,'contract.json'),c);
  assert.throws(() => S.open(other.run), { code:'INTEGRITY_ERROR' });
});
test('coverage, identity, metric, malformed and missing outputs fail distinctly', async t => {
  for (const [fault, code] of [['partial','INCOMPLETE_COVERAGE'],['identity','INVALID_RESULT'],['metric','INVALID_METRIC'],['json','INVALID_JSON'],['missing','MISSING_RESULT'],['exit','RUNNER_FAILED'],['usage','BUDGET_VIOLATION']]) {
    const f = setup(t,{ fault }); await f.prepare();
    const result = await W.evaluate({run:f.run,baseline:true,split:'search',requestId:'bad-result'});
    assert.equal(result.ok,false,fault); assert.equal(result.error.code,code,fault); assert.equal(result.status,'failed');
    const replay = await W.evaluate({run:f.run,baseline:true,split:'search',requestId:'bad-result'});
    assert.equal(replay.ok,false); assert.equal(W.usage(S.open(f.run)).evaluations,1);
    if (fault === 'usage') assert.equal(W.usage(S.open(f.run)).target_calls,1);
  }
});
test('unconfirmed remote outcomes retain reservations and prevent blind retry or finalization', async t => {
  const f = setup(t,{fault:'partial',remote:true,bound:2}); await f.prepare();
  const result = await W.evaluate({run:f.run,baseline:true,split:'search',requestId:'unknown'});
  assert.equal(result.status,'unknown'); const state = W.status(S.open(f.run));
  assert.equal(state.phase,'needs_attention'); assert.equal(state.budget.target_calls,2);
  await assert.rejects(W.evaluate({run:f.run,baseline:true,split:'search',requestId:'retry'}), { code:'UNKNOWN_EXECUTION' });
  assert.throws(() => W.finalize({run:f.run,version:result.version_id,reason:'runner_error'}),{code:'UNKNOWN_EXECUTION'});
});
test('timeout stops owned local work, leaves a recorded failure and releases the writer', async t => {
  const f = setup(t,{fault:'sleep',timeout:1}); await f.prepare();
  const started = Date.now(), result = await W.evaluate({run:f.run,baseline:true,split:'search',requestId:'timeout'});
  assert.equal(result.status,'failed'); assert.ok(Date.now()-started<4000);
  assert.equal(fs.existsSync(path.join(f.run,'.write-lock')),false);
  assert.equal(W.status(S.open(f.run)).budget.evaluations,1);
});
test('original versus adapted baseline is required when configured', async t => {
  const f = setup(t,{original:true}); await f.prepare(); await baseline(f);
  assert.equal(W.status(S.open(f.run)).baseline_checked,false);
  for (const split of ['search','validation']) await W.evaluate({run:f.run,baseline:true,original:true,split,requestId:'original-'+split});
  assert.equal(W.status(S.open(f.run)).baseline_checked,true);
});
test('missing environment, unsupported verify and overlapping split IDs never start a model', async t => {
  const f = setup(t); f.project.env_required=['PROMPTTREE_MISSING_TEST_KEY_123']; write(f.projectFile,f.project);
  assert.equal((await f.prepare()).readiness,'CONDITIONAL'); assert.equal(fs.existsSync(f.run),false);
  const v = setup(t,{mode:'verify'}); await assert.rejects(v.prepare(), {code:'UNSUPPORTED_MODE'});
  const d = setup(t); const validation=JSON.parse(fs.readFileSync(path.join(d.dir,'validation.json'))); validation[0].case_id='SEARCH-1';write(path.join(d.dir,'validation.json'),validation);
  await assert.rejects(d.prepare(), {code:'DATA_LEAKAGE'});
});
test('concurrent writers fail safely, secret diagnostics are redacted, and diffs reconstruct both versions', async t => {
  const f = setup(t); await f.prepare(); const unlock=S.lock(f.run);
  await assert.rejects(W.evaluate({run:f.run,baseline:true,split:'search',requestId:'busy'}),{code:'BUSY'});unlock();
  const s=setup(t,{fault:'secret'});s.project.env_required=['PROMPTTREE_TEST_SECRET'];write(s.projectFile,s.project);
  process.env.PROMPTTREE_TEST_SECRET='a-test-only-secret';
  t.after(()=>delete process.env.PROMPTTREE_TEST_SECRET);await s.prepare();
  const r=await W.evaluate({run:s.run,baseline:true,split:'search',requestId:'redacted'});
  const logs=fs.readFileSync(path.join(s.run,'runs/redacted/diagnostics.json'),'utf8');
  assert.ok(!logs.includes('a-test-only-secret'));assert.ok(logs.includes('[REDACTED]'));assert.equal(r.ok,true);
  const lines=diff('a\nb','b\nc');
  assert.equal(lines.filter(l=>l.kind!=='add').map(l=>l.text).join('\n'),'a\nb');
  assert.equal(lines.filter(l=>l.kind!=='remove').map(l=>l.text).join('\n'),'b\nc');
});
test('edit size measures changes against the direct parent in Unicode characters', () => {
  assert.deepEqual(editSize('a😀b','a树b'), { parent_length:3, length:3, removed:1, added:1, ratio:1/3 });
  assert.equal(editSize('x'.repeat(20), 'x'.repeat(19)).ratio, .05);
  assert.equal(editSize('x'.repeat(20), 'x'.repeat(22)).ratio, .1);
  assert.equal(editSize('abc','abc').ratio, 0);
  assert.equal(editSize('','abc').ratio, null);
});
test('validation comparison only projects complete paired evidence from the scored run', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prompttree-pairs-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const run={run_id:'r1',result_path:'result.json',split:'validation',status:'succeeded'};
  const nodes=[{runs:[{...run,kind:'original',result_path:'original.json'},run]}];
  const sample={case_id:'c1',failed:false,prediction:'A',expected:'A'};
  const result={case_ids:['c1'],cases:[{...sample,input_excerpt:'private'}]};
  write(path.join(dir,run.result_path),result);
  assert.deepEqual(validationCases(nodes,dir),{r1:[sample]});
  write(path.join(dir,run.result_path),{...result,case_ids:['c1','c2']});
  assert.deepEqual(validationCases(nodes,dir),{});
});
test('conversation export joins by the configured ID and projects the selected input history', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prompttree-history-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const dataset={path:path.join(dir,'inputs.jsonl'),id_field:'id'};
  const turns=[{role:'user',content:'original\nmessage',private_note:'omit'},{role:'action',action:'lookup',text:'Done.'}];
  const inputs=[{id:'unused',messages:turns},{id:'c1',messages:turns},{id:'empty',messages:[]},{id:'missing'}];
  fs.writeFileSync(dataset.path,inputs.map(r=>JSON.stringify(r)).join('\n'));
  const result=validationHistories(dataset,'messages',{r:[{case_id:'empty'},{case_id:'missing'},{case_id:'c1'}]});
  assert.deepEqual({...result},{c1:[{role:'user',text:'original\nmessage'},{role:'action',text:'Done.',action:'lookup'}],empty:[]});
});
test('native integration patches apply exactly, including final newline changes', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prompttree-patch-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'prompts'));
  for(const [before,after] of [['a\nb\n','a\nc\n'],['a','a\nb\n'],['a\n','a'],['','added\n'],['deleted\n','']]) {
    fs.writeFileSync(path.join(dir,'prompts/extract.md'),before);
    const file=path.join(dir,'integration.patch');fs.writeFileSync(file,patch(before,after,'prompts/extract.md'));
    execFileSync('git',['apply','--check',file],{cwd:dir});execFileSync('git',['apply',file],{cwd:dir});
    assert.equal(fs.readFileSync(path.join(dir,'prompts/extract.md'),'utf8'),after);
  }
});
test('candidate changes one local hunk in one editable field relative to its actual parent', async t => {
  const f = setup(t);
  f.base.messages[0].content = 'RULE firstonly\nkeep\n{{text}}';
  f.base.messages.push({ role:'user', content:'initial' });
  f.project.policy.editable_paths.push('/messages/1/content');
  write(path.join(f.dir,'prompt.json'), f.base);
  write(f.projectFile, f.project);
  await f.prepare();
  const b = await baseline(f), p = proposal(f,b);
  const child = structuredClone(f.base);
  child.messages[1].content = 'different';
  child.messages[0].content += ' extra';
  write(f.candidateFile,child);
  await assert.rejects(W.evaluate(candidateInput(f,p,'search','two-fields')), { code:'NON_ATOMIC_EDIT' });
  child.messages[1].content = 'initial';
  child.messages[0].content = 'RULE new\nkeep\n{{text}} extra';
  write(f.candidateFile,child);
  await assert.rejects(W.evaluate(candidateInput(f,p,'search','two-hunks')), { code:'NON_ATOMIC_EDIT' });
  assert.equal(W.usage(S.open(f.run)).evaluations,2);
  child.messages[0].content = 'RULE new\nkeep\n{{text}}';
  write(f.candidateFile,child);
  const c = await W.evaluate(candidateInput(f,p,'search','parent'));
  p.value.parent_event_id = c.event_id;
  p.value.evidence_refs = [c.run_id + '/SEARCH-1'];
  write(p.file,p.value);
  child.messages[1].content = 'different';
  write(f.candidateFile,child);
  const grandchild = await W.evaluate(candidateInput(f,p,'search','grandchild'));
  assert.equal(grandchild.status,'succeeded');
});
