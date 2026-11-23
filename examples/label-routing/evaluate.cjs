'use strict';
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { route } = require('./route.cjs');
const [candidateFile, datasetFile, requestFile, resultFile] = process.argv.slice(2);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const candidate = read(candidateFile), rows = read(datasetFile), request = read(requestFile);
const cases = rows.map(({ case_id, input, expected }) => {
  const prediction = route(input, candidate);
  const failed = JSON.stringify([...prediction].sort()) !== JSON.stringify([...expected].sort());
  return { case_id, failed, expected, prediction, input_excerpt:input };
});
const correct = cases.filter(c => !c.failed).length;
fs.writeFileSync(resultFile, JSON.stringify({
  ...request, schema_version:'prompttree-evaluation-v1', execution_kind:'mock', status:'succeeded',
  template_hash:createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
  coverage:{ expected:rows.length, completed:rows.length, failed:0 }, case_ids:rows.map(r => r.case_id),
  metrics:{ exact_set:{ numerator:correct, denominator:rows.length, value:correct / rows.length } },
  usage:{ target_calls:0, simulated_calls:rows.length }, cases
}));
