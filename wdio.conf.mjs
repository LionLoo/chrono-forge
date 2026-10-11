import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createNativeE2eCommandTracker } from './scripts/run-native-e2e-ci.mjs';

process.env.CHRONO_FORGE_PROFILE ??= `wdio-${process.pid}-${Date.now()}`;

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const appBinaryPath = path.join(
  rootDirectory,
  'src-tauri',
  'target',
  'release',
  process.platform === 'win32' ? 'chrono-forge.exe' : 'chrono-forge',
);
const commandTracker = createNativeE2eCommandTracker();

export const config = {
  runner: 'local',
  specs: [
    './tests/e2e-desktop/focus-persistence.phase-1.e2e.spec.mjs',
    './tests/e2e-desktop/focus-persistence.phase-2.e2e.spec.mjs',
    './tests/e2e-desktop/focus-persistence.phase-3.e2e.spec.mjs',
    './tests/e2e-desktop/focus-persistence.phase-4.e2e.spec.mjs',
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
  before: async (_capabilities, _specs, session) => {
    await session.waitUntil(
      async () => {
        for (const handle of await session.getWindowHandles()) {
          await session.switchToWindow(handle);
          const search = await session.execute(() => globalThis.location.search);
          if (!new URLSearchParams(search).has('persistence-broker')) return true;
        }
        return false;
      },
      {
        timeout: 20_000,
        timeoutMsg: 'The visible Chrono Forge window is unavailable.',
      },
    );
  },
  beforeCommand: (commandName) => {
    commandTracker.beforeCommand(commandName);
  },
  afterCommand: (commandName) => {
    commandTracker.afterCommand(commandName);
  },
  afterTest: (_test, _context, { error }) => {
    commandTracker.afterTest(error);
  },
};
