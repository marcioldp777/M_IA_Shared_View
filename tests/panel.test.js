const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Painel do app Windows rodando com DOM, WebSocket e ponte do Electron falsos.
function setupPanel(order) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const el = { id, hidden: false, textContent: '', value: '', checked: false, disabled: false, className: '', style: {}, dataset: {}, attrs: {},
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
        addEventListener() {}, appendChild() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), clientWidth: 0, clientHeight: 0 };
      elements.set(id, el);
    }
    return elements.get(id);
  };
  let socket;
  class FakeSocket { constructor(url) { this.url = url; this.readyState = 1; this.sent = []; socket = this; } send(raw) { this.sent.push(JSON.parse(raw)); } close() {} }
  const vdd = {
    status: async () => ({ installed: true }),
    install: async () => ({ ok: true }),
    on: async () => { order.push('vdd-on'); return { ok: true }; },
    off: () => order.push('vdd-off')
  };
  const desktop = { vdd, sharing: () => {}, toolbar: () => {}, compact: () => {}, ink: () => {}, onAnnotate() {}, onSearchProgress() {}, searchTvs: async () => null, launchTv: async () => null };
  const sandbox = {
    document: { body: { dataset: { role: 'sender' }, classList: { toggle() {}, contains: () => false } }, getElementById: element, addEventListener() {}, createElement: () => element('created') },
    location: { origin: 'http://localhost:8787', protocol: 'http:', port: '8787' },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { mediaDevices: { getDisplayMedia: async () => { order.push('captura'); throw new Error('cancelado'); } } },
    SalaInk: () => ({ handle() {}, resize() {}, hit: () => null }),
    SalaPen: Object.assign(() => ({ setTool() {} }), { fit: () => ({ x: 0, y: 0, w: 1, h: 1 }) }),
    WebSocket: FakeSocket, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, Uint8Array, Math, JSON, Date, Promise, Object, Array, String
  };
  sandbox.window = sandbox; sandbox.salaDesktop = desktop;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), sandbox);
  return { element, socket: () => socket };
}

test('2º monitor: o monitor virtual continua ligado até a captura começar', async () => {
  const order = [];
  const { element, socket } = setupPanel(order);
  socket().onopen();
  await socket().onmessage({ data: JSON.stringify({ type: 'joined', name: 'Sala (192.168.1.11)' }) });
  assert.equal(element('controls').hidden, false);
  await element('extend').onclick();
  assert.deepEqual(order.slice(0, 2), ['vdd-on', 'captura']); // nada de vdd-off antes da captura
  assert.equal(order.at(-1), 'vdd-off'); // captura cancelada: o monitor é desligado
});
