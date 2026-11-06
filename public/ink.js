/* Anotações em coordenadas normalizadas (0..1) da área compartilhada. Usado pela TV e pela camada sobre o app no Windows. */
(function (root) {
  'use strict';
  var STYLES = {
    pen: { color: '#ff3b30', width: 0.005, alpha: 1 },
    highlighter: { color: '#ffd60a', width: 0.025, alpha: 0.4 },
    laser: { color: '#ff3b30', width: 0.006, alpha: 1 },
    shape: { color: '#ff3b30', width: 0.005, alpha: 1 }
  };
  var SIZES = { s: 0.6, m: 1, l: 1.8 }, KINDS = ['arrow', 'rect', 'ellipse', 'line'], BOARDS = { white: '#ffffff', black: '#0b0b0b' };
  var MAX_ITEMS = 200, MAX_POINTS = 5000, LENS_ZOOM = 2.5, LASER_HOLD = 1500, LASER_FADE = 700, HIT_TOLERANCE = 12;
  function valid(n) { return typeof n === 'number' && isFinite(n) && n > -1 && n < 2; }
  function colorOf(msg, tool) { return typeof msg.color === 'string' && /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : STYLES[tool].color; }
  function sizeOf(msg) { return SIZES[msg.size] ? msg.size : 'm'; }
  function segmentDistance(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
    var t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  // frame(): retângulo em px CSS onde a área compartilhada aparece. options.video: fonte da lupa; options.pointer: desenhar o apontador.
  root.SalaInk = function (canvas, frame, options) {
    var ctx = canvas.getContext('2d'), items = [], tool = null, cursor = null, selection = null, board = null, raf = 0;
    // Tamanho em px CSS: o do elemento (options.box, ex.: pré-via do painel) ou a janela inteira.
    function boxSize() { return options.box ? options.box() : { width: root.innerWidth, height: root.innerHeight }; }
    function resize() {
      var ratio = root.devicePixelRatio || 1, box = boxSize();
      canvas.width = box.width * ratio; canvas.height = box.height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); schedule();
    }
    function at(f, p) { return [f.x + p[0] * f.w, f.y + p[1] * f.h]; }
    function widthOf(item, f) { return STYLES[item.tool].width * SIZES[item.size] * f.h; }
    // Pontos em px de cada parte do item (para desenhar setas/linhas e testar a borracha).
    function corners(item, f) { return [at(f, [item.x1, item.y1]), at(f, [item.x2, item.y2])]; }
    function drawItem(item, f, alpha) {
      ctx.globalAlpha = STYLES[item.tool].alpha * alpha; ctx.strokeStyle = item.color; ctx.lineWidth = widthOf(item, f);
      ctx.beginPath();
      if (item.points) {
        item.points.forEach(function (p, i) { var q = at(f, p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        if (item.points.length === 1) { var q = at(f, item.points[0]); ctx.lineTo(q[0] + 0.1, q[1]); }
      } else {
        var c = corners(item, f), a = c[0], b = c[1];
        if (item.kind === 'rect') ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        else if (item.kind === 'ellipse') ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 || 0.1, Math.abs(b[1] - a[1]) / 2 || 0.1, 0, 0, Math.PI * 2);
        else {
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          if (item.kind === 'arrow') {
            var angle = Math.atan2(b[1] - a[1], b[0] - a[0]), head = Math.max(ctx.lineWidth * 3.5, 0.02 * f.h);
            ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - head * Math.cos(angle - 0.45), b[1] - head * Math.sin(angle - 0.45));
            ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - head * Math.cos(angle + 0.45), b[1] - head * Math.sin(angle + 0.45));
          }
        }
      }
      ctx.stroke();
    }
    function draw() {
      raf = 0;
      var f = frame(), now = Date.now(), fading = false, box = boxSize();
      ctx.clearRect(0, 0, box.width, box.height);
      if (board) { ctx.globalAlpha = 1; ctx.fillStyle = BOARDS[board]; ctx.fillRect(0, 0, box.width, box.height); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      items = items.filter(function (item) { return item.tool !== 'laser' || now - item.last < LASER_HOLD + LASER_FADE; });
      items.forEach(function (item) {
        var alpha = 1;
        if (item.tool === 'laser') { fading = true; alpha = Math.min(1, 1 - (now - item.last - LASER_HOLD) / LASER_FADE); }
        drawItem(item, f, alpha);
      });
      ctx.globalAlpha = 1;
      if (fading) schedule(); // o laser esmaece sozinho
      if (selection) {
        var a = at(f, [selection.x, selection.y]);
        ctx.setLineDash([10, 6]); ctx.lineWidth = 3; ctx.strokeStyle = '#69e6be';
        ctx.fillStyle = 'rgba(105,230,190,.12)';
        ctx.fillRect(a[0], a[1], selection.w * f.w, selection.h * f.h); ctx.strokeRect(a[0], a[1], selection.w * f.w, selection.h * f.h);
        ctx.setLineDash([]);
      }
      if (!cursor) return;
      var c = at(f, cursor);
      if (tool === 'spotlight') {
        ctx.fillStyle = 'rgba(0,0,0,.72)';
        ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.arc(c[0], c[1], 0.18 * f.h, 0, Math.PI * 2); ctx.fill('evenodd');
      }
      if (tool === 'pointer' && options.pointer) {
        ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 0.03 * f.h; ctx.fillStyle = '#ff3b30';
        ctx.beginPath(); ctx.arc(c[0], c[1], 0.012 * f.h, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      if (tool === 'magnifier') {
        var radius = 0.16 * f.h, video = options.video;
        if (video && video.videoWidth) {
          // Recorte do vídeo em torno do cursor, ampliado dentro do círculo.
          var sx = video.videoWidth / f.w, sy = video.videoHeight / f.h, size = (2 * radius) / LENS_ZOOM;
          ctx.save(); ctx.beginPath(); ctx.arc(c[0], c[1], radius, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(video, (c[0] - f.x - size / 2) * sx, (c[1] - f.y - size / 2) * sy, size * sx, size * sy, c[0] - radius, c[1] - radius, radius * 2, radius * 2);
          ctx.restore();
          schedule(); // o vídeo muda: redesenha a lente a cada quadro
        }
        ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(c[0], c[1], radius, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
    function schedule() { if (!raf) raf = root.requestAnimationFrame(draw); }
    function find(id) { for (var i = items.length - 1; i >= 0; i--) if (items[i].id === id) return i; return -1; }
    function add(item) { items.push(item); if (items.length > MAX_ITEMS) items.shift(); }
    // id do desenho (não laser) mais acima perto do ponto, para a borracha.
    function hit(x, y) {
      var f = frame(), p = at(f, [x, y]);
      for (var i = items.length - 1; i >= 0; i--) {
        var item = items[i], reach = HIT_TOLERANCE + widthOf(item, f) / 2, d = Infinity;
        if (item.tool === 'laser') continue;
        if (item.points) {
          var pts = item.points.map(function (q) { return at(f, q); });
          if (pts.length === 1) d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
          for (var j = 1; j < pts.length; j++) d = Math.min(d, segmentDistance(p, pts[j - 1], pts[j]));
        } else {
          var c = corners(item, f), a = c[0], b = c[1];
          if (item.kind === 'rect') {
            var tl = [Math.min(a[0], b[0]), Math.min(a[1], b[1])], br = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
            d = Math.min(segmentDistance(p, tl, [br[0], tl[1]]), segmentDistance(p, [br[0], tl[1]], br), segmentDistance(p, br, [tl[0], br[1]]), segmentDistance(p, [tl[0], br[1]], tl));
          } else if (item.kind === 'ellipse') {
            var rx = Math.abs(b[0] - a[0]) / 2 || 0.1, ry = Math.abs(b[1] - a[1]) / 2 || 0.1, nx = (p[0] - (a[0] + b[0]) / 2) / rx, ny = (p[1] - (a[1] + b[1]) / 2) / ry;
            d = Math.abs(Math.sqrt(nx * nx + ny * ny) - 1) * Math.min(rx, ry);
          } else d = segmentDistance(p, a, b);
        }
        if (d <= reach) return item.id;
      }
      return null;
    }
    function handle(msg) {
      var i;
      if (msg.op === 'tool') { tool = msg.tool || null; if (tool !== 'pointer' && tool !== 'magnifier' && tool !== 'spotlight') cursor = null; }
      if (msg.op === 'cursor') cursor = valid(msg.x) && valid(msg.y) ? [msg.x, msg.y] : null;
      if (msg.op === 'stroke-start' && STYLES[msg.tool] && msg.tool !== 'shape' && valid(msg.x) && valid(msg.y)) {
        add({ id: msg.id, tool: msg.tool, color: colorOf(msg, msg.tool), size: sizeOf(msg), points: [[msg.x, msg.y]], last: Date.now() });
      }
      if (msg.op === 'stroke-point' && valid(msg.x) && valid(msg.y)) {
        i = find(msg.id);
        if (i >= 0 && items[i].points && items[i].points.length < MAX_POINTS) { items[i].points.push([msg.x, msg.y]); items[i].last = Date.now(); }
      }
      if (msg.op === 'shape' && KINDS.indexOf(msg.kind) >= 0 && valid(msg.x1) && valid(msg.y1) && valid(msg.x2) && valid(msg.y2)) {
        var shape = { id: msg.id, tool: 'shape', kind: msg.kind, color: colorOf(msg, 'shape'), size: sizeOf(msg), x1: msg.x1, y1: msg.y1, x2: msg.x2, y2: msg.y2 };
        i = find(msg.id);
        if (i >= 0) items[i] = shape; else add(shape);
      }
      if (msg.op === 'undo') for (i = items.length - 1; i >= 0; i--) if (items[i].tool !== 'laser') { items.splice(i, 1); break; }
      if (msg.op === 'erase') { i = find(msg.id); if (i >= 0) items.splice(i, 1); }
      if (msg.op === 'selection') selection = msg.rect && valid(msg.rect.x) && valid(msg.rect.y) && valid(msg.rect.w) && valid(msg.rect.h) ? msg.rect : null;
      if (msg.op === 'board') { board = BOARDS[msg.mode] ? msg.mode : null; items = []; }
      if (msg.op === 'clear') items = [];
      if (msg.op === 'reset') { items = []; tool = null; cursor = null; selection = null; board = null; }
      schedule();
    }
    root.addEventListener('resize', resize); resize();
    return { handle: handle, redraw: schedule, hit: hit, resize: resize };
  };
})(window);
