'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, i, all) => i % 2 === 0 ? [...pairs, [item.slice(2), all[i + 1]]] : pairs, []));
const request = JSON.parse(fs.readFileSync(args.request, 'utf8'));
const records = JSON.parse(fs.readFileSync(args.dataset, 'utf8'));
const candidate = JSON.parse(fs.readFileSync(args.candidate, 'utf8'));
fs.appendFileSync('trace.txt', request.request_id + '\n');
function finish() {
  if (args.fault === 'exit') { process.stderr.write('project error'); process.exitCode = 7; return; }
  if (args.fault === 'missing') return;
  if (args.fault === 'json') { fs.writeFileSync(args.output, '{'); return; }
  const cases = records.map(row => {
    const prediction = candidate.messages[0].content.includes('allrows') ? row.input : row.input.slice(0, 1);
    return { case_id:row.case_id, failed:JSON.stringify(prediction) !== JSON.stringify(row.expected), prediction, expected:row.expected };
  });
  const n = cases.filter(c => !c.failed).length, d = records.length;
  const hash = crypto.createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
  const result = { ...request, schema_version:'prompttree-evaluation-v1', template_hash:hash, execution_kind:'mock', status:'succeeded',
    coverage:{ expected:d, completed:d, failed:0 }, case_ids:records.map(r => r.case_id),
    metrics:{ accuracy:{ numerator:n, denominator:d, value:n / d } }, usage:{ target_calls:0, simulated_calls:d }, cases };
  if (args.fault === 'partial') result.coverage.completed--;
  if (args.fault === 'identity') result.version_id = 'wrong-version';
  if (args.fault === 'usage') result.usage.target_calls = request.max_target_calls + 1;
  if (args.fault === 'metric') result.metrics.accuracy.value = 0.1234;
  if (args.fault === 'secret') process.stderr.write(process.env.PROMPTTREE_TEST_SECRET);
  fs.writeFileSync(args.output, JSON.stringify(result));
}
if (args.fault === 'sleep') setTimeout(finish, 5000); else finish();
