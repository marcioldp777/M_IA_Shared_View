const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVirtualDisplay } = require('../virtual-display');

const MESSAGE = 'O monitor virtual não respondeu. Reinicie o computador ou reinstale.';
// Windows falso: guarda as chamadas a setVirtual e o estado conectado.
function fakeWin({ found = true, attached = false, result = 0 } = {}) {
  const calls = [];
  const win = {
    calls,
    findVirtual: () => (found ? { deviceName: '\\\\.\\DISPLAY7', attached } : null),
    attachedBounds: () => [{ x: 0, y: 0, width: 4096, height: 1152 }],
    setVirtual: (dev, bounds) => { calls.push(bounds); if (result === 0) attached = !!bounds; return result; }
  };
  return win;
}
// Relógio falso: wait avança o tempo sem esperar de verdade.
function fakeClock() { const clock = { now: 0 }; clock.wait = ms => { clock.now += ms; return Promise.resolve(); }; return clock; }

test('on: conecta na borda direita e devolve o id da tela nova', async () => {
  const win = fakeWin(), clock = fakeClock();
  let polls = 0;
  const screen = { getAllDisplays: () => (++polls >= 3 ? [{ id: 1 }, { id: 99 }] : [{ id: 1 }]) };
  const virtual = createVirtualDisplay({ win, screen, wait: clock.wait });
  assert.equal(await virtual.on(), 99);
  assert.deepEqual(win.calls, [{ x: 4096, y: 0, width: 1920, height: 1080 }]);
});

test('on: tela não aparece em 10 s → desconecta e rejeita com a mensagem do spec', async () => {
  const win = fakeWin(), clock = fakeClock();
  const virtual = createVirtualDisplay({ win, screen: { getAllDisplays: () => [{ id: 1 }] }, wait: clock.wait, timeoutMs: 10000 });
  await assert.rejects(virtual.on(), { message: MESSAGE });
  assert.equal(win.calls.at(-1), null);
  assert.ok(clock.now >= 10000 && clock.now < 11000);
});

test('on: Windows recusa a mudança de vídeo → rejeita', async () => {
  const win = fakeWin({ result: -1 });
  const virtual = createVirtualDisplay({ win, screen: { getAllDisplays: () => [] }, wait: fakeClock().wait });
  await assert.rejects(virtual.on(), { message: MESSAGE });
});

test('on: driver não instalado → rejeita sem mexer no vídeo', async () => {
  const win = fakeWin({ found: false });
  const virtual = createVirtualDisplay({ win, screen: { getAllDisplays: () => [] }, wait: fakeClock().wait });
  await assert.rejects(virtual.on(), { message: MESSAGE });
  assert.equal(win.calls.length, 0);
});

test('off: só desconecta se estiver conectado', () => {
  const idle = fakeWin({ attached: false });
  assert.equal(createVirtualDisplay({ win: idle, screen: {} }).off(), false);
  assert.equal(idle.calls.length, 0);
  const busy = fakeWin({ attached: true });
  assert.equal(createVirtualDisplay({ win: busy, screen: {} }).off(), true);
  assert.deepEqual(busy.calls, [null]);
});

test('isInstalled e disconnectAtStartup (sem driver, não quebra)', () => {
  assert.equal(createVirtualDisplay({ win: fakeWin({ found: false }), screen: {} }).isInstalled(), false);
  assert.equal(createVirtualDisplay({ win: fakeWin(), screen: {} }).isInstalled(), true);
  const broken = { findVirtual() { throw new Error('koffi'); } };
  assert.doesNotThrow(() => createVirtualDisplay({ win: broken, screen: {} }).disconnectAtStartup());
});
