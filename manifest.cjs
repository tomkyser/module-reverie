'use strict';

/**
 * Reverie module manifest.
 *
 * Declares the module's identity, entry point, and all platform
 * dependencies required across the full Reverie lifecycle (Phases 7-12).
 *
 * Per D-04: All 9 services + 2 providers are declared upfront.
 * Not all are used in Phase 7 but the manifest is the truth contract.
 *
 * Validated via Circuit's validateModuleManifest() at registration time.
 *
 * @type {import('../../core/sdk/circuit/module-manifest.cjs').ModuleManifest}
 */
const REVERIE_MANIFEST = {
  name: 'reverie',
  version: '0.1.0',
  description: 'Persistent evolving AI memory through fragment-based recall and Self Model personality',
  main: './reverie.cjs',
  enabled: true,
  dependencies: {
    services: [
      'wire',
      'magnet',
      'switchboard',
      'commutator',
      'lathe',
      'forge',
      'relay',
      'conductor',
      'assay',
    ],
    providers: [
      'ledger',
      'journal',
    ],
  },
  hooks: {
    listeners: {
      SessionStart: ['reverie'],
      UserPromptSubmit: ['reverie'],
      PreToolUse: ['reverie'],
      PostToolUse: ['reverie'],
      Stop: ['reverie'],
      PreCompact: ['reverie'],
      SubagentStart: ['reverie'],
      SubagentStop: ['reverie'],
    },
  },
};

module.exports = { REVERIE_MANIFEST };
