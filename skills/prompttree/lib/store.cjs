'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { check, hash, readJSON, inside, immutable } = require('./core.cjs');

function lock(root) {
  check(fs.existsSync(root) && !fs.lstatSync(root).isSymbolicLink(), 'INVALID_PATH', 'Experiment directory missing or symlinked');
  const file = path.join(root, '.write-lock');
  if (fs.existsSync(file)) {
    const previous = readJSON(file);
    check(Number.isSafeInteger(previous.pid) && previous.pid > 0, 'INTEGRITY_ERROR', 'Invalid writer lock');
    let alive = true;
    try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    check(!alive, 'BUSY', 'An experiment writer is active');
    fs.unlinkSync(file);
  }
  const token = crypto.randomUUID();
  fs.writeFileSync(file, JSON.stringify({ pid:process.pid, token }), { flag:'wx', mode:0o600 });
  return () => { if (fs.existsSync(file) && readJSON(file).token === token) fs.unlinkSync(file); };
}
function open(root) {
  const contract = readJSON(path.join(root, 'contract.json'));
  const { contract_hash, ...body } = contract;
  check(hash(body) === contract_hash, 'INTEGRITY_ERROR', 'Frozen contract hash mismatch');
  check(contract.schema_version === 'prompttree-contract-v1', 'UNSUPPORTED_SCHEMA', 'Unsupported contract version');
  const file = path.join(root, 'events.jsonl');
  const raw = fs.readFileSync(file, 'utf8');
  check(!raw || raw.endsWith('\n'), 'INTEGRITY_ERROR', 'Incomplete event tail; preserve and reconcile before resuming');
  const events = [];
  let previous = contract_hash;
  for (const line of raw.split('\n').filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { check(false, 'INTEGRITY_ERROR', 'Malformed event'); }
    const { event_hash, ...content } = event;
    check(event.seq === events.length + 1 && event.previous_hash === previous && hash(content) === event_hash, 'INTEGRITY_ERROR', 'Event chain mismatch');
    for (const blob of event.blobs || []) {
      const location = inside(root, blob.path);
      check(fs.existsSync(location) && hash(fs.readFileSync(location)) === blob.sha256, 'INTEGRITY_ERROR', 'Recorded artifact missing or changed', { path:blob.path });
    }
    previous = event_hash;
    events.push(event);
  }
  return { root, contract, events };
}
function append(store, type, data, blobs = []) {
  const content = { seq:store.events.length + 1, previous_hash:store.events.at(-1)?.event_hash || store.contract.contract_hash,
    at:new Date().toISOString(), type, data, blobs };
  const event = { ...content, event_hash:hash(content) };
  const fd = fs.openSync(path.join(store.root, 'events.jsonl'), 'a', 0o600);
  try { fs.writeSync(fd, JSON.stringify(event) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  store.events.push(event);
  return event;
}
function blob(store, relative, value) {
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  immutable(inside(store.root, relative), content);
  return { path:relative, sha256:hash(content) };
}
function state(store) {
  const out = { phase:'prepared', attempts:0, versions:{}, derivations:[], runs:{}, finalized:null, baseline_checked:false, reused:0 };
  for (const event of store.events) {
    const d = event.data;
    if (event.type === 'VERSION') out.versions[d.version_id] = d;
    if (event.type === 'ATTEMPT') out.attempts++;
    if (event.type === 'DERIVATION') out.derivations.push(d);
    if (event.type === 'RESERVED') out.runs[d.run_id] = { ...d, status:'unknown' };
    if (event.type === 'RESULT') Object.assign(out.runs[d.run_id], d);
    if (event.type === 'BASELINE_CHECKED') { out.baseline_checked = true; out.phase = 'baseline_checked'; }
    if (event.type === 'SEARCH_STARTED') out.phase = 'searching';
    if (event.type === 'REUSED') out.reused++;
    if (event.type === 'FINALIZED') { out.finalized = d; out.phase = 'finalized'; }
  }
  out.pending = Object.values(out.runs).filter(r => r.status === 'unknown');
  if (out.pending.length) out.phase = 'needs_attention';
  return out;
}
module.exports = { lock, open, append, blob, state };
