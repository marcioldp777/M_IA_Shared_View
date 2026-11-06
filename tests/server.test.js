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
    sender.json({ type: 'hint', lowRes: true }); // só a TV pede 720p
    tv.json({ type: 'hint', lowRes: true, decodeMs: 100 }); assert.equal((await sender.next('hint')).decodeMs, 100);
    sender.json({ type: 'command', action: 'show' }); await tv.next('command');
    assert.equal(await Promise.race([tv.next('hint'), Promise.resolve('nada')]), 'nada');
    tv.json({ type: 'ice', candidate: { candidate: 'candidate:1 1 udp 2122260223 0b7c2d4e-1111-2222-3333-444455556666.local 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
    assert.match((await sender.next('ice')).candidate.candidate, / 127\.0\.0\.1 50000 typ host$/);

    tv.json({ type: 'annotate', op: 'clear' }); // TV não envia anotações
    sender.json({ type: 'annotate', op: 'cursor', x: 0.5, y: 0.25 });
    assert.deepEqual(await tv.next('annotate'), { type: 'annotate', op: 'cursor', x: 0.5, y: 0.25 });
    tv.json({ type: 'status', message: 'stats recebido 1280x720 30fps' }); // diagnóstico desligado: descartado
    tv.json({ type: 'status', message: 'ok' }); assert.equal((await sender.next('status')).message, 'ok');
    assert.equal(await Promise.race([sender.next('annotate'), Promise.resolve('nada')]), 'nada');

    extra.json({ type: 'rename', name: 'Invasor' }); // não pareado: recusado
    assert.match((await extra.next('error')).message, /Conecte-se/);
    sender.json({ type: 'rename', name: '  Marcio   TV ' });
    assert.deepEqual(await tv.next('renamed'), { type: 'renamed', name: 'Marcio TV', full: 'Marcio TV (127.0.0.1)' });
    assert.equal((await sender.next('renamed')).full, 'Marcio TV (127.0.0.1)');
    let names;
    do names = (await extra.next('tvs')).list.map(t => t.name); while (names[0] !== 'Marcio TV (127.0.0.1)');

    sender.close(); await tv.next('peer-left');
    const page = await fetch(url.replace('ws:', 'http:') + '/tv'); assert.equal(page.status, 200); assert.match(await page.text(), /Pronto para apresentar/);
  } finally { clients.forEach(ws => ws.terminate()); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); }
});

test('ping identifica o app e TV apresentando para outro PC aparece em uso', async () => {
  const { server } = createServer({ host: 'PC-TESTE' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `127.0.0.1:${server.address().port}`;
  const opened = [];
  const open = async () => { const ws = new WebSocket(`ws://${base}`); opened.push(ws); await once(ws, 'open'); return ws; };
  try {
    const res = await fetch(`http://${base}/ping`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await res.json(), { app: 'sala-tv', host: 'PC-TESTE' });

    const tv = await open();
    tv.send(JSON.stringify({ type: 'join', role: 'tv', id: 'tv-0000-0002', name: 'Sala' }));
    const [joined] = await once(tv, 'message');
    assert.equal(JSON.parse(joined).ip, '127.0.0.1');
    const sender = await open();
    const lists = [];
    sender.on('message', raw => { const msg = JSON.parse(raw); if (msg.type === 'tvs') lists.push(msg.list); });
    sender.send(JSON.stringify({ type: 'join', role: 'sender' }));
    while (!lists.length) await once(sender, 'message');
    assert.equal(lists.at(-1)[0].busy, false);
    tv.send(JSON.stringify({ type: 'presence', busy: true }));
    while (!lists.at(-1)[0].busy) await once(sender, 'message');
    sender.send(JSON.stringify({ type: 'request', tv: 'tv-0000-0002', token: 'token-qualquer-0001', name: 'PC' }));
    let error;
    sender.on('message', raw => { const msg = JSON.parse(raw); if (msg.type === 'error') error = msg; });
    while (!error) await once(sender, 'message');
    assert.match(error.message, /em uso/);
  } finally { opened.forEach(ws => ws.terminate()); server.close(); }
});

test('painel: todo script e estilo citado no index.html é servido', async () => {
  const { server } = createServer({ host: 'PC-TESTE' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const html = require('node:fs').readFileSync(require.resolve('../public/index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map(m => m[1]);
    assert.ok(refs.includes('/pen.js'));
    for (const ref of refs) assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${ref}`)).status, 200, ref);
  } finally { server.close(); }
});
