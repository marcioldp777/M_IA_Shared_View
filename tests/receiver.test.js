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
    WebSocket: FakeSocket, setTimeout() { return 1; }, clearTimeout() {}, Uint8Array, Math, JSON, Date
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
