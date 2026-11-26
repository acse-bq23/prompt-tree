'use strict';
const fs = require('node:fs');
const path = require('node:path');
const C = require('./core.cjs');
const S = require('./store.cjs');

function promptText(template) { return template.messages.map(m => '[' + m.role.toUpperCase() + ']\n' + m.content).join('\n\n'); }
function diff(oldText, newText) {
  return diffArrays(oldText ? oldText.split('\n') : [], newText.split('\n'));
}
function diffArrays(a, b) {
  const out = [];
  if (a.length * b.length > 2000000) return [...a.map(text => ({ kind:'remove', text })), ...b.map(text => ({ kind:'add', text }))];
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
  const manifest = { schema_version:'prompttree-probe-result-v1', tool_version:C.VERSION,
    project_id:contract.project.project_id, experiment_id:contract.experiment_id, contract_hash:contract.contract_hash, software_hash:contract.software_hash,
    execution_profile:contract.project.execution_profile || null,
    execution_kind:contract.project.execution_kind, objective:contract.task.objective, mode:'probe',
    created_at:contract.created_at, ...selected, comparison, usage:W.usage(store), limits:contract.task.budget,
    counts:{ attempts:state.attempts, derivations:state.derivations.length, versions:Object.keys(state.versions).length,
      evaluations:runs.length, cache_reuses:state.reused },
    limitations:[
      'Validation findings are exploratory; independent test has not run.',
      'Same-account file access is not an independent security boundary.',
      ...(contract.project.call_bound_kind === 'declared' ? ['Declared project call bounds are not enforced by a provider gateway.'] : []),
      'Repeated evaluations are listed separately; comparison uses the selected first complete validation run.',
      ...[...new Set([baseline, chosen].flatMap(run => run.result_path ? C.readJSON(C.inside(store.root, run.result_path)).limitations || [] : []))].filter(text => typeof text === 'string'),
      ...(contract.project.execution_kind === 'mock' ? ['Model responses and datasets are simulated; score deltas do not demonstrate business improvement.'] : [])
    ],
    source_fingerprints:contract.files.map(f => ({ file:path.basename(f.file), sha256:f.sha256 })) };
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
    return { ...(existing || fallback), runs:linked, level:layer.level, batch_status:layer.status, node_id:node.id,
      status:node.status, branch:node.branch, reason:node.reason, selected:node.selected };
  })) : derived;
  const model = { schema_version:'prompttree-probe-report-v1', manifest, nodes, attempts,
    layers:layers.map(({ level,status,nodes }) => ({ level,status,count:nodes.length })) };
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
    '- 停止原因：' + selected.stop_reason + '\n- 目标：' + contract.task.objective + '\n' +
    '- 验证指标：' + metric + '；基准 ' + (comparison.baseline.value * 100).toFixed(2) +
    '% → 候选 ' + (comparison.candidate.value * 100).toFixed(2) + '%\n' +
    '- 独立测试：not_tested；正式验收：未判定。\n' +
    '- 目标模型真实调用：' + manifest.usage.target_calls + '；模拟调用：' + manifest.usage.simulated_calls +
    '；宿主推理用量不可得。\n\n' +
    (contract.project.execution_kind === 'mock' ? '本次数据和模型响应为模拟，分数变化仅用于验证工具链。\n\n' : '') +
    '完整内容位于 optimized-prompt/，含候选与基准快照。按项目已验证的候选入口接入；若有原生文本及 integration.patch，先在隔离副本核对补丁和原流程，回退时恢复基准。未自动修改原项目或发布。\n\n' +
    '结果以 manifest.json 与 evolution.json 为准。保留本地实验目录可查询完整运行与证据；可分享报告只导出合同允许的内容。\n';
  C.atomic(path.join(output, 'summary.md'), summary);
  const logo = fs.readFileSync(path.join(__dirname, '../assets/prompt-tree-mark.png'), 'base64');
  const template = fs.readFileSync(path.join(__dirname, '../assets/report.html'), 'utf8')
    .replace('REPORT_LOGO_BASE64', logo);
  const serialized = JSON.stringify(model).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  C.check(template.includes('REPORT_DATA'), 'INVALID_REPORT_ASSET', 'Portable report template missing');
  C.atomic(path.join(output, 'report.html'), template.replace('REPORT_DATA', () => serialized));
  return { ok:true, phase:'finalized', output, manifest, report:path.join(output, 'report.html') };
}
module.exports = { exportReport, diff, patch, promptText };
