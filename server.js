const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WebSocketServer, WebSocket } = require('ws');
const AUTH_TIMEOUT = 60000;
function createServer({ log = () => {}, host = os.hostname() } = {}) {
  // id da TV -> { tv, name, sender, pending: { ws, timer } }
  const tvs = new Map();
  const senders = new Set();
  const send = (target, data) => { if (target?.readyState === WebSocket.OPEN) target.send(JSON.stringify(data)); };
  function broadcast() {
    for (const ws of senders) send(ws, { type: 'tvs', host, list: [...tvs].map(([id, e]) => ({ id, name: e.name, busy: !!e.sender && e.sender !== ws, mine: e.sender === ws })) });
  }
  function cancelPending(entry, reason) {
    if (!entry.pending) return;
    clearTimeout(entry.pending.timer);
    if (reason) send(entry.pending.ws, { type: 'error', message: reason });
    send(entry.tv, { type: 'auth-cancel' });
    entry.pending = null;
  }
  function unpair(entry) {
    if (!entry.sender) return;
    entry.sender.sala.tv = null; entry.sender = null;
    send(entry.tv, { type: 'peer-left' });
  }
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const files = { '/': 'public/index.html', '/tv': 'tv/index.html', '/app.js': 'public/app.js', '/style.css': 'public/style.css', '/ink.js': 'public/ink.js' };
    if (!files[pathname]) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(__dirname, files[pathname])).pipe(res);
  });
  const wss = new WebSocketServer({ server, maxPayload: 12 * 1024 * 1024 });
  wss.on('connection', (ws, req) => {
    // tv: id desta TV (role tv) ou da TV pareada (role sender)
    const state = ws.sala = { role: null, tv: null };
    const ip = req.socket.remoteAddress.replace(/^::ffff:/, '');
    // A TV anuncia candidatos ICE como "<uuid>.local" (mDNS), que o Windows em rede Pública não resolve.
    // Troca pelo IP real para o computador iniciar a conexão de mídia até a TV.
    const unmask = text => text.replace(/[0-9a-f-]{36}\.local/gi, ip);
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return ws.close(1003); }
      if (msg.type === 'join' && !state.role) {
        if (msg.role === 'tv') {
          if (typeof msg.id !== 'string' || !/^[\w-]{8,64}$/.test(msg.id)) return ws.close(1008);
          const old = tvs.get(msg.id);
          if (old) { cancelPending(old, 'A TV reconectou. Tente novamente.'); send(old.sender, { type: 'peer-left' }); unpair(old); old.tv.terminate(); }
          state.role = 'tv'; state.tv = msg.id;
          tvs.set(msg.id, { tv: ws, name: `${String(msg.name || 'TV').slice(0, 40)} (${ip})`, sender: null, pending: null });
          send(ws, { type: 'joined', name: tvs.get(msg.id).name });
          return broadcast();
        }
        if (msg.role !== 'sender') return ws.close(1008);
        state.role = 'sender'; senders.add(ws);
        return broadcast();
      }
      if (state.role === 'sender' && msg.type === 'request') {
        const entry = tvs.get(msg.tv);
        if (state.tv) return send(ws, { type: 'error', message: 'Desconecte da TV atual antes de escolher outra.' });
        if (typeof msg.token !== 'string' || !/^[\w-]{16,128}$/.test(msg.token)) return send(ws, { type: 'error', message: 'Pedido inválido.' });
        if (!entry) return send(ws, { type: 'error', message: 'TV não encontrada. Ela pode ter desligado.' });
        if (entry.sender) return send(ws, { type: 'error', message: 'Esta TV já está em uso por outro computador.' });
        if (entry.pending && entry.pending.ws !== ws) return send(ws, { type: 'error', message: 'A TV está respondendo a outro pedido. Tente em instantes.' });
        if (entry.pending) clearTimeout(entry.pending.timer);
        entry.pending = { ws, timer: setTimeout(() => cancelPending(entry, 'A TV não respondeu ao pedido de acesso.'), AUTH_TIMEOUT) };
        send(entry.tv, { type: 'auth-request', token: msg.token, name: String(msg.name || 'Computador').slice(0, 60) });
        return send(ws, { type: 'waiting', name: entry.name });
      }
      if (state.role === 'sender' && msg.type === 'leave') {
        const entry = tvs.get(state.tv);
        if (entry?.sender === ws) unpair(entry);
        for (const e of tvs.values()) if (e.pending?.ws === ws) cancelPending(e);
        send(ws, { type: 'left' });
        return broadcast();
      }
      if (state.role === 'tv' && msg.type === 'auth-response') {
        const entry = tvs.get(state.tv), pending = entry?.pending;
        if (!pending) return;
        clearTimeout(pending.timer); entry.pending = null;
        if (pending.ws.readyState !== WebSocket.OPEN) return;
        if (!msg.allow) return send(pending.ws, { type: 'error', message: 'A TV recusou o acesso.' });
        entry.sender = pending.ws; pending.ws.sala.tv = state.tv;
        send(pending.ws, { type: 'joined', name: entry.name }); send(ws, { type: 'peer-ready' });
        return broadcast();
      }
      if (!['offer', 'answer', 'ice', 'command', 'image', 'status', 'annotate'].includes(msg.type)) return;
      const entry = tvs.get(state.tv);
      if (!entry || (state.role === 'sender' && entry.sender !== ws)) return;
      if (msg.type === 'annotate' && state.role !== 'sender') return;
      if (msg.type === 'image' && (state.role !== 'sender' || typeof msg.data !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(msg.data))) return;
      if (state.role === 'tv' && typeof msg.candidate?.candidate === 'string') msg.candidate.candidate = unmask(msg.candidate.candidate);
      if (state.role === 'tv' && typeof msg.description?.sdp === 'string') msg.description.sdp = unmask(msg.description.sdp);
      if (msg.type !== 'annotate') log(`${state.role} ${ip} ${msg.type} ${msg.type === 'ice' ? msg.candidate?.candidate : msg.type === 'image' ? msg.data.length : JSON.stringify(msg.action ?? msg.message ?? msg.description?.type ?? '')}${msg.type === 'answer' ? ' codecs=' + (msg.description?.sdp?.match(/^a=rtpmap:\d+ [^/]+/gm) || []).map(l => l.split(' ')[1]).filter((c, i, a) => a.indexOf(c) === i).join(',') : ''}`);
      send(state.role === 'tv' ? entry.sender : entry.tv, msg);
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (state.role === 'sender') {
        senders.delete(ws);
        for (const entry of tvs.values()) {
          if (entry.pending?.ws === ws) cancelPending(entry);
          if (entry.sender === ws) unpair(entry);
        }
        return broadcast();
      }
      const entry = tvs.get(state.tv);
      if (state.role !== 'tv' || entry?.tv !== ws) return;
      cancelPending(entry, 'A TV desconectou.');
      if (entry.sender) { send(entry.sender, { type: 'peer-left' }); entry.sender.sala.tv = null; }
      tvs.delete(state.tv);
      broadcast();
    });
  });
  return { server, wss };
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  createServer().server.listen(port, '0.0.0.0', () => {
    console.log(`Painel: http://localhost:${port}`);
    for (const addresses of Object.values(os.networkInterfaces())) for (const a of addresses || []) if (a.family === 'IPv4' && !a.internal) console.log(`TV: http://${a.address}:${port}/tv`);
  });
}
module.exports = { createServer };
