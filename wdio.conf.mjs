import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const appBinaryPath = path.join(
  rootDirectory,
  'src-tauri',
  'target',
  'release',
  process.platform === 'win32' ? 'chrono-forge.exe' : 'chrono-forge',
);

export const config = {
  runner: 'local',
  specs: [
    './tests/e2e-desktop/focus-persistence.phase-1.e2e.spec.mjs',
    './tests/e2e-desktop/focus-persistence.phase-2.e2e.spec.mjs',
  ],
  maxInstances: 1,
  logLevel: 'warn',
  framework: 'mocha',
  reporters: ['spec'],
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        autoDownloadEdgeDriver: false,
        captureBackendLogs: true,
        driverProvider: 'embedded',
        embeddedPort: 4445,
        startTimeout: 90_000,
      },
    ],
  ],
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],
  waitforTimeout: 20_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },
};
