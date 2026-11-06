// Tela pendente do 2º monitor: o próximo pedido de captura a usa sem seletor, uma única vez e só se for recente
// (se o compartilhamento não aconteceu, um "Compartilhar tela" comum depois não pode pular o seletor).
function createPending(ttlMs = 15000, now = Date.now) {
  let value = null, since = 0;
  return {
    set(next) { value = next; since = now(); },
    take() { const fresh = value !== null && now() - since <= ttlMs ? value : null; value = null; return fresh; },
    clear() { value = null; }
  };
}
module.exports = { createPending };
