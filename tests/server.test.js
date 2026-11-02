const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { once } = require('node:events');
const { createServer } = require('../server');
test('lista de TVs, autorização na TV, retransmissão e limpeza', async () => {
  const { server, wss } = createServer({ host: 'PC-TESTE' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}`;
  const clients = [];
  // Fila por cliente: as listas de TVs chegam intercaladas com as demais mensagens.
  async function client() {
    const ws = new WebSocket(url), queue = [], waiters = [];
    ws.on('message', raw => { const msg = JSON.parse(raw); const i = waiters.findIndex(w => w.type === msg.type); if (i >= 0) waiters.splice(i, 1)[0].resolve(msg); else queue.push(msg); });
    ws.next = type => { const i = queue.findIndex(m => m.type === type); if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]); return new Promise(resolve => waiters.push({ type, resolve })); };
    ws.json = data => ws.send(JSON.stringify(data));
    clients.push(ws); await once(ws, 'open'); return ws;
  }
  try {
    const tv = await client(); tv.json({ type: 'join', role: 'tv', id: 'tv-0000-0001', name: 'Sala' });
    assert.equal((await tv.next('joined')).name, 'Sala (127.0.0.1)');
    const sender = await client(); sender.json({ type: 'join', role: 'sender' });
    const list = await sender.next('tvs');
    assert.equal(list.host, 'PC-TESTE'); assert.deepEqual(list.list, [{ id: 'tv-0000-0001', name: 'Sala (127.0.0.1)', busy: false, mine: false }]);

    sender.json({ type: 'command', action: 'black' }); // sem pareamento: não chega na TV
    sender.json({ type: 'request', tv: 'tv-0000-0001', token: 'token-recusado-0001', name: 'PC-TESTE' });
    assert.equal((await tv.next('auth-request')).token, 'token-recusado-0001');
    tv.json({ type: 'auth-response', allow: false });
    assert.equal((await sender.next('error')).message, 'A TV recusou o acesso.');

    sender.json({ type: 'request', tv: 'tv-0000-0001', token: 'token-aceito-00001', name: 'PC-TESTE' });
    await sender.next('waiting'); await tv.next('auth-request');
    tv.json({ type: 'auth-response', allow: true });
    await sender.next('joined'); await tv.next('peer-ready');

    const extra = await client(); extra.json({ type: 'join', role: 'sender' });
    assert.equal((await extra.next('tvs')).list[0].busy, true);
    extra.json({ type: 'request', tv: 'tv-0000-0001', token: 'token-extra-000001', name: 'Outro' });
    assert.match((await extra.next('error')).message, /em uso/);

    sender.json({ type: 'command', action: 'show' }); assert.equal((await tv.next('command')).action, 'show');
    sender.json({ type: 'command', action: 'freeze' }); assert.equal((await tv.next('command')).action, 'freeze');
    tv.json({ type: 'ice', candidate: { candidate: 'candidate:1 1 udp 2122260223 0b7c2d4e-1111-2222-3333-444455556666.local 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
    assert.match((await sender.next('ice')).candidate.candidate, / 127\.0\.0\.1 50000 typ host$/);

    tv.json({ type: 'annotate', op: 'clear' }); // TV não envia anotações
    sender.json({ type: 'annotate', op: 'cursor', x: 0.5, y: 0.25 });
    assert.deepEqual(await tv.next('annotate'), { type: 'annotate', op: 'cursor', x: 0.5, y: 0.25 });
    tv.json({ type: 'status', message: 'ok' }); await sender.next('status');
    assert.equal(await Promise.race([sender.next('annotate'), Promise.resolve('nada')]), 'nada');

    sender.close(); await tv.next('peer-left');
    const page = await fetch(url.replace('ws:', 'http:') + '/tv'); assert.equal(page.status, 200); assert.match(await page.text(), /Pronto para apresentar/);
  } finally { clients.forEach(ws => ws.terminate()); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); }
});
