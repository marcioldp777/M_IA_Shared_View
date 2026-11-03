const fs = require('node:fs');
const path = require('node:path');
for (const name of ['app.js', 'style.css', 'ink.js', 'logo.png']) fs.copyFileSync(path.join(__dirname, '../public', name), path.join(__dirname, '../tv', name));
// App Android (Fire TV / Android TV / TV Box): mesmo receptor, embutido nos assets do APK.
const assets = path.join(__dirname, '../android/app/src/main/assets');
fs.mkdirSync(assets, { recursive: true });
for (const name of ['index.html', 'app.js', 'style.css', 'ink.js', 'logo.png']) fs.copyFileSync(path.join(__dirname, '../tv', name), path.join(assets, name));
// App LG webOS: mesmo receptor; appinfo.json e ícones ficam versionados em webos/.
for (const name of ['index.html', 'app.js', 'style.css', 'ink.js', 'logo.png']) fs.copyFileSync(path.join(__dirname, '../tv', name), path.join(__dirname, '../webos', name));
console.log('Receptor preparado em tv/ (Tizen), android/app/src/main/assets (Android) e webos/ (LG).');
