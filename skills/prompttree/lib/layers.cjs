'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const C = require('./core.cjs');
const S = require('./store.cjs');
const W = require('./workflow.cjs');

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

// Project the tree from the same journal that records evaluations and their costs.
function snapshot(store) {
  const layers = [], byEvent = new Map();
  for (const { type, data } of store.events) {
    const layer = layers.at(-1);
    if (type === 'LAYER_SUBMITTED') {
      for (const { parent_event_id, reason } of data.stops) {
        Object.assign(byEvent.get(parent_event_id), { branch:'stopped', reason });
      }
      const nodes = data.nodes.map(n => {
        if (n.parent_event_id) byEvent.get(n.parent_event_id).branch = 'expanded';
        return { ...n, status:'queued' };
      });
      layers.push({ level:data.level, status:'queued', nodes, plan_hash:data.plan_hash });
    } else if (type === 'LAYER_STARTED') {
      Object.assign(layer, { status:'running', worker_pid:data.pid });
    } else if (type === 'NODE_STARTED') {
      layer.nodes[data.index].status = 'running';
    } else if (type === 'NODE_SETTLED') {
      const node = Object.assign(layer.nodes[data.index], data.result);
      if (node.event_id) byEvent.set(node.event_id, node);
      if (node.status === 'completed') node.branch = layer.level === store.contract.task.max_layers ? 'depth_limit' : 'awaiting_review';
    } else if (type === 'LAYER_FINISHED') {
      layer.status = data.status;
      for (const n of layer.nodes) if (n.status === 'queued') n.status = 'blocked';
    } else if (type === 'FINALIZED') {
      let selected = false;
      for (const n of byEvent.values()) {
        if (n.branch === 'awaiting_review') { n.branch = 'stopped'; n.reason = data.stop_reason; }
        if (!selected && n.validation_run_id === data.selected_run_id && n.status === 'completed') { n.selected = true; selected = true; }
      }
    }
  }
  const last = layers.at(-1);
  if (last?.status === 'running' && !alive(last.worker_pid)) {
    last.status = 'interrupted';
    for (const n of last.nodes) if (n.status === 'running') n.status = 'interrupted';
  }
  return layers;
}

function validatePlan(store, plan, previous) {
  const level = plan.level;
  C.check(Number.isSafeInteger(level) && level === (previous?.level || 0) + 1 && level <= store.contract.task.max_layers,
    'INVALID_LEVEL', 'Submit the next level within the agreed depth');
  C.check(Array.isArray(plan.nodes) && Array.isArray(plan.stops || []), 'INVALID_PLAN', 'Provide nodes and optional stop decisions');
  if (level === 1) {
    C.check(plan.nodes.length === 1 && Object.keys(plan.nodes[0]).length === 0 && !plan.stops?.length,
      'INVALID_PLAN', 'Level one contains only the unchanged baseline: nodes=[{}]');
    return;
  }
  C.check(['completed','partial'].includes(previous.status), 'LAYER_INCOMPLETE', 'Review the previous batch first');
  const parents = previous.nodes.filter(n => n.status === 'completed').map(n => n.event_id);
  C.check(parents.length, 'NO_FRONTIER', 'No completed parents to expand');
  const covered = new Set(), proposals = new Set();
  for (const n of plan.nodes) {
    const parent = n?.proposal?.parent_event_id;
    C.check(n?.candidate && parents.includes(parent), 'INVALID_PARENT', 'Use a completed parent from the preceding layer');
    const hash = C.hash(n);
    C.check(!proposals.has(hash), 'INVALID_PLAN', 'Duplicate proposal in batch');
    proposals.add(hash); covered.add(parent);
  }
  for (const stop of plan.stops || []) {
    C.check(parents.includes(stop.parent_event_id) && !covered.has(stop.parent_event_id) &&
      typeof stop.reason === 'string' && stop.reason.trim(), 'INVALID_STOP', 'Record one reason for each unexpanded parent');
    covered.add(stop.parent_event_id);
  }
  C.check(parents.every(p => covered.has(p)), 'MISSING_PARENT', 'Review every completed parent');
}

async function acquire(root) {
  for (;;) {
    try { return S.lock(root); }
    catch (error) { if (error.code !== 'BUSY') throw error; }
    await delay(200);
  }
}

function review(store, level) {
  const layer = snapshot(store).find(l => l.level === level);
  C.check(layer, 'UNKNOWN_LAYER', 'Layer has not been submitted');
  const runs = S.state(store).runs;
  const nodes = layer.nodes.map(node => {
    if (node.status !== 'completed') return node;
    const raw = C.readJSON(C.inside(store.root, runs[node.search_run_id].result_path));
    const failures = (raw.cases || []).filter(c => c.failed);
    return { ...node, validation_metrics:runs[node.validation_run_id].metrics,
      search_metrics:raw.metrics, failure_count:failures.length,
      ...(store.contract.task.evidence?.search_cases_visible ? { search_failures:failures } : {}) };
  });
  return { ...layer, nodes, ok:['completed','partial'].includes(layer.status),
    next:!['completed','partial'].includes(layer.status) ? 'inspect' :
      level === store.contract.task.max_layers || !nodes.some(n => n.status === 'completed') ? 'finalize' : 'review_each_parent' };
}

