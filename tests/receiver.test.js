const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('receptor conecta sozinho, pede autorização uma vez e depois lembra', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', hidden: false, focus() {} });
    return elements.get(id);
  };
  let socket;
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; socket = this; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
  }
  const last = type => socket.sent.filter(m => m.type === type).pop();
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), {
    document: {
      body: { dataset: { role: 'tv', server: 'http://192.168.1.15:8787' } },
      getElementById: element, addEventListener() {}
    },
    location: { protocol: 'file:', port: '' },
    localStorage: { getItem() { throw new Error('Unavailable'); }, setItem() { throw new Error('Unavailable'); } },
    WebSocket: FakeSocket, setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, Uint8Array, Math, JSON, Date
  });
  assert.equal(socket.url, 'ws://192.168.1.15:8787');
  socket.onopen();
  const join = last('join');
  assert.equal(join.role, 'tv'); assert.match(join.id, /^[0-9a-f]{48}$/); assert.equal(join.name, 'Samsung TV');
  await socket.onmessage({ data: JSON.stringify({ type: 'joined', name: 'Samsung TV (192.168.1.11)' }) });
  assert.equal(element('tvName').textContent, 'Samsung TV (192.168.1.11)');
  assert.equal(element('setup').hidden, true);

  const request = JSON.stringify({ type: 'auth-request', token: 'token-do-pc-000001', name: 'PC-MARCIO' });
  await socket.onmessage({ data: request });
  assert.equal(element('auth').hidden, false); assert.equal(element('authName').textContent, 'PC-MARCIO');
  assert.equal(last('auth-response'), undefined);
  element('allow').onclick();
  assert.equal(last('auth-response').allow, true); assert.equal(element('auth').hidden, true);

  socket.sent = [];
  await socket.onmessage({ data: request });
  assert.equal(last('auth-response').allow, true); assert.equal(element('auth').hidden, true);
});

test('app Android: nome do aparelho, Voltar recusa pedido e descoberta troca o endereço', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', hidden: false, focus() {} });
    return elements.get(id);
  };
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
  }
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), {
    window, SalaAndroid: { deviceName: () => 'Fire TV da Sala' },
    document: { body: { dataset: { role: 'tv', server: 'http://192.168.1.15:8787' } }, getElementById: element, addEventListener() {} },
    location: { protocol: 'file:', port: '' },
    localStorage: { getItem() { return null; }, setItem() {} },
    WebSocket: FakeSocket, setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, Uint8Array, Math, JSON, Date
  });
  const first = sockets[0];
  assert.equal(first.url, 'ws://192.168.1.15:8787');

  // PC mudou de IP: o endereço antigo não abre e o anúncio chega com o novo.
  first.onclose();
  window.salaDiscovered('http://192.168.1.20:8787');
  const second = sockets[sockets.length - 1];
  assert.equal(second.url, 'ws://192.168.1.20:8787');
  assert.equal(element('server').value, 'http://192.168.1.20:8787');
  second.readyState = 1; second.onopen();
  assert.equal(second.sent.find(m => m.type === 'join').name, 'Fire TV da Sala');

  window.salaDiscovered('http://192.168.1.30:8787'); // já conectado: ignora
  assert.equal(sockets.length, 2); // o endereço salvo e o descoberto; nenhum novo

  await second.onmessage({ data: JSON.stringify({ type: 'auth-request', token: 'token-do-pc-000001', name: 'PC' }) });
  assert.equal(window.salaBack(), true); // com pedido aberto: só recusa
  assert.equal(second.sent.filter(m => m.type === 'auth-response').pop().allow, false);

  assert.equal(window.salaBack(), true); // 1º Voltar: avisa
  assert.equal(element('status').textContent, 'Pressione Voltar novamente para sair.');
  assert.equal(window.salaBack(), false); // 2º em seguida: pode sair
});
