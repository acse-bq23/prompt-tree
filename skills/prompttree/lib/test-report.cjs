'use strict';
const path = require('node:path');
const C = require('./core.cjs');
const S = require('./store.cjs');

function attachTestReport(run, planFile) {
  const root = path.resolve(run), release = S.lock(root);
  try {
    const store = S.open(root), state = S.state(store);
    C.check(state.finalized, 'NOT_FINALIZED', 'Lock the validation selection before attaching independent test results');
    const plan = C.readJSON(planFile), base = path.dirname(path.resolve(planFile));
    const metric = store.contract.task.primary_metric;
    const check = (ok, message) => C.check(ok, 'INVALID_TEST_REPORT', message);
    check(plan.experiment === store.contract.experiment_id && plan.metric === metric &&
      Number.isSafeInteger(plan.rounds) && plan.rounds > 0 && Array.isArray(plan.indexes) && plan.indexes.length, 'Check experiment, metric, rounds and receipt indexes');
    const {ids} = C.dataset(path.resolve(base,plan.dataset), plan.id_field || 'case_id');
    const development = new Set(Object.values(store.contract.split_info).flatMap(s => s.ids));
    check(ids.every(id => !development.has(id)), 'Test cases must be unique and disjoint from development splits');
    const datasetHash = C.hash(ids), versions = new Map(), templates = new Map();
    const requests = new Set(Object.values(state.runs).map(r => r.request_id));
    const validation = state.finalized.validation_retest;
    for (const row of validation?.ranking || []) for (const s of row.scores) requests.add(s.request_id);
    for (const file of plan.indexes) {
      const index = C.readJSON(C.inside(base,file));
      check(Array.isArray(index.receipts) && index.receipts.length, 'Expected test receipts');
      for (const entry of index.receipts) {
        const version = entry.version_id, round = entry.round;
        check(Object.hasOwn(state.versions,version) && Number.isInteger(round) && round >= 1 && round <= plan.rounds, 'Unknown test version or round');
        if (!templates.has(version)) templates.set(version,C.hash(require('./workflow.cjs').loadVersion(store,version).rendered));
        const r = C.readJSON(C.inside(base,entry.result)), m = r.metrics?.[metric];
        check(r.version_id === version && r.template_hash === templates.get(version) &&
          r.execution_kind === 'real' && r.status === 'succeeded' && r.split === 'test' && Array.isArray(r.case_ids) &&
          C.hash(r.case_ids) === datasetHash && r.coverage?.expected === ids.length && r.coverage.completed === ids.length && r.coverage.failed === 0,
          'Test receipt must match the prompt and cover the same complete test set');
        check(typeof r.request_id === 'string' && r.request_id.length && !requests.has(r.request_id) &&
          Number.isSafeInteger(r.usage?.target_calls) && r.usage.target_calls > 0, 'Expected distinct fresh test requests');
        requests.add(r.request_id);
        check(Number.isFinite(m?.value) && Number.isSafeInteger(m.denominator) && m.denominator > 0 && Number.isSafeInteger(m.numerator) &&
          m.numerator >= 0 && m.numerator <= m.denominator && Math.abs(m.value - m.numerator/m.denominator) < 1e-10, 'Invalid test metric');
        if (!versions.has(version)) versions.set(version,Array(plan.rounds).fill(null));
        const scores = versions.get(version);
        check(!scores[round-1], 'Duplicate test version and round');
        scores[round-1] = {numerator:m.numerator,denominator:m.denominator,receipt_hash:C.hash(r)};
      }
    }
    const rows = Array.from(versions, ([version_id,scores]) => {
      check(scores.every(Boolean), 'Missing independent test rounds');
      return {version_id,scores,mean:scores.reduce((sum,s) => sum+s.numerator/s.denominator,0)/scores.length};
    });
    const panel = {metric,rounds:plan.rounds,cases:ids.length,dataset_hash:datasetHash,rows};
    const locked = rows.find(row => row.version_id === state.finalized.version_id);
    const rival = rows.filter(row => row !== locked).sort((a,b) => b.mean-a.mean)[0];
    const margin = validation?.decision?.policy.min_gain_pp;
    if (locked && rival) {
      const gap = locked.mean-rival.mean;
      panel.comparison = {locked:locked.version_id,rival:rival.version_id,gap_pp:gap*100};
      if (Number.isFinite(margin)) Object.assign(panel.comparison,{
        margin_pp:margin,same_tier:require('./retest.cjs').inBand(Math.abs(gap),margin)
      });
    }
    const previous = store.events.findLast(e => e.type === 'PROJECT_TEST_REPORT');
    if (!previous || C.hash(previous.data) !== C.hash(panel)) S.append(store,'PROJECT_TEST_REPORT',panel);
    return require('./report.cjs').exportReport(store);
  } finally { release(); }
}
module.exports = {attachTestReport};
