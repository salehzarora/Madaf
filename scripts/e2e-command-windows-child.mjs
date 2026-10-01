import { spawn } from 'node:child_process';

// Called only inside the already-assigned Windows Job Object. JSON travels in
// the private child environment, never shell-expanded arguments or public logs.
const spec = JSON.parse(Buffer.from(process.env.MADAF_E2E_OWNED_COMMAND, 'base64').toString('utf8'));
delete process.env.MADAF_E2E_OWNED_COMMAND;
const child = spawn(spec.file, spec.args, { cwd: spec.cwd, env: process.env,
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once('error', () => { process.exitCode = 1; });
child.once('close', code => { process.exitCode = code ?? 1; });
