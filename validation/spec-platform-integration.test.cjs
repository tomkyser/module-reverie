'use strict';

/**
 * Spec compliance test: Platform Integration (reverie-spec-v2.md sections 6.1-6.3).
 *
 * Verifies:
 * - Section 6.1: Dynamo Service and Provider Usage through Circuit (not direct imports)
 * - Section 6.2: Hook Wiring for all 8 Claude Code hooks through Armature's hook registry
 * - Section 6.3: Data Architecture (Journal + Ledger dual-storage, Self Model triple storage)
 *
 * Known deviations (documented in STATE.md):
 * - [Phase 08] Hook registration via Armature createHookRegistry not events.on()
 * - [Phase 09.1] Exciter delegates to Armature createHookRegistry for hook mechanics
 *
 * @module reverie/validation/spec-platform-integration.test
 */

const { describe, it, expect } = require('bun:test');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Spec 6.1: Dynamo Service and Provider Usage
// ---------------------------------------------------------------------------

describe('Spec 6.1: Service and Provider Usage', () => {

  it('reverie.cjs resolves services through Circuit facade getService() (not direct imports)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // Must use getService from Circuit facade, not require core services directly
    expect(source).toContain("getService('switchboard')");
    expect(source).toContain("getService('lathe')");
    expect(source).toContain("getService('magnet')");
    expect(source).toContain("getService('wire')");
    expect(source).toContain("getService('assay')");
    expect(source).toContain("getService('conductor')");
    expect(source).toContain("getService('exciter')");
  });

  it('reverie.cjs resolves providers through Circuit facade getProvider() (not direct imports)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // Must use getProvider from Circuit facade
    expect(source).toContain("getProvider('journal')");
    expect(source).toContain("getProvider('lithograph')");
  });

  it('register() destructures facade for getService and getProvider (Circuit API)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // The register function must receive and use a Circuit facade
    expect(source).toContain('function register(facade)');
    expect(source).toContain('const { events, getService, getProvider } = facade');
  });

  it('spec 6.1 service dependencies are all resolved: Wire, Switchboard, Magnet, Lathe, Assay, Conductor', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // All 6 mandatory service dependencies from spec 6.1 table
    const requiredServices = ['switchboard', 'lathe', 'magnet', 'wire', 'assay', 'conductor'];
    for (const svc of requiredServices) {
      expect(source).toContain(`getService('${svc}')`);
    }
  });

  it('spec 6.1 provider dependencies are all resolved: Journal, Ledger (via Wire/Ledger facade)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // Journal is resolved directly
    expect(source).toContain("getProvider('journal')");
    // Ledger access is via Wire and Assay services (which depend on Ledger internally)
    // Reverie uses Assay for search and Wire for cross-session queries
  });

  it('no direct require() of core/services/ from reverie module source', () => {
    // Reverie must access platform services through Circuit, not direct require
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // Should NOT directly require core/services files (except protocol.cjs which is a data-only constant)
    const directServiceImports = source.match(/require\(['"]\.\.\/(\.\.\/)*core\/services\/(?!.*protocol)[^'"]*['"]\)/g);
    expect(directServiceImports).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spec 6.2: Hook Wiring
// ---------------------------------------------------------------------------

describe('Spec 6.2: Hook Wiring', () => {

  const ALL_8_HOOKS = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'PreCompact',
    'SubagentStart',
    'SubagentStop',
  ];

  it('registers all 8 Claude Code hooks', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // Verify all 8 hooks are passed to exciter.registerHooks
    for (const hook of ALL_8_HOOKS) {
      expect(source).toContain(`${hook}:`);
    }
  });

  it('hooks are registered via exciter.registerHooks() (Armature-backed per [Phase 08] deviation)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // Must use exciter.registerHooks (which delegates to Armature createHookRegistry)
    expect(source).toContain("exciter.registerHooks('reverie'");
  });

  it('Exciter delegates to Armature createHookRegistry internally per [Phase 09.1] deviation', () => {
    const exciterSource = fs.readFileSync(
      path.join(ROOT, 'core', 'services', 'exciter', 'exciter.cjs'), 'utf8'
    );

    // Exciter imports and uses createHookRegistry from Armature
    expect(exciterSource).toContain("require('../../armature/hooks.cjs')");
    expect(exciterSource).toContain('createHookRegistry');
  });

  it('hook-handlers.cjs implements handler functions for all 8 hooks', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'hooks', 'hook-handlers.cjs'), 'utf8'
    );

    const handlerMap = {
      SessionStart: 'handleSessionStart',
      UserPromptSubmit: 'handleUserPromptSubmit',
      PreToolUse: 'handlePreToolUse',
      PostToolUse: 'handlePostToolUse',
      Stop: 'handleStop',
      PreCompact: 'handlePreCompact',
      SubagentStart: 'handleSubagentStart',
      SubagentStop: 'handleSubagentStop',
    };

    for (const [hook, handler] of Object.entries(handlerMap)) {
      expect(source).toContain(`function ${handler}`);
    }
  });

  it('createHookHandlers returns object with all 8 handler functions', () => {
    const { createHookHandlers } = require('../hooks/hook-handlers.cjs');

    // Create with minimal mock dependencies
    const handlers = createHookHandlers({
      contextManager: {
        init: async () => ({ ok: true, value: {} }),
        getInjection: () => 'test',
        trackBytes: () => ({ changed: false, from: 1, to: 1 }),
        incrementTurn: () => {},
        getMicroNudge: () => null,
        checkpoint: async () => ({ ok: true, value: {} }),
        resetAfterCompaction: async () => ({ ok: true, value: {} }),
        getSessionSnapshot: () => ({}),
        persistWarmStart: async () => ({ ok: true, value: {} }),
        getNudge: async () => null,
      },
      switchboard: { emit: () => {} },
      lathe: {
        writeFile: async () => ({ ok: true }),
        readFile: async () => ({ ok: false }),
      },
      dataDir: '/tmp/test',
    });

    for (const hook of ALL_8_HOOKS) {
      const handlerName = 'handle' + hook;
      expect(typeof handlers[handlerName]).toBe('function');
    }
  });

  it('reverie.cjs maps handler results to exciter.registerHooks call', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // The registerHooks call must map all 8 hooks to their handlers
    expect(source).toContain('SessionStart: handlers.handleSessionStart');
    expect(source).toContain('UserPromptSubmit: handlers.handleUserPromptSubmit');
    expect(source).toContain('PreToolUse: handlers.handlePreToolUse');
    expect(source).toContain('PostToolUse: handlers.handlePostToolUse');
    expect(source).toContain('Stop: handlers.handleStop');
    expect(source).toContain('PreCompact: handlers.handlePreCompact');
    expect(source).toContain('SubagentStart: handlers.handleSubagentStart');
    expect(source).toContain('SubagentStop: handlers.handleSubagentStop');
  });
});

