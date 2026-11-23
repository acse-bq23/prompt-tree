'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const C = require('./core.cjs');
const S = require('./store.cjs');
const R = require('./runner.cjs');

// Survives loss of the layer worker and records the evaluator's actual exit before waking it.
async function execute(root,id) {
  const store = S.open(root), { contract } = store;
  const run = Object.values(S.state(store).runs).find(r => r.request_id === id);
  C.check(run?.status === 'unknown' && contract.task.max_layers, 'INVALID_REQUEST','Missing layer reservation');
  const file = name => C.inside(root,'runs/'+id+'/'+name);
  const owner = file('owner-'+process.pid+'.json');
  C.writeJSON(owner,{ pid:process.pid,run_id:run.run_id });
  try { fs.linkSync(owner,file('dispatch.json')); } finally { fs.unlinkSync(owner); }
  const { project } = contract;
  const argv = run.kind === 'original' ? project.original_evaluate_argv : project.evaluate_argv;
  const command = await R.execute(argv,{
    candidate_file:file('candidate.json'),dataset_file:contract.task.datasets[run.split].path,
    result_file:file('result.json'),request_file:file('request.json'),max_target_calls:run.reserved_calls
  },{ workspace:project.workspace,env_required:project.env_required,
    timeout_ms:Math.min(project.runner_timeout_seconds*1000,Date.parse(contract.deadline_at)-Date.now()) });
  C.writeJSON(file('exit.json'),{ run_id:run.run_id,command });
}
async function receipt(root,run) {
  const dir = C.inside(root,'runs/'+run.request_id);
  const exitFile = path.join(dir,'exit.json'), dispatch = path.join(dir,'dispatch.json');
  const start = Date.now(), deadline = Date.parse(C.readJSON(path.join(root,'contract.json')).deadline_at);
  while (!fs.existsSync(exitFile)) {
    if (fs.existsSync(dispatch)) {
      const owner = C.readJSON(dispatch);
      let alive = true;
      try { process.kill(owner.pid,0); } catch (e) { alive = e.code !== 'ESRCH'; }
      C.check(alive && owner.run_id === run.run_id && Date.now()<deadline+2000, 'UNKNOWN_EXECUTION','No confirmed evaluator exit; retain the reservation');
    } else C.check(Date.now()-start < 2000,'UNKNOWN_EXECUTION','Dispatch could not be confirmed');
    await delay(100);
  }
  const result = C.readJSON(exitFile);
  C.check(result.run_id === run.run_id,'INTEGRITY_ERROR','Receipt belongs to another reservation');
  return result.command;
}
function launch(root,id) {
  const child = spawn(process.execPath,[__filename,root,id],{ detached:true,stdio:'ignore' });
  return new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('exit',resolve);
  });
}
if (require.main === module) execute(process.argv[2],process.argv[3]).catch(()=>{ process.exitCode=1; });
module.exports = { launch, receipt };
