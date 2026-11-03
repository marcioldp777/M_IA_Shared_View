const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTargets, serverFor } = require('../discovery');

test('aceita IP, faixa curta, faixa completa, curinga e CIDR', () => {
  assert.deepEqual(parseTargets('192.168.0.115'), ['192.168.0.115']);
  assert.deepEqual(parseTargets('192.168.0.1-3'), ['192.168.0.1', '192.168.0.2', '192.168.0.3']);
  assert.equal(parseTargets('192.168.0.250-192.168.1.5').length, 10); // sem .255 e .0
  assert.equal(parseTargets('192.168.0.*').length, 254);
  assert.equal(parseTargets('192.168.0.0/24').length, 254);
  assert.deepEqual(parseTargets('10.0.0.1, 10.0.0.2 10.0.0.1'), ['10.0.0.1', '10.0.0.2']);
});

test('recusa entradas inválidas e faixas grandes demais', () => {
  assert.throws(() => parseTargets(''), /Digite um IP/);
  assert.throws(() => parseTargets('10.10.300.1'), /inválido/);
  assert.throws(() => parseTargets('192.168.0.9-1'), /grande demais/);
  assert.throws(() => parseTargets('10.0.0.0/16'), /inválido/);
  assert.throws(() => parseTargets('10.0.0.1-10.0.20.1'), /grande demais/);
});

test('escolhe o IP do PC mais próximo da TV', () => {
  assert.equal(serverFor('192.168.0.115', 8787, ['10.0.0.5', '192.168.1.112']), 'http://192.168.1.112:8787');
  assert.equal(serverFor('192.168.0.115', 8787, []), null);
});
