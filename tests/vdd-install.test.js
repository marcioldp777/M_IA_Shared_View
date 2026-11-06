const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { elevatedArgs, install, INSTALL_FAILED } = require('../vdd-install');

test('elevatedArgs: pede administrador, espera e devolve o código de saída; cita caminhos com espaço e apóstrofo', () => {
  const args = elevatedArgs('C:\\Program Files\\M I.A. Shared View\\resources\\vdd\\install.ps1', "C:\\Users\\O'Brien\\vdd\\driver");
  const command = args.join(' ');
  assert.match(command, /-Verb RunAs/);
  assert.match(command, /-Wait/);
  assert.match(command, /exit \$p\.ExitCode/);
  assert.ok(command.includes("C:\\Users\\O''Brien\\vdd\\driver"));
  assert.ok(command.includes('C:\\Program Files\\M I.A. Shared View\\resources\\vdd\\install.ps1'));
});

// spawn falso: um processo que termina com o código pedido.
const fakeSpawn = code => (file, args) => {
  const child = new EventEmitter();
  child.file = file; child.args = args;
  setImmediate(() => child.emit('exit', code));
  return child;
};

test('install: saída 0 → ok', async () => {
  assert.deepEqual(await install({ resources: 'C:\\app\\resources', spawn: fakeSpawn(0) }), { ok: true });
});

test('install: UAC recusado ou antivírus (saída ≠ 0) → mensagem clara', async () => {
  assert.deepEqual(await install({ resources: 'C:\\app\\resources', spawn: fakeSpawn(1) }), { ok: false, message: INSTALL_FAILED });
  assert.match(INSTALL_FAILED, /aceitar/); assert.match(INSTALL_FAILED, /antivírus/);
});

test('elevatedArgs: falha do Start-Process (UAC recusado) sai com 1, não com 0', () => {
  const command = elevatedArgs('C:\\a\\install.ps1', 'C:\\a\\driver')[2];
  assert.match(command, /^try \{ \$p = Start-Process .* -ErrorAction Stop; exit \$p\.ExitCode \} catch \{ exit 1 \}$/);
});
