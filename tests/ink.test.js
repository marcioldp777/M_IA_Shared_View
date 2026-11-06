const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const calls = [], props = {};
  const ctx = new Proxy(props, { get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]), set: (target, key, value) => { target[key] = value; calls.push(['set:' + String(key), value]); return true; } });
  const clock = { now: 1000 };
  let frames = [];
  const window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1, addEventListener() {}, requestAnimationFrame: fn => { frames.push(fn); return frames.length; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/ink.js'), 'utf8'), { window, Math, isFinite, Infinity, Date: { now: () => clock.now } });
  const run = () => { const pending = frames; frames = []; calls.length = 0; pending.forEach(fn => fn()); return calls; };
  const names = () => run().map(c => c[0]);
  const video = { videoWidth: 1920, videoHeight: 1080 };
  const ink = window.SalaInk({ getContext: () => ctx }, () => ({ x: 0, y: 0, w: 1920, h: 1080 }), { video, pointer: true });
  return { ink, run, names, clock, pending: () => frames.length };
}

test('anotações: traços, apontador, lupa e limites', () => {
  const { ink, names, pending } = setup();
  ink.handle({ op: 'stroke-start', id: 1, tool: 'pen', x: 0.1, y: 0.1 });
  ink.handle({ op: 'stroke-point', id: 1, x: 0.2, y: 0.2 });
  ink.handle({ op: 'stroke-point', id: 1, x: 'x', y: 0.2 }); // ignorado
  let drawn = names();
  assert.equal(drawn.filter(c => c === 'lineTo').length, 1);
  assert.ok(drawn.includes('stroke'));

  ink.handle({ op: 'stroke-start', id: 2, tool: 'script', x: 0.1, y: 0.1 }); // ferramenta desconhecida
  ink.handle({ op: 'tool', tool: 'pointer' }); ink.handle({ op: 'cursor', x: 0.5, y: 0.5 });
  drawn = names();
  assert.equal(drawn.filter(c => c === 'lineTo').length, 1);
  assert.ok(drawn.includes('arc'));

  ink.handle({ op: 'tool', tool: 'magnifier' }); ink.handle({ op: 'cursor', x: 0.5, y: 0.5 });
  drawn = names();
  assert.ok(drawn.includes('drawImage')); assert.equal(pending(), 1); // lupa continua animando

  ink.handle({ op: 'reset' });
  assert.deepEqual(names().filter(c => !c.startsWith('set:')), ['clearRect']);
});

test('cores, espessura, desfazer e borracha', () => {
  const { ink, run } = setup();
  ink.handle({ op: 'stroke-start', id: 1, tool: 'pen', color: '#0a84ff', size: 'l', x: 0.1, y: 0.5 });
  ink.handle({ op: 'stroke-point', id: 1, x: 0.9, y: 0.5 });
  ink.handle({ op: 'stroke-start', id: 2, tool: 'highlighter', color: 'red;}', x: 0.1, y: 0.1 }); // cor inválida -> padrão
  let calls = run();
  const colors = calls.filter(c => c[0] === 'set:strokeStyle').map(c => c[1]);
  assert.deepEqual(colors, ['#0a84ff', '#ffd60a']);
  assert.equal(calls.find(c => c[0] === 'set:lineWidth')[1], 0.005 * 1.8 * 1080);

  assert.equal(ink.hit(0.5, 0.505), 1);   // sobre a linha da caneta
  assert.equal(ink.hit(0.5, 0.8), null);  // longe de tudo
  ink.handle({ op: 'erase', id: 1 });
  assert.equal(ink.hit(0.5, 0.505), null);

  ink.handle({ op: 'undo' });             // remove o marca-texto
  calls = run();
  assert.equal(calls.filter(c => c[0] === 'stroke').length, 0);
});

test('formas, laser que some, holofote e quadro', () => {
  const { ink, run, clock, pending } = setup();
  ink.handle({ op: 'shape', id: 5, kind: 'rect', x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 });
  ink.handle({ op: 'shape', id: 5, kind: 'rect', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }); // atualiza a mesma forma
  ink.handle({ op: 'shape', id: 6, kind: 'hexagon', x1: 0, y1: 0, x2: 1, y2: 1 });     // tipo desconhecido
  let calls = run();
  const rects = calls.filter(c => c[0] === 'rect');
  assert.equal(rects.length, 1); assert.deepEqual(rects[0].slice(1), [192, 108, 768, 432]);
  assert.equal(ink.hit(0.5, 0.3), 5);     // borda direita do retângulo

  ink.handle({ op: 'stroke-start', id: 7, tool: 'laser', x: 0.3, y: 0.3 });
  run(); assert.equal(pending(), 1);       // laser mantém a animação
  clock.now += 5000;
  calls = run();
  assert.equal(calls.filter(c => c[0] === 'stroke').length, 1); // só a forma sobrou
  assert.equal(pending(), 0);

  ink.handle({ op: 'tool', tool: 'spotlight' }); ink.handle({ op: 'cursor', x: 0.5, y: 0.5 });
  calls = run();
  assert.deepEqual(calls.find(c => c[0] === 'fill').slice(1), ['evenodd']);

  ink.handle({ op: 'board', mode: 'white' });
  calls = run();
  assert.ok(calls.some(c => c[0] === 'set:fillStyle' && c[1] === '#ffffff'));
  assert.equal(calls.filter(c => c[0] === 'stroke').length, 0); // entrar no quadro limpa os desenhos
});

test('ink com options.box usa o tamanho do elemento', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, key) => key in t ? t[key] : (...args) => calls.push([key, ...args]), set: (t, key, value) => { t[key] = value; return true; } });
  let frames = [];
  const window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 2, addEventListener() {}, requestAnimationFrame: fn => { frames.push(fn); return frames.length; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/ink.js'), 'utf8'), { window, Math, isFinite, Infinity, Date: { now: () => 1000 } });
  const canvas = { getContext: () => ctx };
  const ink = window.SalaInk(canvas, () => ({ x: 0, y: 0, w: 640, h: 360 }), { box: () => ({ width: 640, height: 360 }) });
  ink.resize();
  assert.equal(canvas.width, 1280); assert.equal(canvas.height, 720);
  ink.handle({ op: 'board', mode: 'white' });
  calls.length = 0; const pending = frames; frames = []; pending.forEach(fn => fn());
  assert.deepEqual(calls.find(c => c[0] === 'fillRect'), ['fillRect', 0, 0, 640, 360]);
});
