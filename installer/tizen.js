// Integração com a TV Samsung: descoberta na rede, sdb (Tizen Studio) e perfis de certificado já existentes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SDB_PORT = 26101;
const REMOTE_TMP = '/home/owner/share/tmp/sdk_tools/tmp';

// ---------- Descoberta: a TV responde em http://IP:8001/api/v2/ ----------
function parseDevice(ip, json) {
  const d = json && json.device;
  if (!d || !/samsung/i.test(json.type || d.type || '') || !/tizen/i.test(d.OS || 'tizen')) return null;
  return {
    ip: d.ip || ip, name: d.name || json.name || 'Samsung TV', model: d.modelName || d.model || '',
    developerMode: d.developerMode === '1', developerIP: d.developerIP || '', powerOn: d.PowerState !== 'standby'
  };
}
async function probe(ip, timeout = 1500) {
  try {
    const res = await fetch(`http://${ip}:8001/api/v2/`, { signal: AbortSignal.timeout(timeout) });
    return res.ok ? parseDevice(ip, await res.json()) : null;
  } catch (_) { return null; }
}
function localIPv4() {
  return Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal && /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(a.address)).map(a => a.address);
}
// Varre as sub-redes /24 locais em paralelo
async function scan(onFound) {
  const hosts = [...new Set(localIPv4().map(ip => ip.split('.').slice(0, 3).join('.')))].flatMap(prefix => Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`));
  const found = [];
  for (let i = 0; i < hosts.length; i += 64) {
    const batch = await Promise.all(hosts.slice(i, i + 64).map(ip => probe(ip, 700)));
    for (const tv of batch) if (tv) { found.push(tv); if (onFound) onFound(tv); }
  }
  return found;
}

// ---------- Tizen Studio: sdb e perfis de assinatura ----------
function tizenRoots(extra = []) {
  const candidates = [...extra, process.env.TIZEN_STUDIO, 'C:\\tizen-studio', 'D:\\tizen-studio', path.join(os.homedir(), 'tizen-studio')];
  return [...new Set(candidates.filter(Boolean))].filter(dir => fs.existsSync(path.join(dir, 'tools', 'sdb.exe')) || fs.existsSync(path.join(dir, 'sdk.info')));
}
function findSdb(extraRoots) {
  if (process.env.SDB_PATH && fs.existsSync(process.env.SDB_PATH)) return process.env.SDB_PATH;
  for (const root of tizenRoots(extraRoots)) { const sdb = path.join(root, 'tools', 'sdb.exe'); if (fs.existsSync(sdb)) return sdb; }
  return null;
}
function dataDirs(extraRoots) {
  const dirs = tizenRoots(extraRoots).map(root => {
    try { return /TIZEN_SDK_DATA_PATH=(.+)/.exec(fs.readFileSync(path.join(root, 'sdk.info'), 'utf8'))[1].trim(); } catch (_) { return `${root}-data`; }
  });
  return [...new Set([...dirs, path.join(os.homedir(), 'tizen-studio-data')])].filter(dir => fs.existsSync(dir));
}
// Perfis do Certificate Manager (só caminhos e DUIDs; senhas são pedidas ao usuário)
function profiles(extraRoots) {
  const list = [];
  for (const dir of dataDirs(extraRoots)) {
    let xml;
    try { xml = fs.readFileSync(path.join(dir, 'profile', 'profiles.xml'), 'utf8'); } catch (_) { continue; }
    for (const m of xml.matchAll(/<profile name="([^"]+)">([\s\S]*?)<\/profile>/g)) {
      const key = role => (new RegExp(`distributor="${role}"[^>]*key="([^"]*)"`).exec(m[2]) || [])[1] || '';
      const author = key(0), distributor = key(1);
      if (!author || !distributor) continue;
      list.push({ name: m[1], author, distributor, ...deviceProfile(path.dirname(distributor)) });
    }
  }
  return list;
}
// device-profile.xml (gerado pela extensão Samsung): DUIDs autorizados e privilégio
function deviceProfile(dir) {
  try {
    const xml = fs.readFileSync(path.join(dir, 'device-profile.xml'), 'utf8');
    return { duids: [...xml.matchAll(/<TestDevice>([^<]+)<\/TestDevice>/g)].map(m => m[1].trim()), privilege: (/<GrantedPrivilege>([^<]+)</.exec(xml) || [])[1] || '' };
  } catch (_) { return { duids: null, privilege: '' }; }
}

// ---------- sdb ----------
function sdb(sdbPath, args, timeout = 60000) {
  return new Promise((resolve, reject) => execFile(sdbPath, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
    const out = `${stdout || ''}${stderr || ''}`.trim();
    if (error && !out) reject(new Error(error.message)); else resolve(out);
  }));
}
async function connect(sdbPath, ip) {
  const out = await sdb(sdbPath, ['connect', `${ip}:${SDB_PORT}`], 20000);
  if (!/connected/i.test(out) || /fail|unable|refused/i.test(out)) throw new Error(`Não foi possível conectar à TV (${out}). Confira o modo desenvolvedor e o IP do PC configurado nele.`);
}
async function getDuid(sdbPath, ip) {
  const out = await sdb(sdbPath, ['-s', `${ip}:${SDB_PORT}`, 'shell', '0', 'getduid']);
  const duid = out.split(/\r?\n/).map(s => s.trim()).find(s => /^[A-Z0-9]{8,}$/.test(s));
  if (!duid) throw new Error(`Não foi possível ler o DUID da TV (${out}).`);
  return duid;
}
async function install(sdbPath, ip, wgtPath, packageId) {
  const target = `${REMOTE_TMP}/${packageId}.wgt`, device = ['-s', `${ip}:${SDB_PORT}`];
  const pushed = await sdb(sdbPath, [...device, 'push', wgtPath, target], 120000);
  if (!/pushed/i.test(pushed)) throw new Error(`Falha ao enviar o pacote para a TV (${pushed}).`);
  const out = await sdb(sdbPath, [...device, 'shell', '0', 'vd_appinstall', packageId, target], 180000);
  if (!/install completed/i.test(out)) throw new Error(`A TV recusou a instalação:\n${out}`);
  return out;
}
const launch = (sdbPath, ip, appId) => sdb(sdbPath, ['-s', `${ip}:${SDB_PORT}`, 'shell', '0', 'execute', appId]);

module.exports = { parseDevice, probe, scan, localIPv4, findSdb, profiles, deviceProfile, connect, getDuid, install, launch };
