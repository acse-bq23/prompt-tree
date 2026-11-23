'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = '0.2.0';
class ToolError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
function check(condition, code, message, details) {
  if (!condition) throw new ToolError(code, message, details);
}
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function readJSON(file) {
  check(typeof file === 'string' && fs.existsSync(file) && fs.statSync(file).isFile(), 'MISSING_FILE', 'JSON file missing', { file });
  check(fs.statSync(file).size <= 32 * 1024 * 1024, 'RESOURCE_LIMIT', 'JSON file exceeds 32 MiB');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new ToolError('INVALID_JSON', 'Cannot parse JSON file', { file }); }
}
function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  const temp = file + '.tmp-' + crypto.randomUUID();
  fs.writeFileSync(temp, content, { flag:'wx', mode:0o600 });
  fs.renameSync(temp, file);
}
const writeJSON = (file, value) => atomic(file, JSON.stringify(value, null, 2) + '\n');
function immutable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  if (fs.existsSync(file)) {
    check(fs.readFileSync(file, 'utf8') === content, 'INTEGRITY_ERROR', 'Immutable file conflicts', { file });
  } else fs.writeFileSync(file, content, { flag:'wx', mode:0o600 });
}
function inside(root, relative) {
  check(typeof relative === 'string' && relative.length > 0, 'INVALID_PATH', 'Relative artifact path required');
  const absolute = path.resolve(root, relative);
  check(absolute.startsWith(path.resolve(root) + path.sep), 'INVALID_PATH', 'Artifact escapes experiment directory');
  let current = path.resolve(root);
  for (const part of path.relative(current, absolute).split(path.sep)) {
    current = path.join(current, part);
    check(!fs.existsSync(current) || !fs.lstatSync(current).isSymbolicLink(), 'INVALID_PATH', 'Artifact symlinks are unsupported');
  }
  return absolute;
}
function pointer(value, name) {
  check(typeof name === 'string' && /^\/.+/.test(name), 'INVALID_POLICY', 'Policy paths must be non-root JSON pointers');
  const parts = name.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  check(parts.every(s => s && !['__proto__','prototype','constructor'].includes(s)), 'INVALID_POLICY', 'Unsafe policy pointer');
  let parent = value;
  for (const key of parts.slice(0, -1)) {
    check(parent && Object.hasOwn(parent, key), 'POLICY_VIOLATION', 'Missing policy path', { path:name });
    parent = parent[key];
  }
  const key = parts.at(-1);
  check(parent && Object.hasOwn(parent, key), 'POLICY_VIOLATION', 'Missing policy path', { path:name });
  return { parent, key, value:parent[key] };
}
function validatePolicy(policy, baseline) {
  check(policy && Array.isArray(policy.editable_paths) && policy.editable_paths.length, 'INVALID_POLICY', 'editable_paths required');
  const paths = [...policy.editable_paths, ...Object.keys(policy.selectable || {})];
  check(new Set(paths).size === paths.length, 'INVALID_POLICY', 'Duplicate policy paths');
  paths.forEach(p => pointer(baseline, p));
  for (const a of paths) for (const b of paths) {
    check(a === b || !b.startsWith(a + '/'), 'INVALID_POLICY', 'Overlapping policy paths');
  }
}
function validateCandidate(candidate, baseline, policy) {
  const masked = value => {
    const out = clone(value);
    for (const name of [...policy.editable_paths, ...Object.keys(policy.selectable || {})]) {
      const item = pointer(out, name);
      item.parent[item.key] = '__PROMPTTREE_EDITABLE__';
    }
    return out;
  };
  check(JSON.stringify(masked(candidate)) === JSON.stringify(masked(baseline)), 'POLICY_VIOLATION', 'Fixed structure or content changed');
  for (const [name, pool] of Object.entries(policy.selectable || {})) {
    const values = pointer(candidate, name).value;
    check(Array.isArray(pool) && Array.isArray(values) && values.every(v => pool.some(p => JSON.stringify(v) === JSON.stringify(p))), 'POLICY_VIOLATION', 'Unapproved selectable value', { path:name });
  }
  for (const [name, literals] of Object.entries(policy.required_literals || {})) {
    const value = pointer(candidate, name).value;
    check(typeof value === 'string' && Array.isArray(literals) && literals.every(s => typeof s === 'string' && value.includes(s)), 'POLICY_VIOLATION', 'Required literal missing', { path:name });
  }
  const slots = value => (JSON.stringify(value).match(/\{\{[^{}]+\}\}/g) || []).sort();
  check(JSON.stringify(slots(candidate)) === JSON.stringify(slots(baseline)), 'POLICY_VIOLATION', 'Runtime slots changed');
}
function validateRendered(value) {
  check(value && Array.isArray(value.messages) && value.messages.length, 'INVALID_TEMPLATE', 'Renderer must return a messages array');
  check(value.messages.every(m => m && ['system','developer','user','assistant','tool'].includes(m.role) && typeof m.content === 'string'), 'INVALID_TEMPLATE', 'Rendered messages need role and string content');
}
function dataset(file, idField = 'case_id', returnRecords = false) {
  check(fs.statSync(file).size <= 32 * 1024 * 1024, 'RESOURCE_LIMIT', 'Dataset exceeds 32 MiB; create a bounded snapshot');
  const text = fs.readFileSync(file, 'utf8');
  let records;
  try { records = file.endsWith('.jsonl') ? text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : JSON.parse(text); }
  catch { throw new ToolError('INVALID_DATASET', 'Cannot parse dataset'); }
  check(Array.isArray(records) && records.length, 'INVALID_DATASET', 'Nonempty JSON array or JSONL dataset required');
  const ids = records.map(item => item && item[idField]);
  check(ids.every(id => typeof id === 'string' && id.length) && new Set(ids).size === ids.length, 'INVALID_DATASET', 'Unique string case IDs required');
  return returnRecords ? records : { count:ids.length, ids };
}
function fingerprint(files) {
  return files.map(file => {
    check(fs.existsSync(file) && fs.statSync(file).isFile(), 'MISSING_FILE', 'Required project file missing', { file });
    return { file:path.resolve(file), realpath:fs.realpathSync(file), sha256:hash(fs.readFileSync(file)) };
  });
}
function assertFingerprints(entries) {
  for (const item of entries) {
    check(fs.existsSync(item.file) && fs.realpathSync(item.file) === item.realpath && hash(fs.readFileSync(item.file)) === item.sha256,
      'CONTRACT_CHANGED', 'Frozen project or dataset file changed', { file:item.file });
  }
}
function budgetNumber(value, name) { check(Number.isSafeInteger(value) && value > 0, 'INVALID_BUDGET', name + ' must be a positive integer'); }
module.exports = { VERSION, ToolError, check, hash, clone, readJSON, writeJSON, atomic, immutable, inside, pointer, validatePolicy, validateCandidate, validateRendered, dataset, fingerprint, assertFingerprints, budgetNumber };
