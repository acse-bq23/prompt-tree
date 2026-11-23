'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = __dirname;
const cli = path.resolve(root, '../../skills/prompttree/scripts/prompttree.cjs');
const call = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding:'utf8' }));
const work = path.join(root, '.prompttree');
fs.mkdirSync(work, { recursive:true });
const intake = fs.mkdtempSync(path.join(work, 'demo-')), run = path.join(intake, 'run');
function write(name, value) {
  const file = path.join(intake, name + '.json');
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}
const { datasets } = call('split','--dataset',path.join(root,'cases.json'),'--group','ticket_id','--out',path.join(intake,'splits'));
const rules = [{ id:'exact-set', version:'1', source:'README.md#scoring' }];
const project = write('project', {
  schema_version:'prompttree-project-v1', project_id:'label-routing', execution_kind:'mock', workspace:root,
  prompt_entry:'prompt.json', policy:{ editable_paths:['/messages/0/content'] },
  evaluate_argv:[process.execPath,'evaluate.cjs','{candidate_file}','{dataset_file}','{request_file}','{result_file}'],
  protected_files:['route.cjs','evaluate.cjs','README.md'], runner_timeout_seconds:10,
  target_calls_per_case_bound:0, call_bound_kind:'none', remote_effects:false
});
const task = write('task', {
  schema_version:'prompttree-task-v1', mode:'probe', objective:'Return the complete set of ticket labels',
  primary_metric:'exact_set', metrics:['exact_set'], rules, datasets,
  budget:{ max_attempts:6, max_evaluations:6, max_target_calls:0, max_wall_time_seconds:120 },
  evidence:{ search_cases_visible:true, export_search_cases:false }
});
call('prepare','--project',project,'--task',task,'--run',run);
const evaluate = (split, id, ...args) => call('evaluate','--run',run,'--split',split,'--request-id',id,...args);
const search = evaluate('search','baseline-search','--baseline');
let best = evaluate('validation','baseline-validation','--baseline');
const failure = search.result.cases.find(c => c.failed);
if (failure) {
  for (const [id, wording, hypothesis] of [
    ['specific','a specific matching label','Specificity may improve ambiguous matches'],
    ['complete','all matching labels','An explicit quantifier may recover omitted labels']
  ]) {
    const candidate = structuredClone(require('./prompt.json'));
    candidate.messages[0].content = candidate.messages[0].content.replace('a matching label', wording);
    const candidateFile = write(id, candidate);
    const proposal = write(id + '-proposal', { parent_event_id:'E-000', evidence_refs:[search.run_id + '/' + failure.case_id],
      rule_refs:rules, operator:'REWORD', hypothesis, expected_effect:'Improve complete label sets',
      regression_risk:'Check single-label and empty tickets' });
    const args = ['--candidate',candidateFile,'--proposal',proposal];
    evaluate('search',id + '-search',...args);
    const validation = evaluate('validation',id + '-validation',...args);
    if (validation.metrics.exact_set.value > best.metrics.exact_set.value) best = validation;
  }
}
const finalized = call('finalize','--run',run,'--version',best.version_id,
  '--reason',best.metrics.exact_set.value === 1 ? 'target_reached' : 'plateau');
console.log(JSON.stringify({ report:finalized.report, comparison:finalized.manifest.comparison,
  counts:finalized.manifest.counts, usage:finalized.manifest.usage }, null, 2));
