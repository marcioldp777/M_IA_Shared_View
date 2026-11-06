const { test } = require('node:test');
const assert = require('node:assert/strict');
const { passThrough } = require('../pass-through');

const panel = { x: 100, y: 50, width: 800, height: 600 };

test('cliques passam ao painel só quando ele está em primeiro plano e o cursor está sobre ele', () => {
  assert.equal(passThrough({ x: 300, y: 300 }, panel, true), true);
  assert.equal(passThrough({ x: 300, y: 300 }, panel, false), false);
  assert.equal(passThrough({ x: 50, y: 300 }, panel, true), false);
  assert.equal(passThrough({ x: 900, y: 650 }, panel, true), true); // borda inclusiva
  assert.equal(passThrough({ x: 901, y: 300 }, panel, true), false);
  assert.equal(passThrough({ x: 300, y: 300 }, null, true), false); // sem painel
});
