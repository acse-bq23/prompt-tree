'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { actions } = require('./support.cjs');

const splits = ['search', 'validation'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function source(file) {
  const bytes = fs.readFileSync(path.join(__dirname, file));
  return { bytes, reference: { file, sha256: digest(bytes) } };
}

function loadDataset() {
  const gold = source('answer/gold.json');
  const expected = new Map();
  for (const row of JSON.parse(gold.bytes)) {
    if (!Object.values(actions).includes(row.expected) || expected.has(row.case_id)) {
      throw new Error('金标准标签无效或 ID 重复：' + row.case_id);
    }
    expected.set(row.case_id, row.expected);
  }
  const seen = new Set();
  const batches = {};
  const sources = [gold.reference];
  for (const split of splits) {
    const input = source('data/' + split + '.json');
    sources.push(input.reference);
    batches[split] = JSON.parse(input.bytes).map(({ case_id, message }) => {
      if (typeof case_id !== 'string' || !case_id || typeof message !== 'string' || !message.trim()
          || seen.has(case_id) || !expected.has(case_id)) throw new Error('输入或配对无效：' + case_id);
      seen.add(case_id);
      return { case_id, message, expected: expected.get(case_id) };
    });
    if (!batches[split].length) throw new Error('空切分：' + split);
  }
  if (seen.size !== expected.size) throw new Error('存在找不到输入的金标准');
  return { batches, sources };
}

async function score(rows, predict, onCase) {
  const cases = [];
  for (const { case_id, message, expected } of rows) {
    const prediction = await predict(message);
    const result = { case_id, input_excerpt: message, expected, prediction, failed: prediction !== expected };
    if (onCase) onCase(result);
    cases.push(result);
  }
  return cases;
}
function accuracy(cases) {
  const numerator = cases.filter(row => !row.failed).length;
  return { numerator, denominator: cases.length, value: numerator / cases.length };
}
module.exports = { splits, digest, source, loadDataset, score, accuracy };
