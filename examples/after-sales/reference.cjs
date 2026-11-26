'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { accuracy, digest, loadDataset, source, splits } = require('./scoring.cjs');

function loadReference(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dataset = loadDataset();
  const prompt = source('prompt.json');
  const snapshot = fs.readFileSync(path.join(path.dirname(file), report.prompt_snapshot));
  const sameRate = (actual, saved) => saved && actual.numerator === saved.numerator &&
    actual.denominator === saved.denominator && actual.value === saved.value;
  if (report.schema_version !== 'after-sales-baseline-v1' || !['mock', 'real'].includes(report.execution_kind) ||
      report.metric !== 'correct_action' || report.prompt_source.file !== prompt.reference.file ||
      report.prompt_source.sha256 !== prompt.reference.sha256 || digest(snapshot) !== prompt.reference.sha256 ||
      [...dataset.sources, ...['baseline.cjs', 'support.cjs', 'model.cjs', 'scoring.cjs'].map(f => source(f).reference)]
        .some(item => !report.sources.some(saved => saved.file === item.file && saved.sha256 === item.sha256))) {
    throw new Error('基线报告与当前 Prompt、数据或执行代码不一致');
  }
  const cases = new Map(report.cases.map(row => [row.case_id, row]));
  if (cases.size !== report.cases.length || cases.size !== Object.values(dataset.batches).flat().length) {
    throw new Error('基线报告样例数量或唯一性有误');
  }
  for (const split of splits) {
    for (const { case_id, message, expected } of dataset.batches[split]) {
      const row = cases.get(case_id);
      if (!row || row.split !== split || row.input_excerpt !== message || row.expected !== expected ||
          typeof row.prediction !== 'string' || row.failed !== (row.prediction !== expected)) {
        throw new Error('基线报告与样例不一致：' + case_id);
      }
    }
    if (!sameRate(accuracy(report.cases.filter(row => row.split === split)), report.splits[split])) {
      throw new Error('基线分集准确率与逐单结果不一致：' + split);
    }
  }
  if (!sameRate(accuracy(report.cases), report.accuracy)) throw new Error('基线总分与逐单结果不一致');
  return { report, cases };
}
module.exports = { loadReference };
