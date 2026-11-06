// Onde conectar o monitor virtual: encostado na borda direita da tela mais à direita (sem vão, o mouse passa direto).
// attached: telas conectadas, exceto a virtual, em pixels físicos { x, y, width, height }.
function rightEdge(attached) {
  let best = null;
  for (const d of attached) {
    const right = d.x + d.width;
    if (!best || right > best.x || (right === best.x && d.y < best.y)) best = { x: right, y: d.y };
  }
  return best || { x: 0, y: 0 };
}
module.exports = { rightEdge };
