'use strict';
const path = require('node:path');
const C = require('./core.cjs');
const S = require('./store.cjs');
const {promptText} = require('./edit-size.cjs');

function checkPolicy(policy) {
  const margin = v => Number.isFinite(v) && v >= 0 && v <= 100;
  C.check(policy && margin(policy.min_gain_pp), 'INVALID_RETEST', 'Specify the minimum meaningful validation gain in percentage points');
  if (policy.false_rejection !== undefined) {
    const f = policy.false_rejection;
    C.check(f && margin(f.min_gain_pp) && Array.isArray(f.reject_labels) && f.reject_labels.length > 0 &&
      f.reject_labels.every(s => typeof s === 'string' && s.length > 0), 'INVALID_RETEST', 'Specify reject labels and a false-rejection margin');
  }
}

function falseRejections(cases, ids, gold, rejectLabels) {
  C.check(Array.isArray(cases) && cases.length === ids.length, 'INVALID_RETEST', 'False-rejection comparison requires every validation prediction');
  const byId = new Map(cases.map(c => [c.case_id,c]));
  let rejected = 0, supported = 0;
  for (const id of ids) {
    const c = byId.get(id);
    C.check(c && typeof c.expected === 'string' && c.expected === gold.get(id) && typeof c.prediction === 'string',
      'INVALID_RETEST', 'Expected the same gold labels and complete string predictions for each trial');
    if (!rejectLabels.has(c.expected)) {
      supported++;
      if (rejectLabels.has(c.prediction)) rejected++;
    }
  }
  C.check(supported > 0, 'INVALID_RETEST', 'No in-scope cases for the false-rejection criterion');
  return {rejected,supported};
}

function inBand(gap, pp) {
  // Equality at a positive threshold counts as a meaningful difference.
  return gap === 0 || gap < pp/100 - 8*Number.EPSILON;
}

function selectTier(ranking, policy, frozenOrder) {
  const leader = ranking[0];
  const top = ranking.filter(n => inBand(leader.mean-n.mean,policy.min_gain_pp));
  let finalists = top;
  if (policy.false_rejection) {
    const lowest = Math.min(...top.map(n => n.false_rejection.rate));
    finalists = top.filter(n => inBand(n.false_rejection.rate-lowest,policy.false_rejection.min_gain_pp));
  }
  const shortest = Math.min(...finalists.map(n => n.prompt_chars));
  const selected = frozenOrder.find(n => finalists.some(f => f.version_id === n.version_id && f.prompt_chars === shortest));
  return {policy,mean_leader:leader.id,top_tier:top.map(n=>n.id),length_finalists:finalists.map(n=>n.id),
    selected:selected.id,selected_mean:ranking.find(n=>n.id===selected.id).mean};
}

