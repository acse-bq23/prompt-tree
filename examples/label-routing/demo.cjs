'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = __dirname;
const cli = path.resolve(root, '../../skills/prompttree/scripts/prompttree.cjs');
const call = (...args) => JSON.parse(execFileSync(process.execPath,[cli,...args],{ encoding:'utf8' }));
const rules = [{ id:'exact-set', version:'1', source:'README.md#scoring' }];
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
function write(file,value) { fs.writeFileSync(file,JSON.stringify(value,null,2)); return file; }

function prepare() {
  const work = path.join(root,'.prompttree');
  fs.mkdirSync(work,{ recursive:true });
  const intake = fs.mkdtempSync(path.join(work,'demo-')), run = path.join(intake,'run');
  const { datasets } = call('split','--dataset',path.join(root,'cases.json'),'--group','ticket_id','--out',path.join(intake,'splits'));
  const project = write(path.join(intake,'project.json'), {
    schema_version:'prompttree-project-v1', project_id:'label-routing', execution_kind:'mock', workspace:root,
    prompt_entry:'prompt.json', policy:{ editable_paths:['/messages/0/content'] },
    evaluate_argv:['node','evaluate.cjs','{candidate_file}','{dataset_file}','{request_file}','{result_file}'],
    protected_files:['route.cjs','evaluate.cjs','README.md'], runner_timeout_seconds:10,
    target_calls_per_case_bound:0, call_bound_kind:'none', remote_effects:false
  });
  const task = write(path.join(intake,'task.json'), {
    schema_version:'prompttree-task-v1', mode:'probe', max_layers:3, allow_cache:true, objective:'Return the complete set of ticket labels',
    primary_metric:'exact_set', metrics:['exact_set'], rules,datasets,
    budget:{ max_attempts:26, max_evaluations:26, max_target_calls:0, max_wall_time_seconds:600 },
    evidence:{ search_cases_visible:true, export_search_cases:false }
  });
  call('prepare','--project',project,'--task',task,'--run',run);
  return run;
}

// This fixture stands in for Codex's business analysis using three known error patterns.
function nextPlan(run,receipt) {
  const plan = { level:receipt.level+1,nodes:[],stops:[] };
  for (const parent of receipt.nodes.filter(n => n.status === 'completed')) {
    const native = read(path.join(run,'versions',parent.version_id+'.json')).candidate;
    const directions = [
      ['Multi-label','Return all matching labels.', c => c.expected.length > c.prediction.length && c.expected.length > 1],
      ['Case folding','Ignore case.', c => c.input_excerpt === c.input_excerpt.toUpperCase()],
      ['Password alias','Treat password as login.', c => c.input_excerpt.includes('password')]
    ];
    let expanded = false;
    for (const [label,edit,matches] of directions) {
      const failure = parent.search_failures.find(matches);
      if (!failure) continue;
      const candidate = structuredClone(native);
      const message = candidate.messages[0];
      message.content = label === 'Multi-label'
        ? message.content.replace('Return a matching label.',edit)
        : message.content + ' ' + edit;
      const proposal = { parent_event_id:parent.event_id, evidence_refs:[parent.search_run_id+'/'+failure.case_id],
        rule_refs:rules, operator:label, hypothesis:edit, expected_effect:'Recover the omitted ticket label',
        regression_risk:'Recheck the other ticket groups' };
      plan.nodes.push({candidate,proposal});
      expanded = true;
    }
    if (!expanded) plan.stops.push({ parent_event_id:parent.event_id, reason:'No attributable search failure' });
  }
  return plan;
}

function explore(run) {
  const history = call('status','--run',run);
  let plan = { level:1,nodes:[{}] }, best;
  for (;;) {
    const level = plan.level;
    const receipt = history.layers.some(l=>l.level===level)
      ? call('layer-resume','--run',run,'--level',String(level),'--wait')
      : call('layer-submit','--run',run,'--plan',write(path.join(path.dirname(run),'level-'+level+'.json'),plan),'--wait');
    for (const n of receipt.nodes.filter(n=>n.status==='completed')) {
      if (!best || n.validation_metrics.exact_set.value > best.validation_metrics.exact_set.value) best=n;
    }
    if (receipt.next === 'finalize') break;
    plan = nextPlan(run,receipt);
  }
  const finalized = call('finalize','--run',run,'--version',best.version_id,'--reason','depth_limit');
  return { run, report:finalized.report, comparison:finalized.manifest.comparison, counts:finalized.manifest.counts, usage:finalized.manifest.usage };
}
if (require.main === module) {
  const run = process.argv[2] === '--resume' ? path.resolve(process.argv[3]) : prepare();
  console.log(JSON.stringify(process.argv[2] === '--prepare-only' ? { run } : explore(run),null,2));
}
module.exports = { prepare, nextPlan, explore };
