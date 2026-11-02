const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDevice, deviceProfile } = require('../installer/tizen');

test('lê a resposta da API :8001 da TV Samsung', () => {
  const json = { type: 'Samsung SmartTV', name: 'TV', device: { OS: 'Tizen', PowerState: 'on', developerIP: '192.168.1.15', developerMode: '1', ip: '192.168.1.11', modelName: 'UN70DU8000GXZD', name: 'TV' } };
  assert.deepEqual(parseDevice('192.168.1.11', json), { ip: '192.168.1.11', name: 'TV', model: 'UN70DU8000GXZD', developerMode: true, developerIP: '192.168.1.15', powerOn: true });
  assert.equal(parseDevice('10.0.0.2', { type: 'Roku', device: {} }), null);
  assert.equal(parseDevice('10.0.0.3', { foo: 1 }), null);
  const off = parseDevice('10.0.0.4', { type: 'Samsung SmartTV', device: { OS: 'Tizen', developerMode: '0', developerIP: '0.0.0.0' } });
  assert.equal(off.developerMode, false);
});

test('lê os DUIDs autorizados do device-profile.xml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devprof-'));
  fs.writeFileSync(path.join(dir, 'device-profile.xml'), '<Profile><GrantedPrivilege>Public</GrantedPrivilege><TestDeviceInfo><TestDevice>ABC123XYZ9</TestDevice><TestDevice> DEF456UVW0 </TestDevice></TestDeviceInfo></Profile>');
  assert.deepEqual(deviceProfile(dir), { duids: ['ABC123XYZ9', 'DEF456UVW0'], privilege: 'Public' });
  assert.deepEqual(deviceProfile(path.join(dir, 'nao-existe')), { duids: null, privilege: '' });
});
