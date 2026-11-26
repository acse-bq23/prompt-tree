'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReference } = require('../examples/after-sales/reference.cjs');
const { loadDataset, score } = require('../examples/after-sales/scoring.cjs');
const { model } = require('../examples/after-sales/model.cjs');

test('the shipped mock baseline reproduces every gold-paired ticket from the project prompt', async () => {
  const root = path.resolve(__dirname, '../examples/after-sales');
  const { cases } = loadReference(path.join(root, 'baseline/reference-mock/accuracy_report.json'));
  const { batches } = loadDataset();
  const engine = model('mock', require(path.join(root, 'prompt.json')));
  assert.equal(cases.size, 100);
  for (const [split, rows] of Object.entries(batches)) {
    for (const result of await score(rows, engine.predict)) {
      assert.deepEqual({ split, ...result }, cases.get(result.case_id));
    }
  }
});
