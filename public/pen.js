/* Entrada de caneta: converte eventos de ponteiro em mensagens de desenho (coordenadas 0..1 da área compartilhada).
   Usado pela camada sobre o app no Windows e pela pré-via do painel. */
(function (root) {
  'use strict';
  var nextId = 0;
  // Ids únicos por sessão: o mesmo id identifica o desenho no PC e na TV.
  function newId() { return Date.now() * 1000 + (++nextId % 1000); }
  function selection(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }

  // options: point(e) -> {x,y} | null (fora da área), emit(msg), local(msg), zoom(rect), hit(x, y) -> id | null
  root.SalaPen = function (target, options) {
    var settings = { tool: null }, drawing = null, shapeStart = null, erasing = false, start = null, last = null;
    function erase(p) { var id = options.hit(p.x, p.y); if (id !== null) options.emit({ op: 'erase', id: id }); }
    function end() { drawing = shapeStart = null; erasing = false; }
    target.addEventListener('pointerdown', function (e) {
      var p = options.point(e), tool = settings.tool;
      if (!p) return;
      last = p;
      if (tool === 'pen' || tool === 'highlighter' || tool === 'laser') { drawing = newId(); options.emit({ op: 'stroke-start', id: drawing, tool: tool, color: settings.color, size: settings.size, x: p.x, y: p.y }); }
      if (tool === 'shape') shapeStart = { id: newId(), x: p.x, y: p.y };
      if (tool === 'eraser') { erasing = true; erase(p); }
      if (tool === 'select') start = p;
    });
    target.addEventListener('pointermove', function (e) {
      var p = options.point(e);
      if (!p) return;
      last = p;
      if (drawing) options.emit({ op: 'stroke-point', id: drawing, x: p.x, y: p.y });
      if (shapeStart) options.emit({ op: 'shape', id: shapeStart.id, kind: settings.shape, color: settings.color, size: settings.size, x1: shapeStart.x, y1: shapeStart.y, x2: p.x, y2: p.y });
      if (erasing) erase(p);
      if (start) options.local({ op: 'selection', rect: selection(start, p) });
    });
    target.addEventListener('pointerup', function (e) {
      end();
      if (!start) return;
      var rect = selection(start, options.point(e) || last); start = null;
      options.local({ op: 'selection', rect: null });
      if (rect.w > 0.02 && rect.h > 0.02) options.zoom(rect);
    });
    target.addEventListener('pointerleave', function () {
      end();
      if (start) { start = null; options.local({ op: 'selection', rect: null }); }
    });
    return { setTool: function (msg) { settings = msg; end(); start = null; } };
  };

  // Retângulo (px) do conteúdo exibido com object-fit: contain dentro de uma caixa.
  root.SalaPen.fit = function (boxW, boxH, contentW, contentH) {
    var s = Math.min(boxW / contentW, boxH / contentH), w = contentW * s, h = contentH * s;
    return { x: (boxW - w) / 2, y: (boxH - h) / 2, w: w, h: h };
  };
})(window);
