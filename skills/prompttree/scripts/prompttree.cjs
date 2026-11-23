#!/usr/bin/env node
'use strict';
const { parseArgs } = require('node:util');
const path = require('node:path');
const { VERSION, ToolError } = require('../lib/core.cjs');
const W = require('../lib/workflow.cjs');
const S = require('../lib/store.cjs');
const intake = require('../lib/intake.cjs');
const help = {
  version:VERSION,
  stop_reasons:W.STOP_REASONS,
  usage:[
    'node scripts/prompttree.cjs discover [--workspace DIRECTORY]',
    'node scripts/prompttree.cjs split --dataset CASES.json --group FIELD [--id FIELD] --out NEW_DIRECTORY',
    'node scripts/prompttree.cjs prepare --project project.json --task task.json --run RUN_DIRECTORY',
    'node scripts/prompttree.cjs prepare --run RUN_DIRECTORY',
    'node scripts/prompttree.cjs evaluate --run RUN_DIRECTORY --baseline --split search --request-id baseline-search',
    'node scripts/prompttree.cjs evaluate --run RUN_DIRECTORY --candidate prompt.json --proposal proposal.json --split search --request-id candidate-search',
    'node scripts/prompttree.cjs status --run RUN_DIRECTORY',
    'node scripts/prompttree.cjs finalize --run RUN_DIRECTORY --version VERSION_ID --reason plateau'
  ],
  notes:['Probe only; verify fails before paid execution.', 'Use --repeat for an independent evaluation; a reused request-id is idempotent.',
    'Use --original with --baseline when original_evaluate_argv is configured.', 'The skill directory is portable; Node.js 22+ required.']
};
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new ToolError('UNSUPPORTED_RUNTIME', 'Node.js 22+ required');
  const command = process.argv[2];
  if (!command || ['--help','help','--version'].includes(command)) return help;
  const { values } = parseArgs({ args:process.argv.slice(3), strict:true, options:{
    workspace:{ type:'string' }, dataset:{ type:'string' }, group:{ type:'string' }, id:{ type:'string' }, out:{ type:'string' },
    project:{ type:'string' }, task:{ type:'string' }, run:{ type:'string' }, candidate:{ type:'string' },
    proposal:{ type:'string' }, split:{ type:'string' }, 'request-id':{ type:'string' },
    baseline:{ type:'boolean', default:false }, original:{ type:'boolean', default:false }, repeat:{ type:'boolean', default:false },
    version:{ type:'string' }, reason:{ type:'string' }
  } });
  if (command === 'discover') return intake.discover(values.workspace);
  if (command === 'split') return intake.splitExamples(values);
  if (!values.run) throw new ToolError('INVALID_INPUT', '--run is required');
  const input = { ...values, requestId:values['request-id'] };
  if (command === 'prepare') return W.prepare(input);
  if (command === 'evaluate') return W.evaluate(input);
  if (command === 'status') return W.status(S.open(path.resolve(input.run)));
  if (command === 'finalize') return W.finalize(input);
  throw new ToolError('UNKNOWN_COMMAND', 'Unknown command; use --help');
}
if (require.main === module) main().then(result => {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.ok === false) process.exitCode = 1;
}).catch(error => {
  process.stdout.write(JSON.stringify({ ok:false, phase:['INTEGRITY_ERROR','UNKNOWN_EXECUTION'].includes(error.code) ? 'needs_attention' : undefined,
    error:{ code:error.code || 'TOOL_ERROR', message:error.code ? error.message : 'Command failed; check input and local environment',
      ...(error.details && Object.keys(error.details).length ? { details:error.details } : {}) } }, null, 2) + '\n');
  process.exitCode = 1;
});
module.exports = { main };
