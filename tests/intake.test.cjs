'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { discover, splitExamples } = require('../skills/prompttree/lib/intake.cjs');
function temporary(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'prompttree-intake-')));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  return root;
}
test('discovery finds an inline call, fixtures and scorer and respects repository exclusions', t => {
  const root = temporary(t);
  execFileSync('git',['init','-q'],{ cwd:root });
  fs.writeFileSync(path.join(root,'service.py'),'def reply():\n    return client.responses.create(...)\n');
  for (const file of ['fixtures.json','scorer.js','prompt.md','private-prompt.md']) fs.writeFileSync(path.join(root,file),'');
  fs.writeFileSync(path.join(root,'.gitignore'),'private-prompt.md\n');
  fs.mkdirSync(path.join(root,'.agents','skills'),{ recursive:true });
  fs.writeFileSync(path.join(root,'.agents/skills/prompt.md'),'');
  const signals = discover(root).signals;
  assert.deepEqual(signals.map(s => s.file), ['fixtures.json','prompt.md','scorer.js','service.py']);
  assert.deepEqual(signals.at(-1),{ file:'service.py', roles:['callsite'], line:2 });
});
test('grouped snapshots are deterministic, complete, disjoint and never overwrite previous output', t => {
  const root = temporary(t), dataset = path.join(root,'rows.jsonl');
  const rows = ['a','a','b','b','c'].map((group,i) => ({ key:String(i), group }));
  function write(records) { fs.writeFileSync(dataset, records.map(row => JSON.stringify(row)).join('\n')); }
  const split = name => splitExamples({ dataset, group:'group', id:'key', out:path.join(root,name) });
  const read = (r,s) => JSON.parse(fs.readFileSync(r.datasets[s].path));
  write(rows);
  const first = split('first');
  write(rows.reverse());
  const second = split('second');
  for (const s of ['search','validation']) assert.deepEqual(read(first,s), read(second,s));
  const a = read(first,'search'), b = read(first,'validation');
  assert.equal(a.length + b.length, rows.length);
  assert.ok(a.length && b.length && !a.some(r => b.some(t => t.group === r.group)));
  assert.throws(() => split('first'), { code:'EEXIST' });
  write(rows.filter(r => r.group === 'a'));
  assert.throws(() => split('one'), { code:'INSUFFICIENT_GROUPS' });
  write([{ key:'a' }]);
  assert.throws(() => split('missing'), { code:'INVALID_GROUP' });
});
test('portable synthetic example compares two sibling edits and exports an offline tree', t => {
  const root = temporary(t);
  for (const location of ['skills/prompttree','examples/label-routing']) {
    fs.cpSync(path.resolve(__dirname,'..',location),path.join(root,location),{
      recursive:true, filter:file => path.basename(file) !== '.prompttree'
    });
  }
  const output = JSON.parse(execFileSync(process.execPath,[path.join(root,'examples/label-routing/demo.cjs')]));
  assert.equal(output.usage.target_calls, 0);
  assert.equal(output.comparison.baseline.value, .5);
  assert.equal(output.comparison.candidate.value, 1);
  const tree = JSON.parse(fs.readFileSync(path.join(path.dirname(output.report),'evolution.json')));
  assert.equal(tree.nodes.length, 3);
  for (const node of tree.nodes.slice(1)) {
    assert.equal(node.parent_event_id, tree.nodes[0].event_id);
    assert.equal(node.changed_path, '/messages/0/content');
    assert.equal(node.runs.length, 2);
  }
});
