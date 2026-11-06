// Fronteira com o Windows para o monitor virtual: localizar, listar telas conectadas e conectar/desconectar.
// Usa buffers com o layout de DISPLAY_DEVICEW (840 bytes) e DEVMODEW (220 bytes). Pixels físicos.
const MONITOR_ID = 'MTT1337';
const ATTACHED = 1, ENUM_CURRENT_SETTINGS = 0xffffffff;
const DM_POSITION = 0x20, DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, CDS_UPDATEREGISTRY = 1, CDS_NORESET = 0x10000000;
const DD_SIZE = 840, DM_SIZE = 220;

let api = null;
try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  api = {
    enumDevices: user32.func('bool __stdcall EnumDisplayDevicesW(str16 device, uint32 index, _Inout_ uint8_t *info, uint32 flags)'),
    enumSettings: user32.func('bool __stdcall EnumDisplaySettingsW(str16 device, uint32 mode, _Inout_ uint8_t *devmode)'),
    change: user32.func('int32 __stdcall ChangeDisplaySettingsExW(str16 device, uint8_t *devmode, intptr hwnd, uint32 flags, void *param)')
  };
} catch (_) {}

const text = (buf, start, bytes) => buf.toString('utf16le', start, start + bytes).split('\0')[0];
function device(parent, index) {
  const buf = Buffer.alloc(DD_SIZE); buf.writeUInt32LE(DD_SIZE, 0);
  if (!api.enumDevices(parent, index, buf, 0)) return null;
  return { name: text(buf, 4, 64), flags: buf.readUInt32LE(324), id: text(buf, 328, 256) };
}
function adapters() {
  const list = [];
  for (let i = 0; i < 64; i++) { const d = device(null, i); if (!d) break; list.push(d); }
  return list;
}

// { deviceName, attached } do adaptador cujo monitor é o virtual, ou null (driver ausente / fora do Windows).
function findVirtual() {
  if (!api) return null;
  for (const a of adapters()) {
    const monitor = device(a.name, 0);
    if (monitor && monitor.id.includes(MONITOR_ID)) return { deviceName: a.name, attached: (a.flags & ATTACHED) !== 0 };
  }
  return null;
}
// Retângulos das telas conectadas, exceto a indicada (a virtual).
function attachedBounds(exceptDeviceName) {
  if (!api) return [];
  return adapters().filter(a => (a.flags & ATTACHED) && a.name !== exceptDeviceName).map(a => {
    const dm = Buffer.alloc(DM_SIZE); dm.writeUInt16LE(DM_SIZE, 68);
    if (!api.enumSettings(a.name, ENUM_CURRENT_SETTINGS, dm)) return null;
    return { x: dm.readInt32LE(76), y: dm.readInt32LE(80), width: dm.readUInt32LE(172), height: dm.readUInt32LE(176) };
  }).filter(Boolean);
}
// Conecta (bounds) ou desconecta (null). Devolve 0 se deu certo, senão o código do Windows.
function setVirtual(deviceName, bounds) {
  if (!api) return -1;
  const dm = Buffer.alloc(DM_SIZE);
  dm.writeUInt16LE(DM_SIZE, 68);
  dm.writeUInt32LE(DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT, 72);
  if (bounds) { dm.writeInt32LE(bounds.x, 76); dm.writeInt32LE(bounds.y, 80); dm.writeUInt32LE(bounds.width, 172); dm.writeUInt32LE(bounds.height, 176); }
  const staged = api.change(deviceName, dm, 0, CDS_UPDATEREGISTRY | CDS_NORESET, null);
  const applied = api.change(null, null, 0, 0, null);
  return staged || applied;
}
module.exports = { findVirtual, attachedBounds, setVirtual };
