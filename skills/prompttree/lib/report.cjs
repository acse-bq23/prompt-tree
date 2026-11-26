'use strict';
const fs = require('node:fs');
const path = require('node:path');
const C = require('./core.cjs');
const S = require('./store.cjs');

const { inBand } = require('./retest.cjs');
const { promptText, editSize } = require('./edit-size.cjs');
function diff(oldText, newText) {
  return diffArrays(oldText ? oldText.split('\n') : [], newText ? newText.split('\n') : []);
}
function diffArrays(a, b) {
  const out = [];
  if (!a.length || !b.length) return [...a.map(text => ({ kind:'remove', text })), ...b.map(text => ({ kind:'add', text }))];
  if (a.length * b.length > 2000000) {
    const shorter = Math.min(a.length, b.length);
    let start = 0, end = 0;
    while (start < shorter && a[start] === b[start]) start++;
    while (end < shorter - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
    if (!start && !end) return [...a.map(text => ({ kind:'remove', text })), ...b.map(text => ({ kind:'add', text }))];
    const same = text => ({ kind:'same', text });
    return [...a.slice(0,start).map(same), ...diffArrays(a.slice(start,a.length-end), b.slice(start,b.length-end)), ...a.slice(a.length-end).map(same)];
  }
  const table = Array.from({ length:a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ kind:'same', text:a[i] }); i++; j++; }
    else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) out.push({ kind:'add', text:b[j++] });
    else out.push({ kind:'remove', text:a[i++] });
  }
  return out;
}
function patch(oldText, newText, target) {
  const tokens = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const oldLines = tokens(oldText), newLines = tokens(newText), lines = diffArrays(oldLines, newLines);
  const result = ['--- a/' + target, '+++ b/' + target,
    '@@ -' + (oldLines.length ? 1 : 0) + ',' + oldLines.length + ' +' + (newLines.length ? 1 : 0) + ',' + newLines.length + ' @@'];
  for (const line of lines) {
    const complete = line.text.endsWith('\n');
    result.push((line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ') + (complete ? line.text.slice(0, -1) : line.text));
    if (!complete) result.push('\\ No newline at end of file');
  }
  return result.join('\n') + '\n';
}
function exportReport(store) {
  const W = require('./workflow.cjs'), state = S.state(store), { contract } = store;
  C.check(state.finalized, 'NOT_FINALIZED', 'Finalize the selection before export');
  const selected = state.finalized, baselineId = state.derivations[0].version_id;
  const runs = Object.values(state.runs), baseline = runs.find(r => r.version_id === baselineId && r.kind === 'baseline' && r.split === 'validation' && r.status === 'succeeded');
  const chosen = state.runs[selected.selected_run_id], metric = contract.task.primary_metric;
  const comparison = { metric, baseline:baseline.metrics[metric], candidate:chosen.metrics[metric],
    delta:chosen.metrics[metric].value - baseline.metrics[metric].value, split:'validation' };
  const output = path.join(store.root, 'output');
  const workspace = contract.project.workspace;
  const sources = contract.files.map(entry => ({ file:path.relative(workspace, entry.file), sha256:entry.sha256 }));
  const source = file => sources.find(entry => entry.file === path.relative(workspace, path.resolve(workspace, file)));
  const baselineSource = {
    version_id:baselineId,
    prompt_entry:source(contract.project.prompt_entry),
    prompt_sources:(contract.project.prompt_sources || [contract.project.prompt_entry]).map(source),
    accuracy_report:contract.project.baseline_accuracy_report ? source(contract.project.baseline_accuracy_report) : null
  };
  const testPanel = store.events.findLast(e => e.type === 'PROJECT_TEST_REPORT')?.data;
  const manifest = { schema_version:'prompttree-probe-result-v1', tool_version:C.VERSION,
    project_id:contract.project.project_id, experiment_id:contract.experiment_id, contract_hash:contract.contract_hash, software_hash:contract.software_hash,
    execution_profile:contract.project.execution_profile || null,
    execution_kind:contract.project.execution_kind, objective:contract.task.objective, mode:'probe',
    created_at:contract.created_at, ...selected, ...(testPanel && {test_status:'project_reported', independent_test:testPanel}), comparison, usage:W.usage(store), limits:contract.task.budget,
    counts:{ attempts:state.attempts, derivations:state.derivations.length, versions:Object.keys(state.versions).length,
      evaluations:runs.length, cache_reuses:state.reused },
    limitations:[
      testPanel ? 'Prompt selection used validation. Project test results were attached after selection.' : 'Validation findings are exploratory; independent test has not run.',
      'Same-account file access is not an independent security boundary.',
      ...(contract.project.call_bound_kind === 'declared' ? ['Declared project call bounds are not enforced by a provider gateway.'] : []),
      'Repeated evaluations are listed separately; comparison uses the selected first complete validation run.',
      ...[...new Set([baseline, chosen].flatMap(run => run.result_path ? C.readJSON(C.inside(store.root, run.result_path)).limitations || [] : []))].filter(text => typeof text === 'string'),
      ...(contract.project.execution_kind === 'mock' ? ['Model responses and datasets are simulated; score deltas do not demonstrate business improvement.'] : [])
    ],
    baseline_source:baselineSource, source_fingerprints:sources };
  const derived = state.derivations.map(event => {
    const version = W.loadVersion(store, event.version_id);
    const parent = state.derivations.find(e => e.event_id === event.parent_event_id);
    const parentText = parent ? promptText(W.loadVersion(store, parent.version_id).rendered) : '';
    const linkedRuns = runs.filter(r => r.version_id === event.version_id);
    const evidence = event.evidence_refs.map(ref => {
      const [runId, caseId] = ref.split('/'), r = state.runs[runId];
      const found = r?.result_path ? C.readJSON(C.inside(store.root, r.result_path)).cases?.find(c => c.case_id === caseId) : null;
      return contract.task.evidence?.export_search_cases === true ? { reference:ref, ...(found || {}) } : { reference:ref, details:'Retained in local search evaluation; content export disabled.' };
    });
    return { ...event, prompt:promptText(version.rendered), diff:diff(parentText, promptText(version.rendered)),
      runs:linkedRuns, evidence };
  });
  const attempts = store.events.filter(e => ['NO_CHANGE','REJECTED','REUSED'].includes(e.type)).map(e => ({ type:e.type, ...e.data }));
  const layers = require('./layers.cjs').snapshot(store);
  const nodes = layers.length ? layers.flatMap(layer => layer.nodes.map(node => {
    const attempted = runs.filter(r => r.request_id.startsWith(node.id + '-'));
    const eventId = node.event_id || attempted[0]?.event_id;
    const existing = derived.find(d => d.event_id === eventId);
    const fallback = { event_id:node.id, parent_event_id:node.parent_event_id, kind:'candidate',
      version_id:'', hypothesis:node.label, prompt:'', diff:[], runs:attempted, evidence:[] };
    const linked = [...attempted];
    for (const id of [node.search_run_id,node.validation_run_id]) {
      if (id && !linked.some(r=>r.run_id===id)) linked.push({ ...state.runs[id], reused:true });
    }
    return { ...(existing || fallback), runs:linked, level:node.depth, round:node.round, deferred_reason:node.deferred_reason, revisit_reason:node.revisit_reason, batch_status:layer.status, node_id:node.id,
      status:node.status, branch:node.branch, reason:node.reason, selected:node.selected };
  })) : derived;
  const model = { schema_version:'prompttree-probe-report-v1', manifest, nodes, attempts,
    layers:layers.map(({ level,status,nodes }) => ({ level,status,count:nodes.length })) };
  if (contract.task.evidence?.export_validation_comparison === true) {
    model.validation_cases = validationCases(nodes, store.root);
    if (contract.task.evidence.validation_history_field) {
      model.validation_histories = validationHistories(contract.task.datasets.validation, contract.task.evidence.validation_history_field, model.validation_cases);
    }
  }
  C.writeJSON(path.join(output, 'manifest.json'), manifest);
  C.writeJSON(path.join(output, 'evolution.json'), model);
  const best = W.loadVersion(store, selected.version_id);
  C.writeJSON(path.join(output, 'optimized-prompt/prompt.json'), best.candidate);
  C.writeJSON(path.join(output, 'optimized-prompt/rendered.json'), best.rendered);
  C.writeJSON(path.join(output, 'optimized-prompt/baseline.json'), W.loadVersion(store, baselineId).candidate);
  C.atomic(path.join(output, 'optimized-prompt/prompt.txt'), promptText(best.rendered) + '\n');
  if (contract.project.delivery) {
    const delivery = contract.project.delivery;
    const oldText = C.pointer(W.loadVersion(store, baselineId).candidate, delivery.prompt_pointer).value;
    const newText = C.pointer(best.candidate, delivery.prompt_pointer).value;
    C.check(typeof newText === 'string', 'INVALID_TEMPLATE', 'Native delivery content is not text');
    C.atomic(C.inside(output, 'optimized-prompt/' + delivery.target_path), newText);
    if (oldText !== newText) C.atomic(path.join(output, 'integration.patch'), patch(oldText, newText, delivery.target_path));
  }
  for (const run of runs) {
    if (!run.result_path) continue;
    const raw = C.readJSON(C.inside(store.root, run.result_path));
    if (run.split !== 'search' || contract.task.evidence?.export_search_cases !== true) delete raw.cases;
    C.writeJSON(path.join(output, 'evaluations/' + run.run_id + '.json'), raw);
  }
  const title = contract.project.execution_kind === 'mock' ? '模拟 Probe' : 'Probe';
  const summary = '# ' + contract.project.project_id + ' · ' + title + '\n\n' +
    '- Prompt 源文件：' + baselineSource.prompt_sources.map(item => item.file).join('、') + '\n' +
    (baselineSource.accuracy_report ? '- 项目基线报告：' + baselineSource.accuracy_report.file + '\n' : '') +
    '- 停止原因：' + selected.stop_reason + '\n- 目标：' + contract.task.objective + '\n' +
    '- 验证指标：' + metric + '；基准 ' + (comparison.baseline.value * 100).toFixed(2) +
    '% → 候选 ' + (comparison.candidate.value * 100).toFixed(2) + '%\n' +
    (selected.validation_retest ? '- 锁版复测：' + selected.validation_retest.selected + '，' + selected.validation_retest.rounds + ' 轮平均 ' + (100*(selected.validation_retest.decision?.selected_mean ?? selected.validation_retest.ranking[0].mean)).toFixed(2) + '%，复测回执记录 ' + selected.validation_retest.target_calls + ' 次请求。\n' : '') +
    (testPanel ? '- 项目独立测试：每版 ' + testPanel.rounds + ' 轮，每轮 ' + testPanel.cases + ' 题，详见树节点。\n' : '- 独立测试：not_tested；正式验收：未判定。\n') +
    '- 目标模型真实调用：' + manifest.usage.target_calls + '；模拟调用：' + manifest.usage.simulated_calls +
    '；宿主推理用量不可得。\n\n' +
    (contract.project.execution_kind === 'mock' ? '本次数据和模型响应为模拟，分数变化仅用于验证工具链。\n\n' : '') +
    '完整内容位于 optimized-prompt/，含候选与基准快照。按项目已验证的候选入口接入；若有原生文本及 integration.patch，先在隔离副本核对补丁和原流程，回退时恢复基准。未自动修改原项目或发布。\n\n' +
    '结果以 manifest.json 与 evolution.json 为准。保留本地实验目录可查询完整运行与证据；可分享报告只导出合同允许的内容。\n';
  C.atomic(path.join(output, 'summary.md'), summary);
  C.atomic(path.join(output, 'report.html'), renderHTML(model));
  const englishReport = path.join(output, 'report.en.html');
  C.atomic(englishReport, renderHTML(model, 'en'));
  return { ok:true, phase:'finalized', output, manifest, report:path.join(output, 'report.html'), report_en:englishReport };
}
function validationCases(nodes, root) {
  const records = {};
  for (const node of nodes) {
    const run = node.runs.find(r => r.kind !== 'original' && r.split === 'validation' && r.status === 'succeeded');
    if (!run?.result_path || records[run.run_id]) continue;
    const raw = C.readJSON(C.inside(root, run.result_path));
    const cases = raw.cases;
    if (!Array.isArray(cases) || cases.length !== raw.case_ids.length ||
        cases.some(c => typeof c.failed !== 'boolean')) continue;
    records[run.run_id] = cases.map(({ case_id, failed, prediction, expected }) => ({ case_id, failed, prediction, expected }));
  }
  return records;
}
function validationHistories(dataset, field, cases) {
  const idField = dataset.id_field || 'case_id';
  const wanted = new Set(Object.values(cases).flat().map(c => c.case_id));
  const histories = Object.create(null);
  for (const row of C.dataset(dataset.path, idField, true)) {
    const turns = row[field];
    if (!wanted.has(row[idField]) || !Array.isArray(turns) || !turns.every(t =>
      t && typeof t.role === 'string' && typeof (t.text ?? t.content) === 'string')) continue;
    histories[row[idField]] = turns.map(t => ({ role:t.role, text:t.text ?? t.content,
      ...(typeof t.action === 'string' ? { action:t.action } : {}) }));
  }
  return histories;
}
function renderHTML(model, language = 'zh-CN', captions = {}) {
  C.check(['zh-CN','en'].includes(language), 'INVALID_REPORT_LANGUAGE', 'Expected zh-CN or en');
  const english = language === 'en' ? require('../assets/report.en.json') : null;
  function translate(label) {
    if (!english) return label;
    C.check(Object.hasOwn(english,label), 'INVALID_REPORT_ASSET', 'Missing English report label', {label});
    return english[label];
  }
  const logo = fs.readFileSync(path.join(__dirname, '../assets/prompt-tree-mark.png'), 'base64');
  const template = fs.readFileSync(path.join(__dirname, '../assets/report.html'), 'utf8')
    .replace('<html lang="zh-CN">', '<html lang="' + language + '">')
    .replace(/'\{\{((?:\{\d+\}|[^{}'\n])+?)\}\}'/g, (_, label) => JSON.stringify(translate(label)))
    .replace(/\{\{((?:\{\d+\}|[^{}\n])+?)\}\}/g, (_, label) => translate(label)
      .replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;'))
    .replace('REPORT_LOGO_BASE64', logo);
  const parents = new Map(model.nodes.map(n => [n.event_id, n]));
  const nodes = model.nodes.map(n => {
    const parent = parents.get(n.parent_event_id);
    return parent && n.version_id && !n.edit_size
      ? { ...n, edit_size:editSize(parent.prompt, n.prompt) } : n;
  });
  const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  C.check(template.includes('REPORT_DATA'), 'INVALID_REPORT_ASSET', 'Portable report template missing');
  return template.replace('/* REPORT_DIFF_FUNCTIONS */', () => [diffArrays, diff, inBand].join('\n')).replace('REPORT_CAPTIONS', () => scriptJSON(captions)).replace('REPORT_DATA', () => scriptJSON({ ...model, nodes }));
}
module.exports = { exportReport, renderHTML, validationCases, validationHistories, diff, patch, promptText };
