const fs = require('node:fs');
const path = require('node:path');
for (const name of ['app.js', 'style.css', 'ink.js']) fs.copyFileSync(path.join(__dirname, '../public', name), path.join(__dirname, '../tv', name));
console.log('Receptor preparado na pasta tv/. Empacote e assine com o Tizen Studio.');
