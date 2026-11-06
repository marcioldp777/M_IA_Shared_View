/* Camada transparente sobre o app compartilhado: captura caneta, marca-texto, laser, formas, borracha e seleção de zoom. */
(function () {
  'use strict';
  var ink = SalaInk(document.getElementById('ink'), function () { return { x: 0, y: 0, w: innerWidth, h: innerHeight }; }, { pointer: false });
  function emit(msg) { ink.handle(msg); salaOverlay.send(msg); }
  var pen = SalaPen(window, {
    point: function (e) { return { x: e.clientX / innerWidth, y: e.clientY / innerHeight }; },
    emit: emit,
    local: ink.handle,
    zoom: function (rect) { salaOverlay.send({ op: 'zoom', rect: rect }); },
    hit: ink.hit
  });
  salaOverlay.on(function (msg) {
    ink.handle(msg);
    if (msg.op === 'tool') {
      pen.setTool(msg);
      document.body.className = msg.tool === 'eraser' ? 'erase' : /pen|highlighter|laser|shape|select/.test(msg.tool || '') ? 'draw' : '';
    }
  });
})();
