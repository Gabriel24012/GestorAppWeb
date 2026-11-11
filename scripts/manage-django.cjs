const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const windowsPython = path.join(root, 'apps', 'api-django', '.venv', 'Scripts', 'python.exe');
const unixPython = path.join(root, 'apps', 'api-django', '.venv', 'bin', 'python');
const python = process.platform === 'win32' ? windowsPython : unixPython;

if (!fs.existsSync(python)) {
  console.error('No se encontró el virtualenv Django. Sigue los pasos de preparación local del README.');
  process.exit(1);
}

const child = spawn(python, [path.join(root, 'apps', 'api-django', 'manage.py'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
