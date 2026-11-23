'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const C = require('./core.cjs');

function discover(workspace = '.') {
  const cwd = fs.realpathSync(workspace);
  const run = (cmd, args) => spawnSync(cmd, args, { cwd, encoding:'utf8', maxBuffer:32 * 1024 * 1024 });
  const git = run('git', ['rev-parse', '--is-inside-work-tree']);
  const listing = git.stdout?.trim() === 'true'
    ? run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'])
    : run('rg', ['--files', '--null']);
  C.check(listing.status === 0 || (listing.status === 1 && !listing.stderr && !listing.stdout),
    'DISCOVERY_FAILED', 'Cannot list project files. Use Git in a repository or install ripgrep.');
  const signals = [];
  const skip = /(^|\/)(?:\.[^/]+|node_modules|vendor|dist|build|coverage|__pycache__)(?:\/|$)/;
  for (const file of [...new Set(listing.stdout.split('\0').filter(Boolean))].sort()) {
    if (skip.test(file) || !/\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php|md|txt|ya?ml|toml|jsonl?|csv|jinja2?|j2|tmpl|ipynb)$/i.test(file)) continue;
    const absolute = path.join(cwd, file);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry:false });
    if (!stat?.isFile() || fs.realpathSync(absolute) !== absolute) continue;
    const roles = [];
    if (/prompt|instruction|template|\.j(?:2|inja2?)$/i.test(file)) roles.push('prompt');
    if (/fixture|sample|example|golden|dataset|cases|\.jsonl$/i.test(file)) roles.push('examples');
    if (/eval|scor|benchmark|(?:^|[\/._-])tests?(?:[\/._-]|$)/i.test(file)) roles.push('evaluation');
    let line;
    if (stat.size <= 512 * 1024 && /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php)$/i.test(file)) {
      const lines = fs.readFileSync(absolute, 'utf8').split('\n');
      const index = lines.findIndex(s => /chat\.completions|responses\.create|messages\.create|generateContent|generateText|system_prompt|systemPrompt|["']role["']\s*:\s*["'](?:system|developer)["']/.test(s));
      if (index >= 0) { roles.push('callsite'); line = index + 1; }
    }
    if (roles.length) signals.push({ file, roles, line });
  }
  return { workspace:cwd, signals };
}

function splitExamples({ dataset, group, out, id = 'case_id' }) {
  C.check(dataset && group && out, 'INVALID_INPUT', 'Provide --dataset, --group and a fresh --out directory');
  const records = C.dataset(dataset, id, true);
  const groups = new Map();
  for (const record of records) {
    const key = record[group];
    C.check(Object.hasOwn(record, group) && (typeof key === 'string' && key.trim() || Number.isFinite(key)),
      'INVALID_GROUP', 'Each record needs a nonempty group or numeric group', { field:group });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  C.check(groups.size >= 2, 'INSUFFICIENT_GROUPS', 'At least two independent groups are required');
  const rank = key => C.hash(JSON.stringify(key));
  const keys = [...groups.keys()].sort((a,b) => rank(a).localeCompare(rank(b)));
  const boundary = Math.max(1, Math.floor(keys.length * 0.7));
  const result = {};
  const destination = path.resolve(out);
  fs.mkdirSync(path.dirname(destination), { recursive:true });
  fs.mkdirSync(destination, { mode:0o700 });
  try {
    for (const [name, selected] of [['search',keys.slice(0,boundary)], ['validation',keys.slice(boundary)]]) {
      const rows = selected.flatMap(key => groups.get(key)).sort((a,b) => a[id] < b[id] ? -1 : 1);
      const file = path.join(destination, name + '.json');
      C.writeJSON(file, rows);
      result[name] = { path:file, id_field:id, expected_cases:rows.length };
    }
  } catch (error) {
    fs.rmSync(destination, { recursive:true, force:true });
    throw error;
  }
  return { datasets:result, group_field:group, groups:groups.size };
}
module.exports = { discover, splitExamples };
