const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const plain = o => JSON.parse(JSON.stringify(o)); // objetos do vm têm outro protótipo
function load() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/pen.js'), 'utf8'), { window, Math, Date: { now: () => 1000 } });
  return window.SalaPen;
}
// Alvo falso: guarda os listeners; o evento já traz o ponto normalizado em e.p (ou null = fora da área).
function setup(extra) {
  const SalaPen = load(), listeners = {}, emitted = [], local = [], zooms = [];
  const target = { addEventListener(type, fn) { listeners[type] = fn; } };
  const pen = SalaPen(target, Object.assign({ point: e => e.p, emit: m => emitted.push(plain(m)), local: m => local.push(plain(m)), zoom: r => zooms.push(plain(r)), hit: () => null }, extra));
  const fire = (type, p) => listeners[type]({ p });
  return { pen, fire, emitted, local, zooms };
}

test('caneta: down/move/up geram stroke-start e stroke-point com a cor e espessura da ferramenta', () => {
  const { pen, fire, emitted } = setup();
  pen.setTool({ op: 'tool', tool: 'pen', color: '#ff3b30', size: 'm' });
  fire('pointerdown', { x: 0.1, y: 0.1 }); fire('pointermove', { x: 0.2, y: 0.2 }); fire('pointerup', { x: 0.2, y: 0.2 });
  assert.equal(emitted.length, 2);
  assert.deepEqual({ ...emitted[0], id: 0 }, { op: 'stroke-start', id: 0, tool: 'pen', color: '#ff3b30', size: 'm', x: 0.1, y: 0.1 });
  assert.deepEqual(emitted[1], { op: 'stroke-point', id: emitted[0].id, x: 0.2, y: 0.2 });
});

test('ponto fora da área (point devolve null) não começa traço', () => {
  const { pen, fire, emitted } = setup();
  pen.setTool({ op: 'tool', tool: 'pen', color: '#ff3b30', size: 'm' });
  fire('pointerdown', null); fire('pointermove', { x: 0.2, y: 0.2 });
  assert.equal(emitted.length, 0);
});

test('pointerleave encerra o traço: move posterior não emite', () => {
  const { pen, fire, emitted } = setup();
  pen.setTool({ op: 'tool', tool: 'highlighter', color: '#ffd60a', size: 's' });
  fire('pointerdown', { x: 0.1, y: 0.1 }); fire('pointerleave', null); fire('pointermove', { x: 0.3, y: 0.3 });
  assert.deepEqual(emitted.map(m => m.op), ['stroke-start']);
});

test('formas e borracha usam a forma escolhida e o id achado por hit', () => {
  const { pen, fire, emitted } = setup({ hit: (x, y) => (x === 0.5 && y === 0.5 ? 42 : null) });
  pen.setTool({ op: 'tool', tool: 'shape', color: '#0a84ff', size: 'l', shape: 'rect' });
  fire('pointerdown', { x: 0.1, y: 0.1 }); fire('pointermove', { x: 0.4, y: 0.3 }); fire('pointerup', { x: 0.4, y: 0.3 });
  assert.deepEqual({ ...emitted[0], id: 0 }, { op: 'shape', id: 0, kind: 'rect', color: '#0a84ff', size: 'l', x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.3 });
  pen.setTool({ op: 'tool', tool: 'eraser' });
  fire('pointerdown', { x: 0.5, y: 0.5 });
  assert.deepEqual(emitted.pop(), { op: 'erase', id: 42 });
});

test('seleção: local recebe selection; soltar com 0.3x0.3 chama zoom; 0.01x0.01 não chama', () => {
  const { pen, fire, local, zooms } = setup();
  pen.setTool({ op: 'tool', tool: 'select' });
  fire('pointerdown', { x: 0.2, y: 0.2 }); fire('pointermove', { x: 0.5, y: 0.5 });
  assert.deepEqual(local[0], { op: 'selection', rect: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } });
  fire('pointerup', { x: 0.5, y: 0.5 });
  assert.deepEqual(local.pop(), { op: 'selection', rect: null });
  assert.equal(zooms.length, 1); assert.ok(Math.abs(zooms[0].w - 0.3) < 1e-9);
  fire('pointerdown', { x: 0.2, y: 0.2 }); fire('pointerup', { x: 0.21, y: 0.21 });
  assert.equal(zooms.length, 1);
});

test('fit: conteúdo com faixas pretas dentro da caixa (object-fit: contain)', () => {
  const SalaPen = load();
  assert.deepEqual(plain(SalaPen.fit(640, 360, 4, 3)), { x: 80, y: 0, w: 480, h: 360 });
  assert.deepEqual(plain(SalaPen.fit(640, 480, 16, 9)), { x: 0, y: 60, w: 640, h: 360 });
});
