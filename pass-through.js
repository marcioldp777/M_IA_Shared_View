// A camada de desenho deixa os cliques passarem ao painel quando ele está em primeiro plano e o cursor está sobre ele
// (ex.: compartilhando a tela principal inteira, a camada cobre o painel e engoliria o desenho na pré-via).
function passThrough(cursor, panelBounds, panelIsForeground) {
  if (!panelIsForeground || !panelBounds || !cursor) return false;
  return cursor.x >= panelBounds.x && cursor.x <= panelBounds.x + panelBounds.width && cursor.y >= panelBounds.y && cursor.y <= panelBounds.y + panelBounds.height;
}
module.exports = { passThrough };
