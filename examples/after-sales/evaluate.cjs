'use strict';
const fs = require('node:fs');
const { accuracy, digest, loadDataset, score } = require('./scoring.cjs');
const { model } = require('./model.cjs');

async function evaluate() {
  const [promptFile, dataFile, requestFile, outputFile, reportFile] = process.argv.slice(2);
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const prompt = read(promptFile), request = read(requestFile);
  const inputs = read(dataFile), { batches } = loadDataset();
  const expected = new Map(batches[request.split].map(row => [row.case_id, row.expected]));
  const rows = inputs.map(({ case_id, message }) => {
    if (!expected.has(case_id)) throw new Error('数据与金标准不一致：' + case_id);
    return { case_id, message, expected: expected.get(case_id) };
  });
  const real = request.execution_kind === 'real';
  if (real && rows.length > request.max_target_calls) throw new Error('模型调用预算不足');
  let cases;
  if (reportFile) {
    const { report, cases: saved } = require('./reference.cjs').loadReference(reportFile);
    if (report.execution_kind !== request.execution_kind ||
        digest(JSON.stringify(prompt)) !== digest(JSON.stringify(require('./prompt.json')))) {
      throw new Error('已记录的预测只适用于对应的基线和运行模式');
    }
    cases = rows.map(row => saved.get(row.case_id));
  } else {
    cases = await score(rows, model(request.execution_kind, prompt).predict);
  }
  fs.writeFileSync(outputFile, JSON.stringify({
    ...request, schema_version: 'prompttree-evaluation-v1', status: 'succeeded',
    template_hash: digest(JSON.stringify(prompt)),
    coverage: { expected: rows.length, completed: cases.length, failed: 0 },
    case_ids: cases.map(row => row.case_id), metrics: { correct_action: accuracy(cases) },
    usage: { target_calls: real && !reportFile ? cases.length : 0, simulated_calls: !real && !reportFile ? cases.length : 0 },
    ...(reportFile ? { limitations: ['本次重放使用已保存的逐单预测，调用量仅计本次实验。原批次用量请核对基线报告。'] } : {}), cases
  }));
}
evaluate().catch(error => { console.error(error.message); process.exitCode = 1; });
