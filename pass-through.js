// Desenho na pré-via com a camada transparente por cima: a camada deixa os cliques passarem ao painel quando ele é
// a janela visível sob o cursor (ex.: compartilhando a tela principal inteira, a camada cobre o painel).

// Primeira janela visível que contém o ponto, na ordem de empilhamento (a primeira da lista está na frente).
// clickThrough: janelas que deixam o clique passar (WS_EX_TRANSPARENT), como sobreposições de outros apps.
// ignore: janelas do próprio app que ficam por cima (camada de desenho, caixa de ferramentas). 0 = nenhuma.
function topWindowAt(point, windows, ignore) {
  for (const w of windows) {
    if (!w.visible || w.cloaked || w.clickThrough || ignore.includes(w.hwnd)) continue;
    const r = w.rect;
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) return w.hwnd;
  }
  return 0;
}
// Desenhos da pré-via aparecem também sobre a tela real; o cursor (apontador, lupa, holofote) não, senão o holofote escurece o próprio painel.
function toOverlayFromPanel(op) { return ['stroke-start', 'stroke-point', 'shape', 'erase'].includes(op); }
module.exports = { topWindowAt, toOverlayFromPanel };
