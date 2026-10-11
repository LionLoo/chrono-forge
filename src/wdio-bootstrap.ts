/** Test-only bridge; Vite statically removes this module from production builds. */
import '@wdio/tauri-plugin';

import {
  requestSemanticSaveConfirmation,
  type SemanticSaveIdentity,
} from './adapters/persistence-broker';

declare global {
  // Test-only access to the same isolated semantic-confirmation route used by production writes.
  var __chronoForgeE2EConfirmSemanticSave:
    ((identity: SemanticSaveIdentity) => Promise<void>) | undefined;
}

globalThis.__chronoForgeE2EConfirmSemanticSave = requestSemanticSaveConfirmation;