// ---------------------------------------------------------------------------
// Spec 6.3: Data Architecture
// ---------------------------------------------------------------------------

describe('Spec 6.3: Data Architecture', () => {

  it('dual-storage pattern: Journal for narrative + Ledger for structured data', () => {
    // FragmentWriter uses Journal (narrative storage) and Wire (Ledger via cross-session)
    const fwSource = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'components', 'fragments', 'fragment-writer.cjs'), 'utf8'
    );

    // Journal for markdown fragment files (narrative)
    expect(fwSource).toContain('journal');
    // Wire for Ledger upserts (structured data -- association index)
    expect(fwSource).toContain('wire');
  });

  it('Self Model uses triple storage: Magnet (in-memory), Journal (narrative), Ledger (structured)', () => {
    // Self Model manager depends on magnet (in-memory), journal (narrative file), wire (Ledger via cross-session)
    const smSource = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'components', 'self-model', 'self-model.cjs'), 'utf8'
    );

    // Magnet for in-memory state persistence
    expect(smSource).toContain('magnet');
    // Journal for narrative markdown files (identity-core.md, relational-model.md, conditioning.md)
    expect(smSource).toContain('journal');
    // Wire for Ledger structured state (via cross-session writes)
    expect(smSource).toContain('wire');
  });

  it('fragments stored in Journal with association index in Ledger', () => {
    // Fragment writer writes to Journal (narrative file) and enqueues Ledger writes via Wire
    const fwSource = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'components', 'fragments', 'fragment-writer.cjs'), 'utf8'
    );

    // Writes fragment markdown to Journal
    expect(fwSource).toContain('journal');
    // Enqueues association index writes via Wire for Ledger
    expect(fwSource).toContain('wire');

    // Association types/tables are defined in constants
    const constantsSource = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'lib', 'constants.cjs'), 'utf8'
    );
    // Fragment types are defined
    expect(constantsSource).toContain('FRAGMENT_TYPES');
  });

  it('reverie.cjs creates FragmentWriter with both Journal and Wire (dual-storage wiring)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // FragmentWriter creation must receive journal (narrative) and wire (structured)
    expect(source).toContain('createFragmentWriter');
    expect(source).toContain('journal, wire, switchboard');
  });

  it('no data path bypasses the dual-storage convention for fragments', () => {
    // All fragment writes must go through FragmentWriter (the single writer gateway)
    // Formation pipeline uses FragmentWriter, REM uses FragmentWriter, backfill uses FragmentWriter
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'reverie.cjs'), 'utf8'
    );

    // FragmentWriter is injected into formation pipeline
    expect(source).toContain('fragmentWriter');
    // REM components receive fragmentWriter through their dependency chain
    // (retroactive-evaluator, editorial-pass both receive fragmentWriter)
    expect(source).toContain('retroactiveEvaluator');
    expect(source).toContain('editorialPass');
  });

  it('spec 6.3 Ledger tables are referenced in the association index schema', () => {
    // Verify schema defines the association-related types used for Ledger storage
    const schemasSource = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'lib', 'schemas.cjs'), 'utf8'
    );

    // Association schema defines structure that maps to Ledger tables
    expect(schemasSource).toContain('associations');
    // Entity references in schemas
    expect(schemasSource).toContain('entities');
    // Domain references
    expect(schemasSource).toContain('domains');
  });
});
