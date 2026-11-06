// Modo mini: durante a transmissão o painel vira uma janelinha no canto da tela, por cima dos apps.
const MINI_SIZE = { width: 400, height: 360 }, MARGIN = 16;

// workAreas: áreas úteis de todas as telas; home: a tela onde o painel está; saved: última posição {x, y} ou null.
function miniBounds(workAreas, home, saved) {
  const fits = saved && workAreas.some(a => saved.x >= a.x && saved.y >= a.y && saved.x + MINI_SIZE.width <= a.x + a.width && saved.y + MINI_SIZE.height <= a.y + a.height);
  const x = fits ? saved.x : home.x + home.width - MINI_SIZE.width - MARGIN;
  const y = fits ? saved.y : home.y + home.height - MINI_SIZE.height - MARGIN;
  return { x, y, ...MINI_SIZE };
}
module.exports = { miniBounds, MINI_SIZE };
