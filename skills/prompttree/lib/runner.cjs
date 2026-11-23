'use strict';
const { spawn } = require('node:child_process');
const { check, ToolError } = require('./core.cjs');

function argv(template, values) {
  check(Array.isArray(template) && template.length && template.every(s => typeof s === 'string'), 'INVALID_COMMAND', 'argv must be a nonempty string array');
  return template.map(s => s.replace(/\{([a-z_]+)\}/g, (_, key) => {
    check(Object.hasOwn(values, key), 'INVALID_COMMAND', 'Unsupported argv placeholder', { key });
    return String(values[key]);
  }));
}
function redact(text, names) {
  let out = text;
  for (const name of names) if (process.env[name]) out = out.split(process.env[name]).join('[REDACTED]');
  return out;
}
async function execute(template, values, options) {
  const command = argv(template, values);
  const timeout = Math.max(1, Math.floor(options.timeout_ms));
  let child;
  try {
    child = spawn(command[0], command.slice(1), {
      cwd:options.workspace, shell:false, detached:process.platform !== 'win32',
      env:{ ...process.env, PYTHONDONTWRITEBYTECODE:'1' }, stdio:['ignore','pipe','pipe']
    });
  } catch { throw new ToolError('SPAWN_FAILED', 'Cannot start project command'); }
  return new Promise(resolve => {
    let stdout = '', stderr = '', reason = null, spawnError = false;
    const stop = why => {
      if (reason) return;
      reason = why;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch {}
      escalation = setTimeout(() => {
        try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
      }, 500);
      escalation.unref();
    };
    let escalation;
    const timer = setTimeout(() => stop('timeout'), timeout);
    const interrupt = () => stop('interrupted');
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const collect = (kind, chunk) => {
      if (kind === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 256 * 1024) {
        stdout = stdout.slice(0, 65536); stderr = stderr.slice(0, 65536); stop('output_limit');
      }
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', () => { spawnError = true; });
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(escalation);
      process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
      resolve({ code, signal, reason:spawnError ? 'spawn_failed' : reason,
        stdout:redact(stdout, options.env_required || []), stderr:redact(stderr, options.env_required || []) });
    });
  });
}
module.exports = { argv, execute };
