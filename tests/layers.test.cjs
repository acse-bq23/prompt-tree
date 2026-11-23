'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const cli = path.resolve(__dirname,'../skills/prompttree/scripts/prompttree.cjs');
const read = f=>JSON.parse(fs.readFileSync(f));
const write = (f,x)=>{fs.writeFileSync(f,JSON.stringify(x));return f;};
const call = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:'utf8'}));
async function until(fn) {
  const end=Date.now()+15000;
  while (Date.now()<end) { if (fn()) return; await delay(30); }
  assert.fail('Timed out waiting for the instrumented evaluator');
}
function fixture(t,maxLayers=3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'layer-recovery-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const example=path.resolve(__dirname,'../examples/label-routing');
  for (const file of ['prompt.json','route.cjs','evaluate.cjs']) fs.copyFileSync(path.join(example,file),path.join(dir,file));
  const input=path.join(dir,'evaluate.cjs');
  // The local billing ledger is independent of Prompt Tree and counts every dispatch.
  fs.writeFileSync(input,fs.readFileSync(input,'utf8').replace('const cases =',`
fs.appendFileSync('meter.jsonl',JSON.stringify({id:request.request_id,units:rows.length})+'\\n');
const deadline=Date.now()+15000;
while(fs.existsSync('pause') && Date.now()<deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30);
const cases =`).replace('target_calls:0','target_calls:rows.length'));
  const project=write(path.join(dir,'project.json'),{schema_version:'prompttree-project-v1',project_id:'meter',execution_kind:'mock',
    workspace:dir,prompt_entry:'prompt.json',policy:{editable_paths:['/messages/0/content']},evaluate_argv:['node','evaluate.cjs','{candidate_file}','{dataset_file}','{request_file}','{result_file}'],
    protected_files:['route.cjs','evaluate.cjs'],runner_timeout_seconds:30,target_calls_per_case_bound:1,call_bound_kind:'project_enforced',remote_effects:true});
  const datasets={};
  for (const split of ['search','validation']) {
    datasets[split]={expected_cases:1,path:write(path.join(dir,split+'.json'),[{case_id:split,input:'payment and login',expected:['billing','access']}])};
  }
  const rule={id:'labels',source:'test',version:'1'};
  const task=write(path.join(dir,'task.json'),{schema_version:'prompttree-task-v1',mode:'probe',max_layers:maxLayers,objective:'test',datasets,
    primary_metric:'exact_set',metrics:['exact_set'],rules:[rule],evidence:{search_cases_visible:true},budget:{max_attempts:30,max_evaluations:30,max_target_calls:30,max_wall_time_seconds:90}});
  const run=path.join(dir,'run');
  call('prepare','--run',run,'--project',project,'--task',task);
  const plan=write(path.join(dir,'root.json'),{level:1,nodes:[{}]});
  const meter=()=>fs.readFileSync(path.join(dir,'meter.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const args=['layer-submit','--run',run,'--plan',plan,'--wait'];
  return {dir,run,plan,meter,args,rule};
}
test('killing the waiting client and worker mid-charge reconnects to the original receipt', async t=>{
  const f=fixture(t),pause=path.join(f.dir,'pause');
  fs.writeFileSync(pause,'');
  const host=spawn(process.execPath,[cli,...f.args],{stdio:'ignore'});
  const closed=once(host,'exit');
  await until(()=>fs.existsSync(path.join(f.dir,'meter.jsonl')));
  const state=call('status','--run',f.run);
  assert.equal(state.layers[0].nodes[0].status,'running');
  host.kill('SIGKILL'); await closed;
  process.kill(state.layers[0].worker_pid,'SIGKILL');
  fs.unlinkSync(pause);
  const resume=['layer-resume','--run',f.run,'--level','1','--wait'];
  const receipt=call(...resume);
  assert.equal(receipt.nodes[0].status,'completed');
  assert.deepEqual(receipt,call(...f.args));
  const usage=call('status','--run',f.run).budget;
  assert.deepEqual(f.meter().map(r=>r.id),['L1-N1-search','L1-N1-validation']);
  assert.equal(usage.target_calls,f.meter().reduce((n,r)=>n+r.units,0));
  assert.equal(usage.attempts,2);
  function edit(parent,phrase) {
    const candidate=read(path.join(f.run,'versions',parent.version_id+'.json')).candidate;
    candidate.messages[0].content+=' '+phrase;
    return {candidate,proposal:{ parent_event_id:parent.event_id,evidence_refs:[parent.search_run_id+'/search'],
      rule_refs:[f.rule],operator:phrase,hypothesis:phrase,expected_effect:'Recover missing labels',regression_risk:'Extra labels' }};
  }
  const submit=plan=>call('layer-submit','--run',f.run,'--plan',write(path.join(f.dir,'next.json'),plan),'--wait');
  const parent=receipt.nodes[0];
  const siblings=submit({level:2,nodes:[edit(parent,'Check the whole ticket.'),edit(parent,'Return all matching labels.')]});
  const last=submit({level:3,nodes:[edit(siblings.nodes[0],'Return all matching labels.')],
    stops:[{ parent_event_id:siblings.nodes[1].event_id,reason:'All search cases passed' }]});
  assert.equal(last.next,'finalize');
  const final=call('finalize','--run',f.run,'--version',siblings.nodes[1].version_id,'--reason','depth_limit');
  assert.equal(final.manifest.usage.target_calls,8);
  assert.equal(f.meter().length,new Set(f.meter().map(r=>r.id)).size);
  assert.equal(f.meter().reduce((n,r)=>n+r.units,0),final.manifest.usage.target_calls);
  assert.deepEqual(read(path.join(final.output,'evolution.json')).layers.map(l=>l.count),[1,2,1]);
});
test('missing evaluator exit receipt holds the reservation through reconnect and replay',async t=>{
  const f=fixture(t),pause=path.join(f.dir,'pause');
  fs.writeFileSync(pause,'');
  call(...f.args.slice(0,-1));
  await until(()=>fs.existsSync(path.join(f.dir,'meter.jsonl')));
  const dispatched=read(path.join(f.run,'runs/L1-N1-search/dispatch.json'));
  process.kill(dispatched.pid,'SIGKILL');
  fs.unlinkSync(pause);
  await until(()=>call('status','--run',f.run).layers[0].status==='needs_attention');
  assert.throws(()=>call(...f.args));
  assert.equal(f.meter().length,1);
  const state=call('status','--run',f.run);
  assert.equal(state.budget.target_calls,1);
  assert.equal(state.budget.pending.length,1);
  assert.equal(state.layers[0].nodes[0].status,'unknown');
});
test('invalid depth, wrong parents, missing dispositions, partial layer and early pruning',t=>{
  const f=fixture(t);
  const root=call(...f.args).nodes[0];
  const submit=plan=>call('layer-submit','--run',f.run,'--plan',write(path.join(f.dir,'next.json'),plan),'--wait');
  assert.throws(()=>submit({level:2,nodes:[]}));
  const candidate=read(path.join(f.dir,'prompt.json'));
  candidate.messages[0].content+=' Return all matching labels.';
  const proposal={parent_event_id:root.event_id,evidence_refs:[root.search_run_id+'/search'],rule_refs:[f.rule],operator:'multi',hypothesis:'recall',expected_effect:'both',regression_risk:'extra'};
  const valid={candidate,proposal},bad={candidate,proposal:{...proposal,evidence_refs:['wrong/case']}};
  const layer=submit({level:2,nodes:[bad,valid]});
  assert.deepEqual(layer.nodes.map(n=>n.status),['rejected','completed']);
  assert.equal(layer.status,'partial');
  assert.throws(()=>submit({level:2,nodes:[valid]}));
  assert.throws(()=>submit({level:3,nodes:[valid]}));
  assert.throws(()=>submit({level:4,nodes:[]}));
  const stop={parent_event_id:layer.nodes[1].event_id,reason:'No search failures'};
  const last=submit({level:3,nodes:[],stops:[stop]});
  assert.equal(last.next,'finalize');
  const result=call('finalize','--run',f.run,'--version',layer.nodes[1].version_id,'--reason','target_reached');
  const tree=read(path.join(result.output,'evolution.json'));
  assert.deepEqual(tree.nodes.map(n=>n.status),['completed','rejected','completed']);
  assert.equal(tree.nodes[1].parent_event_id,root.event_id);
  assert.equal(tree.nodes[2].reason,stop.reason);
});
test('a one-level contract stops at the root and preserves the depth boundary',t=>{
  const f=fixture(t,1);
  const root=call(...f.args);
  assert.equal(root.next,'finalize');
  assert.throws(()=>call('layer-submit','--run',f.run,'--plan',write(path.join(f.dir,'extra.json'),{level:2,nodes:[]}),'--wait'));
  const result=call('finalize','--run',f.run,'--version',root.nodes[0].version_id,'--reason','depth_limit');
  const tree=read(path.join(result.output,'evolution.json'));
  assert.equal(tree.nodes.length,1);
  assert.equal(tree.nodes[0].branch,'depth_limit');
  assert.equal(tree.nodes[0].selected,true);
});
