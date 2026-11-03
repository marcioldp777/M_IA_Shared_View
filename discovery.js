// Busca de TVs Samsung por IP ou faixa e abertura do receptor apontando para este PC (API remota da TV, porta 8002).
const fs = require('node:fs');
const WebSocket = require('ws');
const { probe, localIPv4 } = require('./installer/tizen');

const APP_ID = 'SalaTV0001.Sala';
const MAX_HOSTS = 4096;

const octet = text => { const n = Number(text); return /^\d{1,3}$/.test(text) && n <= 255 ? n : null; };
const toInt = ip => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const toIp = n => [24, 16, 8, 0].map(shift => Math.floor(n / 2 ** shift) % 256).join('.');
// "192.168.0.115", "192.168.0.1-254", "192.168.0.10-192.168.1.20", "192.168.0.0/24" ou "192.168.0.*", separados por vírgula ou espaço.
function parseTargets(text) {
  const hosts = new Set();
  const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(p => octet(p) !== null);
  const range = (from, to) => {
    if (to < from || to - from + 1 > MAX_HOSTS) throw new Error(`Faixa grande demais (máximo de ${MAX_HOSTS} endereços).`);
    for (let n = from; n <= to; n++) { const last = n % 256; if (last !== 0 && last !== 255) hosts.add(toIp(n)); }
  };
  for (const item of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    let m;
    if (isIp(item)) hosts.add(item);
    else if ((m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\*$/.exec(item)) && isIp(`${m[1]}.0`)) range(toInt(`${m[1]}.1`), toInt(`${m[1]}.254`));
    else if ((m = /^([\d.]+)\/(\d{1,2})$/.exec(item)) && isIp(m[1]) && Number(m[2]) >= 20 && Number(m[2]) <= 32) {
      const size = 2 ** (32 - Number(m[2])), base = toInt(m[1]) - (toInt(m[1]) % size);
      range(base, base + size - 1);
    } else if ((m = /^([\d.]+)-([\d.]+)$/.exec(item)) && isIp(m[1]) && (isIp(m[2]) || octet(m[2]) !== null)) {
      const to = isIp(m[2]) ? m[2] : `${m[1].split('.').slice(0, 3).join('.')}.${m[2]}`;
      range(toInt(m[1]), toInt(to));
    } else throw new Error(`Endereço inválido: "${item}". Use 192.168.0.115, 192.168.0.1-254 ou 192.168.0.0/24.`);
    if (hosts.size > MAX_HOSTS) throw new Error(`Faixa grande demais (máximo de ${MAX_HOSTS} endereços).`);
  }
  if (!hosts.size) throw new Error('Digite um IP ou uma faixa. Ex.: 192.168.0.115 ou 192.168.0.1-254.');
  return [...hosts];
}

async function search(text, { onFound = () => {}, onProgress = () => {}, batch = 64, timeout = 800 } = {}) {
  const hosts = parseTargets(text), found = [];
  for (let i = 0; i < hosts.length; i += batch) {
    const results = await Promise.all(hosts.slice(i, i + batch).map(ip => probe(ip, timeout)));
    for (const tv of results) if (tv) { found.push(tv); onFound(tv); }
    onProgress(Math.min(i + batch, hosts.length), hosts.length);
  }
  return found;
}

// Endereço deste PC que a TV deve usar: o que mais se parece com o IP dela.
function serverFor(tvIp, port, ips = localIPv4()) {
  const common = ip => { let n = 0; for (const [a, b] of ip.split('.').map((p, i) => [p, tvIp.split('.')[i]])) { if (a !== b) break; n++; } return n; };
  const best = [...ips].sort((a, b) => common(b) - common(a))[0];
  return best ? `http://${best}:${port}` : null;
}

// Tokens da API remota por TV: depois da primeira aprovação no controle, a TV não pergunta de novo.
function createLauncher(tokenFile, port) {
  const read = () => { try { return JSON.parse(fs.readFileSync(tokenFile, 'utf8')); } catch (_) { return {}; } };
  return function launch(ip) {
    const server = serverFor(ip, port);
    if (!server) return Promise.resolve({ ok: false, message: 'Este computador não tem um IP de rede local.' });
    const tokens = read(), name = Buffer.from('M I.A. Shared View').toString('base64');
    const url = `wss://${ip}:8002/api/v2/channels/samsung.remote.control?name=${name}${tokens[ip] ? `&token=${tokens[ip]}` : ''}`;
    return new Promise(resolve => {
      let done = false, sent = false;
      const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 });
      const finish = result => { if (done) return; done = true; clearTimeout(timer); try { ws.terminate(); } catch (_) {} resolve(result); };
      const denied = { ok: false, message: 'A TV bloqueou o acesso remoto. Na TV: Configurações → Geral → Gerenciador de dispositivos externos → Gerenciador de conexão de dispositivos → Notificação de acesso; e tire o "M I.A. Shared View" da lista de negados.' };
      // Na primeira vez a TV espera a aprovação no controle remoto.
      const timer = setTimeout(() => finish({ ok: false, message: 'A TV não respondeu. Confirme o acesso no controle remoto e tente de novo.' }), 45000);
      ws.on('message', raw => {
        let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
        if (msg.event === 'ms.channel.connect') {
          if (msg.data?.token) { const all = read(); all[ip] = msg.data.token; try { fs.writeFileSync(tokenFile, JSON.stringify(all, null, 2)); } catch (_) {} }
          ws.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { appId: APP_ID, action_type: 'DEEP_LINK', metaTag: JSON.stringify({ server }) } } }));
          sent = true;
          setTimeout(() => finish({ ok: true, server }), 1500);
        }
        if (msg.event === 'ed.apps.launch') finish(msg.data === 200 || msg.data === '200' || !msg.data ? { ok: true, server } : { ok: false, message: 'A TV não conseguiu abrir o M I.A. Shared View. Confira se o app está instalado nela.' });
        if (msg.event === 'ms.channel.unauthorized' || msg.event === 'ms.channel.timeOut') finish(denied);
      });
      ws.on('error', () => finish({ ok: false, message: 'Não foi possível falar com a TV (porta 8002). Confira se ela está ligada e na mesma rede.' }));
      ws.on('close', () => finish(sent ? { ok: true, server } : denied));
    });
  };
}

module.exports = { parseTargets, search, serverFor, createLauncher };
