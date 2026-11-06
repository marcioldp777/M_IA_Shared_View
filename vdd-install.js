// Instala o monitor virtual sob demanda: roda vdd/install.ps1 com permissão de administrador (UAC).
// Os arquivos ficam em resources/vdd (extraResources), fora do app.asar, que o PowerShell não consegue ler.
const path = require('node:path');
const INSTALL_FAILED = 'A instalação não foi concluída. Se o Windows pediu permissão, é preciso aceitar; se um antivírus bloqueou, libere o M I.A. Shared View e tente de novo.';

// Aspas para o PowerShell: texto entre aspas simples (' vira ''), com aspas duplas por dentro porque o
// Start-Process junta a lista de argumentos com espaços (caminhos com espaço precisam delas).
const quoted = text => `'"${String(text).replace(/'/g, "''")}"'`;
function elevatedArgs(scriptPath, driverDir) {
  const inner = ["'-NoProfile'", "'-ExecutionPolicy'", "'Bypass'", "'-File'", quoted(scriptPath), "'-DriverDir'", quoted(driverDir)].join(',');
  return ['-NoProfile', '-Command', `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${inner}; exit $p.ExitCode`];
}

// resources: process.resourcesPath no app instalado, a pasta do projeto em desenvolvimento.
function install({ resources, spawn = require('node:child_process').spawn }) {
  const script = path.win32.join(resources, 'vdd', 'install.ps1'), driver = path.win32.join(resources, 'vdd', 'driver');
  return new Promise(resolve => {
    let child;
    try { child = spawn('powershell.exe', elevatedArgs(script, driver), { windowsHide: true }); } catch (_) { return resolve({ ok: false, message: INSTALL_FAILED }); }
    child.on('error', () => resolve({ ok: false, message: INSTALL_FAILED }));
    child.on('exit', code => resolve(code === 0 ? { ok: true } : { ok: false, message: INSTALL_FAILED }));
  });
}
module.exports = { elevatedArgs, install, INSTALL_FAILED };
