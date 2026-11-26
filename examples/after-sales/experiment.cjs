'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { loadReference } = require('./reference.cjs');
const cli = path.resolve(__dirname, '../../skills/prompttree/scripts/prompttree.cjs');
const call = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: __dirname, encoding: 'utf8' }));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function compare(directory, baselineReceipt) {
  const run = path.join(directory, 'run');
  const parent = baselineReceipt.nodes[0];
  if (parent.status !== 'completed') throw new Error('基线未完成');
  const project = read(path.join(__dirname, 'project.json'));
  const { report: reference } = loadReference(path.join(__dirname, project.baseline_accuracy_report));
  for (const split of ['search', 'validation']) {
    const replay = read(path.join(run, 'runs', parent.id + '-' + split, 'result.json'));
    const expected = reference.cases.filter(row => row.split === split);
    const predictions = new Map(replay.cases.map(row => [row.case_id, row]));
    if (predictions.size !== expected.length || expected.some(row => {
      const result = predictions.get(row.case_id);
      return !result || result.prediction !== row.prediction || result.expected !== row.expected || result.failed !== row.failed;
    })) throw new Error('树根与独立基线逐单结果不同：' + split);
  }
  const candidate = read(path.join(run, 'versions', parent.version_id + '.json')).candidate;
  const evidence = parent.search_failures.filter(row =>
    row.expected === '登记签收异常' && row.input_excerpt.includes('已送达'));
  if (!evidence.length) throw new Error('本轮基线缺少支撑该历史假设的探索错单');
  candidate.messages[0].content += '\nmissing｜显示已送达，但我没拿到货';
  const plan = { level: 2, nodes: [{ candidate, proposal: {
    parent_event_id: parent.event_id,
    evidence_refs: evidence.map(row => parent.search_run_id + '/' + row.case_id),
    rule_refs: read(path.join(__dirname, 'task.json')).rules,
    operator: '补充签收异常示例',
    hypothesis: '已有示例使用「签收」。增加「已送达但没拿到」的说法可能改善签收异常分流。',
    expected_effect: '让未拿到已送达包裹的顾客直接登记异常',
    regression_risk: '正常询问送达时间的工单可能被引向异常登记'
  } }] };
  const planFile = path.join(directory, 'candidate-plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  const receipt = call('layer-submit', '--run', run, '--plan', planFile, '--wait');
  const child = receipt.nodes[0];
  if (child.status !== 'completed') throw new Error(JSON.stringify(receipt));
  const improved = child.validation_metrics.correct_action.value > parent.validation_metrics.correct_action.value;
  const result = call('finalize', '--run', run, '--version', (improved ? child : parent).version_id, '--reason', 'depth_limit');
  console.log(JSON.stringify({ run, report: result.report, comparison: result.manifest.comparison, usage: result.manifest.usage }, null, 2));
}

if (require.main === module) {
  const experiments = path.join(__dirname, '.prompttree');
  fs.mkdirSync(experiments, { recursive: true });
  const dir = fs.mkdtempSync(path.join(experiments, 'replay-'));
  const run = path.join(dir, 'run');
  let projectFile = 'project.json', taskFile = 'task.json';
  const [option, reportPath] = process.argv.slice(2);
  if (option) {
    if (option !== '--baseline-report' || !reportPath || process.argv.length !== 4) {
      throw new Error('用法：node experiment.cjs [--baseline-report 报告路径]');
    }
    const file = path.resolve(reportPath);
    const { report } = loadReference(file);
    const project = read(path.join(__dirname, projectFile));
    project.workspace = __dirname;
    project.execution_kind = report.execution_kind;
    project.execution_profile = { mode: 'replay', model: report.model, original_cases: report.cases.length };
    project.baseline_accuracy_report = path.relative(__dirname, file);
    project.evaluate_argv.push(file);
    project.protected_files.push('reference.cjs', path.join(path.dirname(file), report.prompt_snapshot));
    const task = read(path.join(__dirname, taskFile));
    task.max_layers = 1;
    task.objective = '从完整批处理报告重放基线并记录源文件';
    for (const d of Object.values(task.datasets)) d.path = path.resolve(__dirname, d.path);
    if (report.execution_kind === 'real') {
      project.target_calls_per_case_bound = 1;
      project.call_bound_kind = 'project_enforced';
      task.budget.max_target_calls = report.cases.length;
    }
    projectFile = path.join(dir, 'project.json');
    taskFile = path.join(dir, 'task.json');
    fs.writeFileSync(projectFile, JSON.stringify(project));
    fs.writeFileSync(taskFile, JSON.stringify(task));
  }
  call('prepare', '--project', projectFile, '--task', taskFile, '--run', run);
  const rootPlan = path.join(dir, 'root.json');
  fs.writeFileSync(rootPlan, JSON.stringify({ level: 1, nodes: [{}] }));
  const receipt = call('layer-submit', '--run', run, '--plan', rootPlan, '--wait');
  if (option) {
    const root = receipt.nodes[0];
    if (root.status !== 'completed') throw new Error('基线重放失败：' + root.status);
    const result = call('finalize', '--run', run, '--version', root.version_id, '--reason', 'depth_limit');
    console.log(JSON.stringify({ run, report: result.report, source: result.manifest.baseline_source }, null, 2));
  } else compare(dir, receipt);
}
module.exports = { compare };
