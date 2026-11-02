// Monta os arquivos do receptor Samsung (o mesmo de tv/ + public/) com o endereço deste PC já configurado.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCES = [
  ['config.xml', 'tv/config.xml'], ['icon.png', 'tv/icon.png'], ['index.html', 'tv/index.html'],
  ['app.js', 'public/app.js'], ['style.css', 'public/style.css'], ['ink.js', 'public/ink.js'], ['logo.png', 'public/logo.png']
];

function receiverFiles(serverUrl) {
  return SOURCES.map(([name, source]) => {
    let data = fs.readFileSync(path.join(ROOT, source));
    if (name === 'index.html' && serverUrl) data = Buffer.from(data.toString('utf8').replace(/data-server="[^"]*"/, `data-server="${serverUrl}"`), 'utf8');
    return { name, data };
  });
}

// Identificadores definidos em tv/config.xml (pacote e aplicação)
function appIds() {
  const xml = fs.readFileSync(path.join(ROOT, 'tv/config.xml'), 'utf8');
  return { packageId: /package="([^"]+)"/.exec(xml)[1], appId: /<tizen:application id="([^"]+)"/.exec(xml)[1] };
}

module.exports = { receiverFiles, appIds };
