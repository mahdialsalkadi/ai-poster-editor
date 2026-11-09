import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Test fixture: stays alive and starts a grandchild so the parent can verify
// that a timeout kills the whole process group.
const pidFile = process.argv[2];
if (!pidFile) process.exit(2);
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
writeFileSync(pidFile, String(grandchild.pid));
globalThis.setInterval(() => {}, 1_000);
