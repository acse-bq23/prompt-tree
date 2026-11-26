'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./core.cjs');
const S = require('./store.cjs');
const R = require('./runner.cjs');
const { promptText, editSize } = require('./edit-size.cjs');

const home = path.resolve(__dirname, '..');
const STOP_REASONS = ['depth_limit','target_reached','budget_exhausted','plateau','no_valid_candidate','runner_error','operator_stop','cancelled','contract_changed'];
const sourceFiles = () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  return walk(home).sort();
};
const softwareHash = () => C.hash(sourceFiles().map(file => [path.relative(home, file), C.hash(fs.readFileSync(file))]));
const absolute = (base, value) => { C.check(typeof value === 'string' && value.length, 'INVALID_PATH', 'Path required'); return path.resolve(base, value); };
const ratio = value => value && Number.isSafeInteger(value.numerator) && Number.isSafeInteger(value.denominator) &&
  value.denominator > 0 && value.numerator >= 0 && value.numerator <= value.denominator &&
  Number.isFinite(value.value) && Math.abs(value.value - value.numerator / value.denominator) < 1e-8;

function commandFiles(workspace, argv) {
  return argv.filter(s => typeof s === 'string' && !s.includes('{'))
    .map(s => path.resolve(workspace, s)).filter(s => fs.existsSync(s) && fs.statSync(s).isFile());
}
function loadVersion(store, id) {
  const meta = S.state(store).versions[id];
  C.check(meta, 'UNKNOWN_VERSION', 'Unknown Prompt version');
  return C.readJSON(C.inside(store.root, meta.path));
}
function usage(store) {
  const state = S.state(store);
  const runs = Object.values(state.runs);
  return {
    attempts:state.attempts, evaluations:runs.length, cache_reuses:state.reused,
    target_calls:runs.reduce((n, r) => n + (r.status === 'unknown' ? r.reserved_calls : r.charged_calls), 0),
    pending:runs.filter(r => r.status === 'unknown').map(r => r.run_id),
    simulated_calls:runs.reduce((n, r) => n + (r.simulated_calls || 0), 0),
    host_tokens:null, host_cost:null
  };
}
function status(store) {
  const state = S.state(store);
  const layers = store.contract.task.max_layers ? require('./layers.cjs').snapshot(store) : null;
  const layer = layers?.at(-1);
  return { ok:true, experiment_id:store.contract.experiment_id, execution_kind:store.contract.project.execution_kind,
    phase:layer && !state.finalized ? layer.status : state.phase, baseline_checked:state.baseline_checked, budget:usage(store),
    limits:store.contract.task.budget, deadline_at:store.contract.deadline_at,
    versions:Object.keys(state.versions).length, derivations:state.derivations.length,
    runs:Object.values(state.runs), final:state.finalized,
    ...(layers ? { max_layers:store.contract.task.max_layers, layers } : {}),
    limitation:'Local records detect corruption; shared filesystem privileges are not an isolation boundary.' };
}
function environment(contract) {
  C.check(softwareHash() === contract.software_hash, 'TOOL_CHANGED', 'Skill or toolkit changed; start a new experiment');
  C.assertFingerprints(contract.files);
  const missing = contract.project.env_required.filter(name => !process.env[name]);
  C.check(!missing.length, 'MISSING_ENV', 'Required environment variables missing', { names:missing });
}
function options(contract, remaining) {
  return { workspace:contract.project.workspace, env_required:contract.project.env_required,
    timeout_ms:Math.min(contract.project.runner_timeout_seconds * 1000, remaining) };
}
async function rendered(project, candidateFile, outputFile, timeoutMs) {
  if (!project.render_argv) {
    const value = C.readJSON(candidateFile); C.validateRendered(value); return value;
  }
  const result = await R.execute(project.render_argv, { candidate_file:candidateFile, rendered_file:outputFile },
    { workspace:project.workspace, env_required:project.env_required, timeout_ms:timeoutMs });
  C.check(result.code === 0 && !result.reason && fs.existsSync(outputFile), 'RENDER_FAILED', 'Pure template renderer failed');
  const value = C.readJSON(outputFile); C.validateRendered(value); return value;
}
// Trim shared context before checking for an unchanged line separating two edits.
function hasSingleHunk(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const removed = new Set(a.slice(start, endA));
  return !b.slice(start, endB).some(line => removed.has(line));
}
function registerVersion(store, candidate, template) {
  const contentHash = C.hash(template), id = 'V-' + contentHash;
  const old = S.state(store).versions[id];
  if (old) {
    C.check(JSON.stringify(loadVersion(store, id).rendered) === JSON.stringify(template), 'INTEGRITY_ERROR', 'Content hash collision');
    return id;
  }
  const file = 'versions/' + id + '.json';
  const artifact = S.blob(store, file, { candidate, rendered:template, content_hash:contentHash });
  S.append(store, 'VERSION', { version_id:id, content_hash:contentHash, path:file }, [artifact]);
  return id;
}
async function prepare({ project:projectFile, task:taskFile, run }) {
  const root = path.resolve(run);
  if (!projectFile && !taskFile) return status(S.open(root));
  C.check(projectFile && taskFile, 'INVALID_INPUT', 'Both --project and --task are required');
  const base = path.dirname(path.resolve(projectFile));
  const project = C.clone(C.readJSON(projectFile)), task = C.clone(C.readJSON(taskFile));
  C.check(project.schema_version === 'prompttree-project-v1' && task.schema_version === 'prompttree-task-v1', 'UNSUPPORTED_SCHEMA', 'Unsupported configuration schema');
  if (task.max_layers !== undefined) C.budgetNumber(task.max_layers, 'max_layers');
  C.check(task.mode === 'probe', 'UNSUPPORTED_MODE', 'This version implements Probe; independent verify is not implemented');
  C.check(['mock','real'].includes(project.execution_kind), 'INVALID_CONFIG', 'execution_kind must explicitly be mock or real');
  C.check(project.project_id && task.objective, 'INVALID_CONFIG', 'project_id and objective required');
  project.workspace = absolute(base, project.workspace);
  C.check(fs.existsSync(project.workspace) && fs.statSync(project.workspace).isDirectory(), 'MISSING_WORKSPACE', 'Project workspace missing');
  project.prompt_entry = absolute(project.workspace, project.prompt_entry);
  project.env_required ||= [];
  C.check(Array.isArray(project.env_required) && project.env_required.every(s => typeof s === 'string'), 'INVALID_CONFIG', 'env_required must be names only');
  R.argv(project.evaluate_argv, { candidate_file:'candidate', dataset_file:'dataset', result_file:'result', request_file:'request', max_target_calls:'bound' });
  C.check(project.evaluate_argv.some(s => s.includes('{candidate_file}')) && project.evaluate_argv.some(s => s.includes('{dataset_file}')) &&
    project.evaluate_argv.some(s => s.includes('{result_file}')) && project.evaluate_argv.some(s => s.includes('{request_file}')), 'INVALID_COMMAND', 'Evaluation argv must bind candidate, dataset, result and request files');
  if (project.original_evaluate_argv) R.argv(project.original_evaluate_argv, { candidate_file:'candidate', dataset_file:'dataset', result_file:'result', request_file:'request', max_target_calls:'bound' });
  if (project.render_argv) {
    C.check(project.render_is_pure === true, 'CONDITIONAL', 'A reviewed pure renderer is required');
    R.argv(project.render_argv, { candidate_file:'candidate', rendered_file:'rendered' });
  }
  C.budgetNumber(project.runner_timeout_seconds, 'runner_timeout_seconds');
  C.check(Number.isSafeInteger(project.target_calls_per_case_bound) && project.target_calls_per_case_bound >= 0, 'INVALID_CONFIG', 'A finite per-case target-call bound is required');
  C.check(['project_enforced','declared','none'].includes(project.call_bound_kind), 'INVALID_CONFIG', 'call_bound_kind required');
  C.check(project.execution_kind !== 'real' || project.target_calls_per_case_bound > 0, 'INVALID_CONFIG', 'Real execution requires a positive call bound');
  C.check(project.call_bound_kind !== 'none' || project.execution_kind === 'mock', 'INVALID_CONFIG', 'No target-call enforcement is only allowed for a zero-call mock');
  C.check(project.call_bound_kind !== 'declared' || task.accept_declared_call_bound === true, 'CONDITIONAL', 'Declared call bounds require explicit task acceptance');
  C.check(task.budget && task.datasets, 'INVALID_CONFIG', 'budget and datasets required');
  C.check(Object.keys(task.datasets).every(name => ['search','validation'].includes(name)), 'INVALID_SPLIT', 'Probe configuration accepts search and validation only');
  for (const key of ['max_attempts','max_evaluations','max_wall_time_seconds']) C.budgetNumber(task.budget[key], key);
  const callLimit = task.budget.max_target_calls;
  C.check(callLimit === undefined || (Number.isSafeInteger(callLimit) && callLimit >= 0), 'INVALID_BUDGET', 'max_target_calls must be a nonnegative integer when supplied');
  C.check(task.primary_metric && Array.isArray(task.metrics) && task.metrics.includes(task.primary_metric), 'INVALID_CONFIG', 'metrics and primary_metric required');
  C.check(Number.isFinite(task.baseline_tolerance || 0) && (task.baseline_tolerance || 0) >= 0, 'INVALID_CONFIG', 'Invalid baseline_tolerance');
  const policy = typeof project.policy_ref === 'string' ? C.readJSON(absolute(base, project.policy_ref)) : project.policy;
  const baseline = C.readJSON(project.prompt_entry);
  C.validatePolicy(policy, baseline); C.validateCandidate(baseline, baseline, policy);
  if (project.delivery) {
    C.check(typeof project.delivery.target_path === 'string' && /^[A-Za-z0-9_./-]+$/.test(project.delivery.target_path) &&
      !project.delivery.target_path.startsWith('/') && !project.delivery.target_path.split('/').includes('..'), 'INVALID_PATH', 'Delivery target must be a safe project-relative path');
    C.check(typeof C.pointer(baseline, project.delivery.prompt_pointer).value === 'string', 'INVALID_CONFIG', 'Native prompt delivery requires a string pointer');
  }
  const taskBase = path.dirname(path.resolve(taskFile));
  const splitInfo = {};
  for (const split of ['search','validation']) {
    C.check(task.datasets[split], 'CONDITIONAL', 'Both search and validation snapshots are required');
    const d = task.datasets[split];
    d.path = absolute(taskBase, d.path);
    const info = C.dataset(d.path, d.id_field || 'case_id');
    C.check(d.expected_cases === info.count, 'INVALID_DATASET', 'Declared dataset coverage differs', { split });
    splitInfo[split] = info;
  }
  C.check(!splitInfo.search.ids.some(id => splitInfo.validation.ids.includes(id)), 'DATA_LEAKAGE', 'Search and validation case IDs overlap');
  C.check(Array.isArray(project.protected_files) && project.protected_files.length, 'INVALID_CONFIG', 'protected_files must name the evaluator and business code');
  const protectedFiles = project.protected_files.map(s => absolute(project.workspace, s));
  C.check(project.prompt_sources === undefined || (Array.isArray(project.prompt_sources) && project.prompt_sources.length > 0),
    'INVALID_CONFIG', 'prompt_sources must list the original prompt files');
  const promptSources = (project.prompt_sources || []).map(file => absolute(project.workspace, file));
  const baselineReports = project.baseline_accuracy_report === undefined ? [] : [absolute(project.workspace, project.baseline_accuracy_report)];
  const files = C.fingerprint([...new Set([project.prompt_entry, ...promptSources, ...baselineReports, ...protectedFiles,
    ...commandFiles(project.workspace, project.evaluate_argv), ...commandFiles(project.workspace, project.render_argv || []),
    ...commandFiles(project.workspace, project.original_evaluate_argv || []), ...Object.values(task.datasets).map(d => d.path)])]);
  const missing = project.env_required.filter(name => !process.env[name]);
  if (missing.length) return { ok:false, readiness:'CONDITIONAL', missing_environment_names:missing, model_calls:0 };
  C.check(!fs.existsSync(root), 'EXPERIMENT_EXISTS', 'Use a fresh experiment directory or prepare --run to inspect existing records');
  fs.mkdirSync(root, { recursive:true, mode:0o700 });
  const release = S.lock(root);
  try {
    const candidateFile = C.inside(root, 'tmp/baseline.json'), renderedFile = C.inside(root, 'tmp/baseline-rendered.json');
    C.writeJSON(candidateFile, baseline);
    const template = await rendered(project, candidateFile, renderedFile, project.runner_timeout_seconds * 1000);
    C.assertFingerprints(files);
    const body = { schema_version:'prompttree-contract-v1', tool_version:C.VERSION, software_hash:softwareHash(),
      experiment_id:'X-' + crypto.randomUUID(), created_at:new Date().toISOString(),
      deadline_at:new Date(Date.now() + task.budget.max_wall_time_seconds * 1000).toISOString(),
      project, task, policy, baseline, split_info:splitInfo, files };
    const contract = { ...body, contract_hash:C.hash(body) };
    C.immutable(path.join(root, 'contract.json'), JSON.stringify(contract, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'events.jsonl'), '', { flag:'wx', mode:0o600 });
    const store = S.open(root), id = registerVersion(store, baseline, template);
    S.append(store, 'DERIVATION', { event_id:'E-000', parent_event_id:null, version_id:id, kind:'root', hypothesis:'Imported project baseline', evidence_refs:[], rule_refs:[] });
    return { ...status(store), readiness:'READY', baseline_version_id:id, run:root,
      note:'No model calls made. Baseline search and validation must complete before candidate exploration.' };
  } finally { release(); }
}
function checkResult(raw, request, contract, expectedIds) {
  C.check(raw && raw.schema_version === 'prompttree-evaluation-v1', 'INVALID_RESULT', 'Evaluation schema mismatch');
  for (const name of ['run_id','request_id','contract_hash','version_id','split','template_hash']) {
    C.check(raw[name] === request[name], 'INVALID_RESULT', 'Evaluation identity mismatch', { field:name });
  }
  C.check(raw.execution_kind === contract.project.execution_kind, 'INVALID_RESULT', 'Execution kind mismatch');
  C.check(raw.status === 'succeeded', 'EVALUATION_FAILED', 'Project evaluator did not succeed');
  C.check(raw.coverage && raw.coverage.expected === expectedIds.length && raw.coverage.completed === expectedIds.length && raw.coverage.failed === 0,
    'INCOMPLETE_COVERAGE', 'Evaluation did not cover every required case');
  C.check(Array.isArray(raw.case_ids) && new Set(raw.case_ids).size === expectedIds.length && raw.case_ids.length === expectedIds.length &&
    expectedIds.every(id => raw.case_ids.includes(id)), 'INCOMPLETE_COVERAGE', 'Evaluated case identities differ');
  for (const metric of contract.task.metrics) C.check(ratio(raw.metrics?.[metric]), 'INVALID_METRIC', 'Invalid ratio metric', { metric });
  C.check(raw.usage && Number.isSafeInteger(raw.usage.target_calls) && raw.usage.target_calls >= 0 &&
    raw.usage.target_calls <= request.max_target_calls, 'BUDGET_VIOLATION', 'Target usage missing or exceeds reserved bound');
  C.check(raw.usage.simulated_calls === undefined || (Number.isSafeInteger(raw.usage.simulated_calls) && raw.usage.simulated_calls >= 0), 'INVALID_RESULT', 'Invalid simulated usage');
  if (raw.cases) {
    C.check(Array.isArray(raw.cases) && raw.cases.every(c => expectedIds.includes(c.case_id)) &&
      new Set(raw.cases.map(c => c.case_id)).size === raw.cases.length, 'INVALID_RESULT', 'Invalid case evidence identities');
  }
}
function baselineReady(store) {
  const state = S.state(store), root = state.derivations[0].version_id, tolerance = store.contract.task.baseline_tolerance || 0;
  for (const split of ['search','validation']) {
    const run = Object.values(state.runs).find(r => r.kind === 'baseline' && r.version_id === root && r.split === split && r.status === 'succeeded');
    if (!run) return false;
    if (store.contract.project.original_evaluate_argv) {
      const original = Object.values(state.runs).find(r => r.kind === 'original' && r.version_id === root && r.split === split && r.status === 'succeeded');
      if (!original) return false;
      for (const metric of store.contract.task.metrics) C.check(Math.abs(original.metrics[metric].value - run.metrics[metric].value) <= tolerance,
        'BASELINE_MISMATCH', 'Original and adapted baseline differ', { split, metric });
    }
  }
  return true;
}
function visibleResult(raw, contract, split) {
  const out = C.clone(raw);
  if (split !== 'search' || contract.task.evidence?.search_cases_visible !== true) delete out.cases;
  return out;
}
function settle(store, reservedRun, request, command) {
  const { root,contract } = store, { run_id:runId, version_id:versionId, reserved_calls:reserved } = reservedRun;
  const relative = 'runs/' + request.request_id, resultFile = C.inside(root, relative + '/result.json');
  const logs = S.blob(store, relative + '/diagnostics.json', { code:command.code, signal:command.signal, reason:command.reason,
    stdout:command.stdout, stderr:command.stderr });
  let raw, failure;
  try {
    C.check(command.code === 0 && !command.reason, 'RUNNER_FAILED', 'Evaluation command failed or timed out');
    C.check(fs.existsSync(resultFile), 'MISSING_RESULT', 'Evaluator did not write result JSON');
    raw = C.readJSON(resultFile);
    checkResult(raw, request, contract, contract.split_info[request.split].ids);
    environment(contract);
  } catch (error) { failure = error; }
  const artifacts = [logs];
  let resultPath = null;
  if (fs.existsSync(resultFile)) {
    resultPath = relative + '/result.json';
    artifacts.push({ path:resultPath, sha256:C.hash(fs.readFileSync(resultFile)) });
  }
  const uncertain = !!failure && contract.project.remote_effects !== false;
  const data = { run_id:runId, request_id:request.request_id, version_id:versionId, event_id:reservedRun.event_id,
    split:request.split, status:failure ? uncertain ? 'unknown' : 'failed' : 'succeeded',
    finished_at:new Date().toISOString(), wall_time_ms:Date.now() - Date.parse(reservedRun.started_at), result_path:resultPath,
    charged_calls:failure ? Math.max(reserved, Number.isSafeInteger(raw?.usage?.target_calls) && raw.usage.target_calls >= 0 ? raw.usage.target_calls : reserved) : raw.usage.target_calls, simulated_calls:failure ? null : raw.usage.simulated_calls || 0,
    metrics:failure ? null : raw.metrics, error:failure ? { code:failure.code || 'EVALUATION_FAILED', message:failure.message } : null };
  S.append(store, 'RESULT', data, artifacts);
  if (!failure && !S.state(store).baseline_checked && baselineReady(store)) S.append(store, 'BASELINE_CHECKED', {});
  return { ok:!failure, outcome:data.status, ...data, result:failure ? undefined : visibleResult(raw, contract, request.split) };
}
async function evaluate(input, lockedStore) {
  const root = path.resolve(input.run), release = lockedStore ? null : S.lock(root);
  try {
    const store = lockedStore || S.open(root), contract = store.contract, state = S.state(store);
    C.check(lockedStore || !contract.task.max_layers, 'LAYER_REQUIRED', 'Submit a whole layer for this experiment');
    C.check(!state.finalized, 'FINALIZED', 'Experiment is finalized');
    C.check(typeof input.requestId === 'string' && /^[A-Za-z0-9_.-]{1,96}$/.test(input.requestId), 'INVALID_REQUEST_ID', 'A stable --request-id is required');
    const requestSignature = C.hash({ candidate:input.candidate ? C.readJSON(input.candidate) : null,
      proposal:input.proposal ? C.readJSON(input.proposal) : null, baseline:!!input.baseline,
      original:!!input.original, split:input.split, repeat:!!input.repeat });
    const previous = store.events.find(e => e.type === 'ATTEMPT' && e.data.request_id === input.requestId);
    if (previous) {
      C.check(previous.data.signature === requestSignature, 'REQUEST_CONFLICT', 'request-id already used with different inputs');
      const prior = store.events.findLast(e => ['RESULT','REUSED','NO_CHANGE','REJECTED'].includes(e.type) && e.data.request_id === input.requestId);
      if (prior) {
        if (prior.type === 'RESULT' && prior.data.status === 'succeeded' && !state.baseline_checked && baselineReady(store))
          S.append(store,'BASELINE_CHECKED',{});
        return { ok:prior.type !== 'REJECTED' && (!prior.data.status || prior.data.status === 'succeeded'), idempotent:true, outcome:prior.type.toLowerCase(), ...prior.data };
      }
      const reserved = Object.values(state.runs).find(r => r.request_id === input.requestId);
      C.check(lockedStore, 'UNKNOWN_EXECUTION','Earlier request has no confirmed outcome');
      if (reserved) {
        const request = C.readJSON(C.inside(root,'runs/'+input.requestId+'/request.json'));
        const command = await require('./supervisor.cjs').receipt(root,reserved);
        return settle(store,reserved,request,command);
      }
      // No reservation means the evaluator could never have been dispatched.
    }
    C.check(!state.pending.length, 'UNKNOWN_EXECUTION', 'An execution is unconfirmed; reconcile before another call', { run_ids:state.pending.map(r => r.run_id) });
    environment(contract);
    C.check(['search','validation'].includes(input.split), 'INVALID_SPLIT', 'Probe only supports search and validation');
    C.check(!input.original || (input.baseline && contract.project.original_evaluate_argv), 'INVALID_INPUT', 'Original evaluation requires baseline and original_evaluate_argv');
    C.check(input.baseline || state.baseline_checked, 'BASELINE_REQUIRED', 'Complete baseline search and validation first');
    C.check(previous || state.attempts < contract.task.budget.max_attempts, 'BUDGET_EXHAUSTED', 'Attempt budget exhausted');
    C.check(Date.now() < Date.parse(contract.deadline_at), 'BUDGET_EXHAUSTED', 'Experiment deadline reached');
    if (!previous) S.append(store, 'ATTEMPT', { request_id:input.requestId, signature:requestSignature });
    const baselineVersion = loadVersion(store, state.derivations[0].version_id);
    let candidate, proposal, template, versionId, derivation, parentVersion, changedPath;
    try {
      candidate = input.baseline ? baselineVersion.candidate : C.readJSON(input.candidate);
      C.validateCandidate(candidate, contract.baseline, contract.policy);
      if (!input.baseline) {
        C.check(input.proposal, 'INVALID_PROPOSAL', 'Candidate evaluation requires --proposal');
        proposal = C.readJSON(input.proposal);
        const parent = state.derivations.find(e => e.event_id === proposal.parent_event_id);
        C.check(parent && ['hypothesis','expected_effect','regression_risk','operator'].every(k => typeof proposal[k] === 'string' && proposal[k].length),
          'INVALID_PROPOSAL', 'Parent, hypothesis, expected effect, risk and operator are required');
        parentVersion = loadVersion(store, parent.version_id);
        const paths = [...contract.policy.editable_paths, ...Object.keys(contract.policy.selectable || {})];
        const changed = paths.filter(p => JSON.stringify(C.pointer(parentVersion.candidate, p).value) !== JSON.stringify(C.pointer(candidate, p).value));
        C.check(changed.length <= 1, 'NON_ATOMIC_EDIT', 'Change only one editable path per parent branch', { paths:changed });
        [changedPath] = changed;
        C.check(Array.isArray(proposal.evidence_refs) && proposal.evidence_refs.length && Array.isArray(proposal.rule_refs) && proposal.rule_refs.length,
          'INVALID_PROPOSAL', 'Search failure and business rule references are required');
        for (const ref of proposal.evidence_refs) {
          const [runId, caseId, extra] = String(ref).split('/');
          const run = state.runs[runId];
          C.check(!extra && run?.status === 'succeeded' && run.split === 'search' && run.version_id === parent.version_id,
            'INVALID_EVIDENCE', 'Evidence must come from the actual parent search run');
          const evidence = C.readJSON(C.inside(root, run.result_path)).cases?.find(c => c.case_id === caseId);
          C.check(evidence && evidence.failed === true, 'INVALID_EVIDENCE', 'Referenced case is not a recorded parent failure');
        }
        for (const rule of proposal.rule_refs) C.check(contract.task.rules?.some(r => r.id === rule.id && r.version === rule.version && r.source === rule.source), 'INVALID_RULE', 'Rule reference is not in the frozen approved rules');
        C.check((proposal.secondary_source_ids || []).every(id => state.derivations.some(d => d.event_id === id)), 'INVALID_PROPOSAL', 'Unknown secondary source');
      }
      const requestDir = 'runs/' + input.requestId;
      const candidateFile = C.inside(root, requestDir + '/candidate.json');
      C.immutable(candidateFile, JSON.stringify(candidate, null, 2) + '\n');
      template = await rendered(contract.project, candidateFile, C.inside(root, requestDir + '/rendered.json'),
        Math.min(contract.project.runner_timeout_seconds * 1000, Date.parse(contract.deadline_at) - Date.now()));
      if (!input.baseline) {
        const parent = state.derivations.find(d => d.event_id === proposal.parent_event_id);
        if (JSON.stringify(template) === JSON.stringify(parentVersion.rendered)) {
          S.append(store, 'NO_CHANGE', { request_id:input.requestId, parent_event_id:parent.event_id });
          return { ok:true, outcome:'no_change', request_id:input.requestId };
        }
        const before = parentVersion.rendered.messages, after = template.messages;
        C.check(before.length === after.length && before.every((m,i) => m.role === after[i].role),
          'NON_ATOMIC_EDIT', 'Keep message roles and order fixed');
        const edits = before.map((m,i) => [m.content, after[i].content]).filter(([a,b]) => a !== b);
        C.check(changedPath && edits.length === 1, 'NON_ATOMIC_EDIT', 'Change one effective message per branch');
        C.check(hasSingleHunk(...edits[0]), 'NON_ATOMIC_EDIT', 'Split separated line edits into independent branches');
      }
      versionId = registerVersion(store, candidate, template);
      if (input.baseline) derivation = state.derivations[0];
      else {
        const proposalHash = C.hash(proposal);
        derivation = state.derivations.find(d => d.proposal_hash === proposalHash && d.version_id === versionId);
        if (!derivation) {
          const attempt = store.events.findLast(e=>e.type==='ATTEMPT' && e.data.request_id===input.requestId);
          const registeredHere = store.events.some(e=>e.seq>attempt.seq && e.type==='VERSION' && e.data.version_id===versionId);
          derivation = { ...proposal, edit_size:editSize(promptText(parentVersion.rendered), promptText(template)), changed_path:changedPath, proposal_hash:proposalHash, event_id:'E-' + String(state.derivations.length).padStart(3, '0'), version_id:versionId,
            kind:registeredHere ? 'candidate' : 'reference', created_at:attempt.at };
          const artifact = S.blob(store, 'proposals/' + derivation.event_id + '.json', derivation);
          S.append(store, 'DERIVATION', derivation, [artifact]);
        }
        if (state.phase !== 'searching') S.append(store, 'SEARCH_STARTED', {});
      }
    } catch (error) {
      S.append(store, 'REJECTED', { request_id:input.requestId, code:error.code || 'INVALID_INPUT' });
      throw error;
    }
    const key = C.hash({ contract_hash:contract.contract_hash, version_id:versionId, split:input.split, kind:input.original ? 'original' : 'evaluation' });
    const current = S.state(store), cached = Object.values(current.runs).find(r => r.evaluation_key === key && r.status === 'succeeded');
    if (cached && !input.repeat && contract.task.allow_cache === true) {
      const data = { request_id:input.requestId, run_id:cached.run_id, version_id:versionId, event_id:derivation.event_id, source_run_id:cached.run_id };
      S.append(store, 'REUSED', data);
      return { ok:true, outcome:'reused', ...data, result:visibleResult(C.readJSON(C.inside(root, cached.result_path)), contract, input.split) };
    }
    const used = usage(store), reserved = contract.split_info[input.split].count * contract.project.target_calls_per_case_bound;
    const callLimit = contract.task.budget.max_target_calls;
    if (used.evaluations >= contract.task.budget.max_evaluations || (callLimit !== undefined && used.target_calls + reserved > callLimit) || Date.now() >= Date.parse(contract.deadline_at)) {
      S.append(store, 'REJECTED', { request_id:input.requestId, code:'BUDGET_EXHAUSTED' });
      throw new C.ToolError('BUDGET_EXHAUSTED', 'Insufficient evaluation, call or time budget');
    }
    environment(contract);
    const relative = 'runs/' + input.requestId;
    const runId = 'RUN-' + (lockedStore ? C.hash([contract.experiment_id,input.requestId,requestSignature]) : crypto.randomUUID());
    const resultFile = C.inside(root, relative + '/result.json'), requestFile = C.inside(root, relative + '/request.json');
    const request = { schema_version:'prompttree-request-v1', run_id:runId, request_id:input.requestId,
      contract_hash:contract.contract_hash, version_id:versionId, template_hash:C.hash(template),
      execution_kind:contract.project.execution_kind, split:input.split, expected_case_ids:contract.split_info[input.split].ids,
      max_target_calls:reserved };
    const requestArtifact = S.blob(store, relative + '/request.json', request);
    const nativeArtifact = { path:relative + '/candidate.json', sha256:C.hash(fs.readFileSync(C.inside(root, relative + '/candidate.json'))) };
    S.append(store, 'RESERVED', { run_id:runId, request_id:input.requestId, version_id:versionId, event_id:derivation.event_id,
      evaluation_key:key, kind:input.original ? 'original' : input.baseline ? 'baseline' : 'candidate',
      split:input.split, reserved_calls:reserved, started_at:new Date().toISOString() }, [requestArtifact, nativeArtifact]);
    const reservedRun = S.state(store).runs[runId];
    if (lockedStore) {
      const supervisor = require('./supervisor.cjs');
      await supervisor.launch(root,input.requestId);
      return settle(store,reservedRun,request,await supervisor.receipt(root,reservedRun));
    }
    const command = await R.execute(input.original ? contract.project.original_evaluate_argv : contract.project.evaluate_argv,
      { candidate_file:C.inside(root, relative + '/candidate.json'), dataset_file:contract.task.datasets[input.split].path,
        result_file:resultFile, request_file:requestFile, max_target_calls:reserved },
      options(contract, Date.parse(contract.deadline_at) - Date.now()));
    return settle(store,reservedRun,request,command);
  } finally { release?.(); }
}
function finalize(input) {
  const root = path.resolve(input.run), release = S.lock(root);
  try {
    const store = S.open(root), state = S.state(store);
    if (state.finalized) {
      C.check((!input.version || input.version === state.finalized.version_id) && (!input.reason || input.reason === state.finalized.stop_reason),
        'FINALIZED', 'Final selection is immutable');
      if (input.retest) {
        C.check(state.finalized.validation_retest && C.hash(state.finalized.validation_retest) ===
          C.hash(require('./retest.cjs').summarizeRetest(store,input.retest)), 'FINALIZED', 'Final retest evidence is immutable');
      }
      return require('./report.cjs').exportReport(store);
    }
    C.check(!state.pending.length, 'UNKNOWN_EXECUTION', 'Unconfirmed executions prevent finalization');
    C.check(state.baseline_checked, 'BASELINE_REQUIRED', 'Complete comparable baseline before finalization');
    C.check(input.version && state.versions[input.version], 'UNKNOWN_VERSION', 'A selected --version is required');
    C.check(STOP_REASONS.includes(input.reason), 'INVALID_STOP_REASON', 'Explicit --reason is required', { allowed:STOP_REASONS });
    let closureReview;
    if (store.contract.task.max_layers) {
      const L = require('./layers.cjs');
      const layers = L.snapshot(store);
      const last = layers.at(-1);
      const depth = L.depthReview(store, layers);
      const atDepthLimit = depth.capped.length > 0;
      C.check(input.reason !== 'depth_limit' || atDepthLimit, 'LAYER_INCOMPLETE', 'Tree has not reached the agreed depth');
      C.check(['completed','partial'].includes(last?.status) && (atDepthLimit ||
        !last.nodes.some(n => n.status === 'completed') || ['budget_exhausted','target_reached','operator_stop','cancelled','plateau'].includes(input.reason)),
        'LAYER_INCOMPLETE', 'Finish the batch and record the stopping decision');
      if (depth.required && ['depth_limit','plateau','no_valid_candidate'].includes(input.reason)) {
        C.check(input.reason !== 'depth_limit' && input.review, 'TREE_REVIEW_REQUIRED',
          'Run tree-review, revisit supported directions, or finalize with a reviewed plateau or no_valid_candidate decision');
        const audit = L.treeReview(store, layers), decision = C.readJSON(path.resolve(input.review));
        const entries = decision.nodes;
        C.check(decision.snapshot_id === audit.snapshot_id && Array.isArray(entries) && entries.length === audit.nodes.length,
          'INVALID_TREE_REVIEW', 'Review the current snapshot and cover every completed node once');
        const byId = new Map(entries.map(e => [e?.id,e]));
        C.check(audit.nodes.every(n => {
          const e = byId.get(n.id);
          return e?.decision === (n.can_branch ? 'close' : 'depth_limit') && typeof e.reason === 'string' && e.reason.trim();
        }), 'INVALID_TREE_REVIEW', 'Resolve remaining directions by layer-submit and explain the final disposition of each node');
        closureReview = {snapshot_id:audit.snapshot_id,round:audit.round,nodes:entries.map(({id,decision,reason}) => ({id,decision,reason}))};
      }
      C.check(layers.some(layer => layer.nodes.some(n => n.status === 'completed' && n.version_id === input.version)),
        'VALIDATION_REQUIRED', 'Select a version from a completed node');
    }
    const retest = input.retest ? require('./retest.cjs').summarizeRetest(store,input.retest) : null;
    C.check(!retest || retest.version_id === input.version, 'RETEST_SELECTION_MISMATCH', 'Select the version chosen by the frozen retest policy');
    const comparable = Object.values(state.runs).find(r => r.kind !== 'original' && r.version_id === input.version && r.split === 'validation' && r.status === 'succeeded');
    C.check(comparable, 'VALIDATION_REQUIRED', 'Selected version needs a complete validation result');
    S.append(store, 'FINALIZED', { version_id:input.version, selected_run_id:comparable.run_id,
      stop_reason:input.reason, ...(retest && {validation_retest:retest}), ...(closureReview && {tree_review:closureReview}), test_status:'not_tested', release_decision:null });
    return require('./report.cjs').exportReport(store);
  } finally { release(); }
}
module.exports = { prepare, evaluate, finalize, status, usage, loadVersion, softwareHash, STOP_REASONS };
