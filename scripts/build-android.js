// Gera dist/SalaTV-android.apk (Fire TV, Android TV, Google TV, TV Box) com o receptor atual.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
require('./prepare-tv');
const android = path.join(root, 'android');
const studioJdk = 'C:\\Program Files\\Android\\Android Studio\\jbr';
const env = { ...process.env };
if (!env.JAVA_HOME && fs.existsSync(studioJdk)) env.JAVA_HOME = studioJdk; // JDK embutido no Android Studio
const gradlew = path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
execFileSync(process.platform === 'win32' ? `"${gradlew}"` : gradlew, ['assembleRelease', '--console=plain'], { cwd: android, env, stdio: 'inherit', shell: process.platform === 'win32' });
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.copyFileSync(path.join(android, 'app/build/outputs/apk/release/app-release.apk'), path.join(root, 'dist/SalaTV-android.apk'));
console.log('APK pronto: dist/SalaTV-android.apk');
