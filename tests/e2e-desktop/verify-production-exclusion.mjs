import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootPath = fileURLToPath(new URL('../..', import.meta.url));

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
    }),
  ).then((nested) => nested.flat());
}

async function expectExactProductionBoundary() {
  const [configText, capabilityText, buildText, rustText, binary, bundleFiles] = await Promise.all([
    readFile(path.join(rootPath, 'src-tauri', 'tauri.conf.json'), 'utf8'),
    readFile(path.join(rootPath, 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
    readFile(path.join(rootPath, 'src-tauri', 'build.rs'), 'utf8'),
    readFile(path.join(rootPath, 'src-tauri', 'src', 'lib.rs'), 'utf8'),
    readFile(
      path.join(
        rootPath,
        'src-tauri',
        'target',
        'release',
        process.platform === 'win32' ? 'chrono-forge.exe' : 'chrono-forge',
      ),
    ),
    filesBelow(path.join(rootPath, 'dist')),
  ]);
  const config = JSON.parse(configText);
  const capability = JSON.parse(capabilityText);
  const bundle = await Promise.all(bundleFiles.map((file) => readFile(file, 'utf8')));
  const renderedBundle = bundle.join('\n');

  if (
    config.app.withGlobalTauri !== false ||
    config.app.security.capabilities.length !== 1 ||
    config.app.security.capabilities[0] !== 'default'
  ) {
    throw new Error(
      'production Tauri config must expose only the default capability without global Tauri',
    );
  }
  if (
    capability.permissions.some(
      (permission) => permission.startsWith('wdio:') || permission.startsWith('wdio-webdriver:'),
    )
  ) {
    throw new Error('production capability must not grant WebdriverIO permissions');
  }
  if (!rustText.includes('tauri_plugin_notification::init()')) {
    throw new Error('production builder must register the notification plugin');
  }
  if (!/cfg\(feature = "desktop-e2e"\)/.test(rustText)) {
    throw new Error('WebdriverIO plugin registration must remain feature-gated');
  }
  if (
    !/cfg\(not\(feature = "desktop-e2e"\)\)/.test(buildText) ||
    !buildText.includes('"./capabilities/default.json"')
  ) {
    throw new Error('production build metadata must parse only the default capability');
  }
  if (/wdioTauri|@wdio\/tauri-plugin|tauri-plugin-wdio/.test(renderedBundle)) {
    throw new Error('production web bundle contains the WebdriverIO test bridge');
  }
  if (
    binary.includes(Buffer.from('tauri_plugin_wdio')) ||
    binary.includes(Buffer.from('wdio-webdriver'))
  ) {
    throw new Error('production binary contains a WebdriverIO test plugin');
  }
}

await expectExactProductionBoundary();
console.log(
  'Production artifact boundary verified: no WDIO bridge, capability, or global Tauri API.',
);
