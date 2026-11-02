/* Caixa flutuante: atalhos para as ferramentas sem voltar ao painel. */
(function () {
  'use strict';
  var STRONG = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#111111'];
  var PALETTES = { pen: STRONG, laser: STRONG, shape: STRONG, highlighter: ['#ffd60a', '#7cfc00', '#00e5ff', '#ff6bd5', '#ff9f0a', '#bf5af2'] };
  var $ = function (id) { return document.getElementById(id); };
  var all = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };
  var state = { sharing: false, settings: { color: {} } }, timerBase = null, lastSince = null;
  function act(msg) { salaToolbar.send(msg); }

  all('[data-tool]').forEach(function (button) { button.onclick = function () { act({ action: 'tool', tool: button.dataset.tool }); }; });
  all('[data-size]').forEach(function (button) { button.onclick = function () { act({ action: 'size', size: button.dataset.size }); }; });
  all('[data-shape]').forEach(function (button) { button.onclick = function () { act({ action: 'shape', shape: button.dataset.shape }); }; });
  ['undo', 'clear', 'off', 'board', 'freeze', 'black', 'mute'].forEach(function (id) { $(id).onclick = function () { act({ action: id }); }; });
  $('share').onclick = function () { act({ action: state.sharing ? 'stop' : 'share' }); };
  $('close').onclick = function () { act({ action: 'hide' }); };
  $('timer').onclick = function () { if (state.sharing) { timerBase = Date.now(); tick(); } };

  function tick() {
    var seconds = timerBase && state.sharing ? Math.floor((Date.now() - timerBase) / 1000) : 0;
    var h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60, pad = function (n) { return (n < 10 ? '0' : '') + n; };
    $('timer').textContent = (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
    $('timer').className = state.sharing ? 'live' : '';
  }
  setInterval(tick, 1000);

  function renderOptions() {
    var palette = PALETTES[state.tool];
    $('options').hidden = !palette;
    if (!palette) return;
    var current = state.settings.color[state.tool], box = $('colors');
    box.textContent = '';
    palette.forEach(function (color) {
      var swatch = document.createElement('button');
      swatch.className = 'swatch' + (color === current ? ' active' : '');
      swatch.style.background = color; swatch.title = color;
      swatch.onclick = function () { act({ action: 'color', tool: state.tool, color: color }); };
      box.appendChild(swatch);
    });
    all('[data-size]').forEach(function (button) { button.classList.toggle('active', button.dataset.size === state.settings.size); });
    $('shapes').hidden = state.tool !== 'shape';
    all('[data-shape]').forEach(function (button) { button.classList.toggle('active', button.dataset.shape === state.settings.shape); });
  }

  salaToolbar.on(function (next) {
    state = next;
    if (next.sharingSince !== lastSince) { lastSince = next.sharingSince; timerBase = next.sharingSince; }
    all('[data-tool]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.tool === next.tool);
      button.disabled = !next.sharing;
    });
    ['undo', 'clear', 'off', 'board', 'freeze', 'black'].forEach(function (id) { $(id).disabled = !next.sharing; });
    $('board').className = next.board === 'white' ? 'active' : next.board === 'black' ? 'black' : '';
    $('board').title = next.board === 'white' ? 'Quadro branco ativo (clique: quadro preto)' : next.board === 'black' ? 'Quadro preto ativo (clique: desligar)' : 'Quadro branco → quadro preto → desligado';
    $('freeze').classList.toggle('active', next.frozen); $('freeze').title = next.frozen ? 'Descongelar imagem na TV' : 'Congelar imagem na TV';
    $('black').classList.toggle('active', next.black); $('black').title = next.black ? 'Mostrar imagem na TV' : 'Tela preta na TV';
    $('mute').classList.toggle('active', next.muted); $('mute').title = next.muted ? 'Ativar som da TV' : 'Silenciar TV';
    all('#mute .sound').forEach(function (el) { el.style.display = next.muted ? 'none' : ''; });
    all('#mute .muted').forEach(function (el) { el.style.display = next.muted ? '' : 'none'; });
    $('share').className = next.sharing ? 'live' : '';
    $('share').title = next.sharing ? 'Parar transmissão' : 'Compartilhar tela ou aplicação';
    document.querySelector('#share .play').style.display = next.sharing ? 'none' : '';
    document.querySelector('#share .stop').style.display = next.sharing ? '' : 'none';
    renderOptions(); tick();
  });
})();
