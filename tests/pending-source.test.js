const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPending } = require('../pending-source');

test('tela pendente do 2º monitor: usada uma única vez', () => {
  const clock = { now: 0 }, pending = createPending(15000, () => clock.now);
  pending.set('tela-virtual');
  assert.equal(pending.take(), 'tela-virtual');
  assert.equal(pending.take(), null); // o próximo compartilhamento abre o seletor
});

test('tela pendente velha (compartilhamento não aconteceu) é descartada', () => {
  const clock = { now: 0 }, pending = createPending(15000, () => clock.now);
  pending.set('tela-virtual');
  clock.now = 15001;
  assert.equal(pending.take(), null);
});

test('clear descarta a tela pendente', () => {
  const pending = createPending(15000, () => 0);
  pending.set('tela-virtual'); pending.clear();
  assert.equal(pending.take(), null);
});
