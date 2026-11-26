'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { source, loadDataset, splits, score, accuracy } = require('./scoring.cjs');
const { model } = require('./model.cjs');

async function baseline(mode, directory) {
  const prompt = source('prompt.json');
  const { batches, sources } = loadDataset();
  const engine = model(mode, JSON.parse(prompt.bytes));
  const parent = path.join(__dirname, 'baseline');
  fs.mkdirSync(parent, { recursive: true });
  const out = directory || fs.mkdtempSync(path.join(parent, mode + '-'));
  if (directory) fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'prompt.json'), prompt.bytes, { flag: 'wx' });
  const report = {
    schema_version: 'after-sales-baseline-v1', execution_kind: mode, model: engine.name,
    ...(engine.endpoint ? { endpoint: engine.endpoint } : {}),
    created_at: new Date().toISOString(), prompt_source: prompt.reference,
    prompt_snapshot: 'prompt.json', sources: [...sources, ...['baseline.cjs', 'support.cjs', 'model.cjs', 'scoring.cjs'].map(file => source(file).reference)],
    metric: 'correct_action', splits: {}, cases: []
  };
  let completed = 0;
  for (const split of splits) {
    const cases = await score(batches[split], engine.predict, row => {
      if (mode === 'real') {
        fs.appendFileSync(path.join(out, 'predictions.jsonl'), JSON.stringify({ split, ...row }) + '\n');
        if (++completed % 10 === 0) console.error('已完成 ' + completed + ' 条');
      }
    });
    report.splits[split] = accuracy(cases);
    report.cases.push(...cases.map(row => ({ split, ...row })));
  }
  report.accuracy = accuracy(report.cases);
  const file = path.join(out, 'accuracy_report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { file, execution_kind: mode, accuracy: report.accuracy };
}
if (require.main === module) {
  const flag = process.argv[2];
  if (!['--mock', '--real'].includes(flag) || process.argv.length !== 3) throw new Error('用法：node baseline.cjs --mock 或 --real');
  baseline(flag.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { baseline };
