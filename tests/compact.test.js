const { test } = require('node:test');
const assert = require('node:assert/strict');
const { miniBounds, MINI_SIZE } = require('../compact');

const work = { x: 0, y: 0, width: 1920, height: 1040 }; // área útil (sem a barra de tarefas)
const second = { x: 1920, y: 0, width: 1280, height: 1024 };

test('janela mini: canto inferior direito da tela, com margem de 16 px', () => {
  assert.deepEqual(MINI_SIZE, { width: 400, height: 360 });
  assert.deepEqual(miniBounds([work], work, null), { x: 1920 - 400 - 16, y: 1040 - 360 - 16, width: 400, height: 360 });
});

test('janela mini: usa a posição salva se ela ainda couber em alguma tela', () => {
  assert.deepEqual(miniBounds([work, second], work, { x: 2000, y: 100 }), { x: 2000, y: 100, width: 400, height: 360 });
});

test('janela mini: posição salva fora das telas (monitor desconectado) volta ao canto', () => {
  assert.deepEqual(miniBounds([work], work, { x: 2000, y: 100 }), { x: 1504, y: 664, width: 400, height: 360 });
});
