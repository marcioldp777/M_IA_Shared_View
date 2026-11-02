/* Camada transparente sobre o app compartilhado: captura caneta, marca-texto, laser, formas, borracha e seleção de zoom. */
(function () {
  'use strict';
  var ink = SalaInk(document.getElementById('ink'), function () { return { x: 0, y: 0, w: innerWidth, h: innerHeight }; }, { pointer: false });
  var settings = { tool: null }, nextId = 0, drawing = null, shapeStart = null, erasing = false, start = null;
  function point(e) { return { x: e.clientX / innerWidth, y: e.clientY / innerHeight }; }
  function emit(msg) { ink.handle(msg); salaOverlay.send(msg); }
  function selection(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
  function erase(p) { var id = ink.hit(p.x, p.y); if (id !== null) emit({ op: 'erase', id: id }); }
  // Ids únicos por sessão da camada: o mesmo id identifica o desenho no PC e na TV.
  function newId() { return Date.now() * 1000 + (++nextId % 1000); }
  salaOverlay.on(function (msg) {
    ink.handle(msg);
    if (msg.op === 'tool') {
      settings = msg; drawing = shapeStart = start = null; erasing = false;
      document.body.className = msg.tool === 'eraser' ? 'erase' : /pen|highlighter|laser|shape|select/.test(msg.tool || '') ? 'draw' : '';
    }
  });
  addEventListener('pointerdown', function (e) {
    var p = point(e), tool = settings.tool;
    if (tool === 'pen' || tool === 'highlighter' || tool === 'laser') { drawing = newId(); emit({ op: 'stroke-start', id: drawing, tool: tool, color: settings.color, size: settings.size, x: p.x, y: p.y }); }
    if (tool === 'shape') shapeStart = { id: newId(), x: p.x, y: p.y };
    if (tool === 'eraser') { erasing = true; erase(p); }
    if (tool === 'select') start = p;
  });
  addEventListener('pointermove', function (e) {
    var p = point(e);
    if (drawing) emit({ op: 'stroke-point', id: drawing, x: p.x, y: p.y });
    if (shapeStart) emit({ op: 'shape', id: shapeStart.id, kind: settings.shape, color: settings.color, size: settings.size, x1: shapeStart.x, y1: shapeStart.y, x2: p.x, y2: p.y });
    if (erasing) erase(p);
    if (start) ink.handle({ op: 'selection', rect: selection(start, p) });
  });
  addEventListener('pointerup', function (e) {
    drawing = shapeStart = null; erasing = false;
    if (!start) return;
    var rect = selection(start, point(e)); start = null;
    ink.handle({ op: 'selection', rect: null });
    if (rect.w > 0.02 && rect.h > 0.02) salaOverlay.send({ op: 'zoom', rect: rect });
  });
})();
