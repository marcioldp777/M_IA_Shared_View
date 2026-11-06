const { test } = require('node:test');
const assert = require('node:assert/strict');
const { topWindowAt, toOverlayFromPanel } = require('../pass-through');

const rect = (x, y, w, h) => ({ x, y, width: w, height: h });
// Janelas em ordem de empilhamento (a primeira está na frente).
const OVERLAY = 1, TOOLBAR = 2, PANEL = 3, POWERPOINT = 4;
const desktop = [
  { hwnd: OVERLAY, rect: rect(0, 0, 1920, 1080), visible: true },
  { hwnd: TOOLBAR, rect: rect(500, 0, 880, 52), visible: true },
  { hwnd: 99, rect: rect(0, 0, 1920, 1080), visible: true, cloaked: true }, // app UWP oculto
  { hwnd: 98, rect: rect(0, 0, 400, 400), visible: false },
  { hwnd: PANEL, rect: rect(100, 50, 800, 600), visible: true },
  { hwnd: POWERPOINT, rect: rect(0, 0, 1920, 1080), visible: true }
];

test('janela sob o cursor ignora a camada, a caixa, janelas ocultas e invisíveis', () => {
  assert.equal(topWindowAt({ x: 300, y: 300 }, desktop, [OVERLAY, TOOLBAR]), PANEL);
  assert.equal(topWindowAt({ x: 1500, y: 800 }, desktop, [OVERLAY, TOOLBAR]), POWERPOINT);
  assert.equal(topWindowAt({ x: 900, y: 650 }, desktop, [OVERLAY, TOOLBAR]), PANEL); // borda do painel
  assert.equal(topWindowAt({ x: 5000, y: 5000 }, desktop, [OVERLAY, TOOLBAR]), 0);
});

test('painel atrás do PowerPoint não recebe o clique, mesmo com o cursor na área dele', () => {
  const pptInFront = [desktop[0], desktop[5], desktop[4]];
  assert.equal(topWindowAt({ x: 300, y: 300 }, pptInFront, [OVERLAY]), POWERPOINT);
});

test('do painel para a camada vão só os desenhos, não o cursor (holofote/lupa ficam na TV e na pré-via)', () => {
  for (const op of ['stroke-start', 'stroke-point', 'shape', 'erase']) assert.equal(toOverlayFromPanel(op), true, op);
  for (const op of ['cursor', 'zoom', 'tool', 'board']) assert.equal(toOverlayFromPanel(op), false, op);
});

test('janelas que deixam o clique passar (ex.: sobreposição da Ferramenta de Captura) não contam', () => {
  const snip = { hwnd: 77, rect: rect(0, 0, 4096, 1152), visible: true, clickThrough: true };
  assert.equal(topWindowAt({ x: 300, y: 300 }, [snip, ...desktop], [OVERLAY, TOOLBAR]), PANEL);
});
