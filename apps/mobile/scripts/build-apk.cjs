/**
 * Builds a signed release APK on this computer (needs JDK 17 and the Android SDK).
 *   node scripts/build-apk.cjs
 * Output: ../../dist/Monetra-<version>.apk
 *
 * The signing key lives in apps/mobile/credentials (git-ignored). Keep a backup of that folder:
 * Android only installs an update over an existing app when it is signed with the same key.
 *
 * Run it on Linux, macOS or WSL. On plain Windows the native (C++) step fails because its file paths
 * exceed 260 characters. In WSL: copy the repo (with credentials/) to the Linux disk, `npm ci`, then run this.
 * To ship an update, raise "version" and android.versionCode in app.json first.
 */
const { execFileSync, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const creds = path.join(root, 'credentials');
const keystore = path.join(creds, 'monetra-release.keystore');
const propsFile = path.join(creds, 'keystore.json');
const app = require(path.join(root, 'app.json')).expo;
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });

// 1. Signing key (created once)
fs.mkdirSync(creds, { recursive: true });
if (!fs.existsSync(keystore)) {
  const password = crypto.randomBytes(18).toString('base64url');
  const props = { storePassword: password, keyAlias: 'monetra', keyPassword: password };
  console.log('==> Creating the release signing key in credentials/ (back this folder up)');
  execFileSync('keytool', [
    '-genkeypair', '-v', '-storetype', 'PKCS12', '-keystore', keystore, '-alias', props.keyAlias,
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', password, '-keypass', password, '-dname', 'CN=Monetra, O=ZH Trader, C=PK',
  ], { stdio: 'inherit' });
  fs.writeFileSync(propsFile, JSON.stringify(props, null, 2));
}
const props = JSON.parse(fs.readFileSync(propsFile, 'utf8'));

// 2. Native project from app.json
console.log('==> Generating the Android project');
run('npx expo prebuild --platform android --clean --no-install');

// 3. Use the release key instead of the debug key
const gradleFile = path.join(root, 'android/app/build.gradle');
let gradle = fs.readFileSync(gradleFile, 'utf8');
const ks = keystore.replace(/\\/g, '/');
gradle = gradle.replace(
  /signingConfigs\s*\{/,
  `signingConfigs {
        release {
            storeFile file('${ks}')
            storePassword '${props.storePassword}'
            keyAlias '${props.keyAlias}'
            keyPassword '${props.keyPassword}'
        }`,
);
gradle = gradle.replace(/(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
if (!gradle.includes('signingConfig signingConfigs.release')) throw new Error('Could not switch the release build to the release key; check android/app/build.gradle');
fs.writeFileSync(gradleFile, gradle);

// 4. Phones only (skip x86 emulator code: smaller APK, faster build)
const gp = path.join(root, 'android/gradle.properties');
fs.writeFileSync(gp, fs.readFileSync(gp, 'utf8').replace(/^reactNativeArchitectures=.*$/m, 'reactNativeArchitectures=armeabi-v7a,arm64-v8a'));

// 5. Build
console.log('==> Building the release APK (first build takes 10-30 minutes)');
const androidDir = path.join(root, 'android');
const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(`"${gradlew}" assembleRelease --no-daemon`, { cwd: androidDir, env: { ...process.env, NODE_ENV: 'production' } });

// 6. Copy out
const built = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const outDir = path.resolve(root, '../../dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `Monetra-${app.version}.apk`);
fs.copyFileSync(built, out);
console.log(`==> APK ready: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