async function submit(root, plan) {
  const hash = C.hash(plan);
  const existing = store => store.events.find(e => e.type === 'LAYER_SUBMITTED' && e.data.level === plan.level);
  const replay = event => C.check(event.data.plan_hash === hash, 'PLAN_CONFLICT', 'This level already has a different frozen plan');
  const prior = existing(S.open(root));
  if (prior) { replay(prior); return; }
  const release = await acquire(root);
  try {
    const store = S.open(root), state = S.state(store);
    if (existing(store)) { replay(existing(store)); return; }
    C.check(!state.finalized && store.contract.task.max_layers, 'INVALID_PLAN', 'Prepare an open experiment with max_layers');
    validatePlan(store, plan, snapshot(store).at(-1));
    const blobs = [];
    const nodes = plan.nodes.map((n,index) => {
      const id = 'L' + plan.level + '-N' + (index+1);
      if (plan.level === 1) return { id, parent_event_id:null, label:'Baseline' };
      for (const field of ['candidate','proposal']) blobs.push(S.blob(store, 'layers/'+id+'/'+field+'.json', n[field]));
      return { id, parent_event_id:n.proposal.parent_event_id, label:n.proposal.operator };
    });
    S.append(store,'LAYER_SUBMITTED',{ level:plan.level, plan_hash:hash, nodes, stops:plan.stops || [] },blobs);
  } finally { release(); }
}

async function runNode(store, node, level) {
  const baseline = level === 1, run = store.root;
  const inputs = baseline ? { baseline:true } : {
    candidate:C.inside(run,'layers/'+node.id+'/candidate.json'), proposal:C.inside(run,'layers/'+node.id+'/proposal.json') };
  if (!baseline) {
    const parent = snapshot(store)[level-2].nodes.find(n=>n.event_id===node.parent_event_id);
    const refs = C.readJSON(inputs.proposal).evidence_refs;
    C.check(Array.isArray(refs) && refs.length && refs.every(r=>typeof r === 'string' && r.split('/')[0]===parent.search_run_id),
      'INVALID_EVIDENCE', 'Use this parent node’s Search receipt');
  }
  const result = {};
  for (const original of baseline && store.contract.project.original_evaluate_argv ? [true,false] : [false]) {
    for (const split of ['search','validation']) {
      const requestId = node.id + (original ? '-original' : '') + '-' + split;
      const r = await W.evaluate({ ...inputs, run, original, split, requestId }, store);
      if (!r.ok || r.outcome === 'no_change') return { ...result, status:r.status || (r.outcome === 'no_change' ? 'no_change' : 'rejected'), reason:r.error?.code || r.code || r.outcome };
      if (!original) Object.assign(result, { event_id:r.event_id, version_id:r.version_id, [split+'_run_id']:r.run_id });
    }
  }
  C.check(!baseline || S.state(store).baseline_checked, 'BASELINE_REQUIRED','Baseline comparison incomplete');
  return { ...result, status:'completed' };
}

async function work(root, level) {
  const release = await acquire(root);
  try {
    const store = S.open(root), layer = snapshot(store).find(l => l.level === level);
    C.check(layer, 'UNKNOWN_LAYER','Layer has not been submitted');
    if (['completed','partial','needs_attention'].includes(layer.status)) return;
    S.append(store,'LAYER_STARTED',{ level, pid:process.pid });
    let status = 'completed';
    for (const [index,node] of layer.nodes.entries()) {
      if (!['queued','running','interrupted'].includes(node.status)) {
        if (['unknown','blocked'].includes(node.status)) { status = 'needs_attention'; break; }
        continue;
      }
      S.append(store,'NODE_STARTED',{ level,index });
      let result;
      try { result = await runNode(store,node,level); }
      catch (error) {
        if (!['INVALID_EVIDENCE','INVALID_PROPOSAL','INVALID_RULE','POLICY_VIOLATION','NON_ATOMIC_EDIT','BUDGET_EXHAUSTED','INVALID_TEMPLATE','RENDER_FAILED'].includes(error.code)) {
          result = { status:S.state(store).pending.length ? 'unknown' : 'blocked', reason:error.code || 'WORKER_ERROR' };
        } else result = { status:'rejected', reason:error.code };
      }
      S.append(store,'NODE_SETTLED',{ level,index,result });
      if (['unknown','blocked'].includes(result.status)) { status = 'needs_attention'; break; }
    }
    if (status === 'completed') {
      const nodes = snapshot(store).at(-1).nodes;
      if (level === 1 && !nodes.some(n=>n.status==='completed')) status = 'needs_attention';
      else if (nodes.some(n=>!['completed','no_change'].includes(n.status))) status = 'partial';
    }
    S.append(store,'LAYER_FINISHED',{ level,status });
  } finally { release(); }
}

// The worker owns the evaluations. Its exit wakes an attached host without model polling.
async function dispatch(input) {
  const root = path.resolve(input.run);
  const plan = input.plan ? C.readJSON(input.plan) : null;
  const level = plan ? plan.level : Number(input.level);
  if (plan) await submit(root,plan);
  const store = S.open(root), layer = snapshot(store).find(l => l.level === level);
  C.check(layer, 'UNKNOWN_LAYER','Supply a submitted level or a plan');
  if (['completed','partial','needs_attention'].includes(layer.status)) return review(store,level);
  const child = spawn(process.execPath,[path.join(__dirname,'../scripts/prompttree.cjs'),'layer-worker','--run',root,'--level',String(level)],
    { detached:true, stdio:'ignore' });
  if (!input.wait) {
    await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); });
    child.unref();
    return { ok:true, level, plan_hash:layer.plan_hash, status:layer.status };
  }
  const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',resolve); });
  C.check(code === 0, 'WORKER_INTERRUPTED','Reconnect with layer-resume --level and --wait');
  return review(S.open(root),level);
}
module.exports = { snapshot, dispatch, work };