function summarizeRetest(store, indexFile) {
  const base = path.dirname(path.resolve(indexFile));
  const index = C.readJSON(path.resolve(indexFile));
  const plan = C.readJSON(path.resolve(base, index.plan));
  const task = store.contract.task, split = store.contract.split_info.validation;
  const requireValue = (condition, message) => C.check(condition, 'INVALID_RETEST', message);
  requireValue(plan.experiment === store.contract.experiment_id && plan.metric === task.primary_metric &&
    plan.split === 'validation' && Number.isSafeInteger(plan.rounds) && plan.rounds >= 2, 'Check plan identity, metric and rounds');
  requireValue(Array.isArray(plan.candidates) && plan.candidates.length > 0 && Array.isArray(index.receipts),
    'Provide a frozen shortlist and a receipt for each repetition');
  const policy = plan.selection_policy;
  if (policy !== undefined) checkPolicy(policy);
  const rejectLabels = policy?.false_rejection ? new Set(policy.false_rejection.reject_labels) : null;
  let gold;
  const runs = Object.values(S.state(store).runs);
  const requests = new Set(runs.map(r => r.request_id));
  const templateHashes = new Map();
  const ranking = plan.candidates.map(n => {
    const original = runs.find(r => r.version_id === n.version_id && r.split === 'validation' && r.kind !== 'original' && r.status === 'succeeded');
    requireValue(original && typeof n.id === 'string', 'Every shortlisted version must have a completed screening evaluation');
    const screened = C.readJSON(C.inside(store.root,original.result_path));
    templateHashes.set(n.version_id,screened.template_hash);
    requests.add(screened.request_id);
    const row = {id:n.id,version_id:n.version_id,screening:original.metrics[plan.metric],scores:Array(plan.rounds).fill(null)};
    if (policy) {
      const {rendered} = require('./workflow.cjs').loadVersion(store,n.version_id);
      requireValue(C.hash(rendered) === screened.template_hash, 'Rendered prompt must match the evaluated version');
      row.prompt_chars = Array.from(promptText(rendered)).length;
    }
    if (rejectLabels && !gold) {
      requireValue(Array.isArray(screened.cases), 'The false-rejection rule requires frozen screening gold labels');
      gold = new Map(screened.cases.map(c => [c.case_id,c.expected]));
    }
    return row;
  });
  const versions = new Map(ranking.map(n => [n.version_id,n]));
  requireValue(versions.size === ranking.length && new Set(ranking.map(n => n.id)).size === ranking.length, 'Duplicate candidate');
  const validationIds = C.hash(split.ids);
  let targetCalls = 0;
  for (const entry of index.receipts) {
    const row = versions.get(entry.version_id), i = entry.round - 1;
    requireValue(row && Number.isInteger(i) && i >= 0 && i < plan.rounds && row.scores[i] === null, 'Duplicate or unexpected trial');
    const r = C.readJSON(path.resolve(base,entry.result));
    const m = r.metrics?.[plan.metric];
    requireValue(r.status === 'succeeded' && r.execution_kind === 'real' && r.version_id === row.version_id &&
      r.template_hash === templateHashes.get(row.version_id) && r.split === 'validation' &&
      r.coverage?.completed === split.count && r.coverage.expected === split.count && r.coverage.failed === 0 &&
      Array.isArray(r.case_ids) && C.hash(r.case_ids) === validationIds, 'Trial must cover the frozen validation split');
    requireValue(typeof r.request_id === 'string' && r.request_id.length && !requests.has(r.request_id) &&
      Number.isSafeInteger(r.usage?.target_calls) && r.usage.target_calls > 0, 'Trial must have its own request identity and fresh model calls');
    requireValue(Number.isSafeInteger(m?.denominator) && m.denominator > 0 && Number.isSafeInteger(m.numerator) &&
      m.numerator >= 0 && m.numerator <= m.denominator && Number.isFinite(m.value) && Math.abs(m.value - m.numerator/m.denominator) < 1e-8, 'Invalid trial metric');
    requests.add(r.request_id);
    row.scores[i] = {request_id:r.request_id,receipt_hash:C.hash(r),numerator:m.numerator,denominator:m.denominator,value:m.numerator/m.denominator};
    if (rejectLabels) row.scores[i].false_rejection = falseRejections(r.cases,split.ids,gold,rejectLabels);
    targetCalls += r.usage.target_calls;
  }
  for (const row of ranking) {
    requireValue(row.scores.every(Boolean), 'Complete all planned trials before selecting a version');
    const values = row.scores.map(m => m.value);
    // With a common denominator, equal totals must stay tied regardless of round order.
    const d = row.scores[0].denominator;
    row.mean = row.scores.every(m => m.denominator === d)
      ? row.scores.reduce((sum,m) => sum + m.numerator,0)/(plan.rounds*d)
      : values.reduce((sum,v) => sum+v,0)/plan.rounds;
    if (rejectLabels) {
      const rejected = row.scores.reduce((sum,s) => sum+s.false_rejection.rejected,0);
      const supported = row.scores.reduce((sum,s) => sum+s.false_rejection.supported,0);
      row.false_rejection = {rejected,supported,rate:rejected/supported};
    }
    row.min = Math.min(...values);
    row.max = Math.max(...values);
  }
  ranking.sort((a,b) => b.mean-a.mean);
  const roundWinners = ranking[0].scores.map((_,i) => {
    const max = Math.max(...ranking.map(n => n.scores[i].value));
    return ranking.filter(n => n.scores[i].value === max).map(n => n.id);
  });
  const decision = policy ? selectTier(ranking,policy,plan.candidates) : null;
  const winner = decision ? ranking.find(n=>n.id===decision.selected) : ranking[0];
  return {metric:plan.metric,rounds:plan.rounds,selected:winner.id,version_id:winner.version_id,...(decision && {decision}),
    tied:ranking.filter(n=>n.mean===ranking[0].mean).map(n=>n.id),round_winners:roundWinners,target_calls:targetCalls,ranking};
}

module.exports = { summarizeRetest, inBand };
