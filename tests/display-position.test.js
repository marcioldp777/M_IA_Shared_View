const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rightEdge } = require('../display-position');

test('monitor virtual encosta na borda direita da tela mais à direita', () => {
  assert.deepEqual(rightEdge([{ x: 0, y: 0, width: 4096, height: 1152 }]), { x: 4096, y: 0 });
  assert.deepEqual(rightEdge([{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -1280, y: -200, width: 1280, height: 1024 }]), { x: 1920, y: 0 });
  assert.deepEqual(rightEdge([{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: -100, width: 2560, height: 1440 }]), { x: 4480, y: -100 });
});

test('sem telas conectadas: origem', () => {
  assert.deepEqual(rightEdge([]), { x: 0, y: 0 });
});

test('empate na borda direita: fica na altura da tela mais alta', () => {
  assert.deepEqual(rightEdge([{ x: 0, y: 500, width: 1920, height: 1080 }, { x: 0, y: -580, width: 1920, height: 1080 }]), { x: 1920, y: -580 });
});
