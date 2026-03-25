'use strict';

const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

/**
 * Tests for reset subcommand handlers (D-04).
 *
 * Verifies:
 * - All reset handlers require --confirm flag
 * - handleResetFragments deletes all fragments, preserves Self Model
 * - handleResetSelfModel calls coldStart for reinitialization
 * - handleResetAll resets both fragments and Self Model
 * - Error messages include usage hint text
 * - registerReverieCommands registers 3 reset subcommands
 */

const { createResetHandlers } = require('../reset.cjs');
const { registerReverieCommands } = require('../register-commands.cjs');

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockFragmentWriter() {
  const deletedIds = [];
  return {
    deleteFragment: (id) => {
      deletedIds.push(id);
      return Promise.resolve({ ok: true, value: { id } });
    },
    _deletedIds: deletedIds,
  };
}

function createMockSelfModel() {
  let coldStartCalled = false;
  return {
    coldStart: () => {
      coldStartCalled = true;
      return { ok: true, value: undefined };
    },
    get _coldStartCalled() { return coldStartCalled; },
  };
}

function createMockJournal() {
  return {
    listFragments: () => ({
      ok: true,
      value: [
        { id: 'frag-2026-03-20-aaa11111', _lifecycle: 'working' },
        { id: 'frag-2026-03-21-bbb22222', _lifecycle: 'active' },
        { id: 'frag-2026-03-22-ccc33333', _lifecycle: 'archive' },
      ],
    }),
    listSessions: () => ({ ok: true, value: [] }),
  };
}

function createMockContext() {
  return {
    selfModel: createMockSelfModel(),
    journal: createMockJournal(),
    fragmentWriter: createMockFragmentWriter(),
    wire: { send: () => ({ ok: true, value: undefined }) },
    switchboard: { emit: () => {} },
    lathe: {},
    dataDir: '/tmp/reverie-test',
  };
}

// ---------------------------------------------------------------------------
// process.argv manipulation for --confirm
// ---------------------------------------------------------------------------

let originalArgv;

function setConfirmFlag(present) {
  originalArgv = process.argv;
  if (present) {
    process.argv = [...originalArgv, '--confirm'];
  } else {
    process.argv = originalArgv.filter(a => a !== '--confirm');
  }
}

function restoreArgv() {
  if (originalArgv) {
    process.argv = originalArgv;
    originalArgv = undefined;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reset.cjs', () => {
  let handlers;
  let context;

  beforeEach(() => {
    context = createMockContext();
    handlers = createResetHandlers(context);
  });

  afterEach(() => {
    restoreArgv();
  });

  describe('createResetHandlers', () => {
    it('returns an object with three handler functions', () => {
      expect(typeof handlers.handleResetFragments).toBe('function');
      expect(typeof handlers.handleResetSelfModel).toBe('function');
      expect(typeof handlers.handleResetAll).toBe('function');
    });
  });

  describe('handleResetFragments', () => {
    it('returns CONFIRM_REQUIRED error without --confirm', async () => {
      setConfirmFlag(false);
      const result = await handlers.handleResetFragments([], {});
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('CONFIRM_REQUIRED');
    });

    it('error message includes instruction text', async () => {
      setConfirmFlag(false);
      const result = await handlers.handleResetFragments([], {});
      expect(result.error.message).toContain('--confirm');
    });

    it('returns ok with fragment count when --confirm is present', async () => {
      setConfirmFlag(true);
      const result = await handlers.handleResetFragments([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json).toHaveProperty('reset', 'fragments');
      expect(result.value.json).toHaveProperty('count', 3);
    });

    it('deletes all fragments via fragmentWriter', async () => {
      setConfirmFlag(true);
      await handlers.handleResetFragments([], {});
      expect(context.fragmentWriter._deletedIds.length).toBe(3);
    });

    it('returns { human, json, raw } output modes', async () => {
      setConfirmFlag(true);
      const result = await handlers.handleResetFragments([], {});
      expect(result.ok).toBe(true);
      expect(typeof result.value.human).toBe('string');
      expect(result.value.json).toBeDefined();
      expect(typeof result.value.raw).toBe('string');
    });
  });

  describe('handleResetSelfModel', () => {
    it('returns CONFIRM_REQUIRED error without --confirm', () => {
      setConfirmFlag(false);
      const result = handlers.handleResetSelfModel([], {});
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('CONFIRM_REQUIRED');
    });

    it('calls selfModel.coldStart with --confirm', () => {
      setConfirmFlag(true);
      handlers.handleResetSelfModel([], {});
      expect(context.selfModel._coldStartCalled).toBe(true);
    });

    it('returns ok with reset type', () => {
      setConfirmFlag(true);
      const result = handlers.handleResetSelfModel([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json).toHaveProperty('reset', 'self-model');
    });

    it('returns { human, json, raw } output modes', () => {
      setConfirmFlag(true);
      const result = handlers.handleResetSelfModel([], {});
      expect(result.ok).toBe(true);
      expect(typeof result.value.human).toBe('string');
      expect(result.value.json).toBeDefined();
      expect(typeof result.value.raw).toBe('string');
    });
  });

  describe('handleResetAll', () => {
    it('returns CONFIRM_REQUIRED error without --confirm', async () => {
      setConfirmFlag(false);
      const result = await handlers.handleResetAll([], {});
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('CONFIRM_REQUIRED');
    });

    it('resets both fragments and Self Model with --confirm', async () => {
      setConfirmFlag(true);
      await handlers.handleResetAll([], {});
      expect(context.fragmentWriter._deletedIds.length).toBe(3);
      expect(context.selfModel._coldStartCalled).toBe(true);
    });

    it('returns ok with combined result', async () => {
      setConfirmFlag(true);
      const result = await handlers.handleResetAll([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json).toHaveProperty('reset', 'all');
      expect(result.value.json).toHaveProperty('fragments_deleted', 3);
    });

    it('returns { human, json, raw } output modes', async () => {
      setConfirmFlag(true);
      const result = await handlers.handleResetAll([], {});
      expect(result.ok).toBe(true);
      expect(typeof result.value.human).toBe('string');
      expect(result.value.json).toBeDefined();
      expect(typeof result.value.raw).toBe('string');
    });
  });

  describe('registerReverieCommands (reset)', () => {
    it('registers 3 reset subcommands', () => {
      const registered = [];
      const mockCircuitApi = {
        registerCommand: (name, handler, meta) => {
          registered.push(name);
          return { ok: true, value: undefined };
        },
      };
      registerReverieCommands(mockCircuitApi, context);

      expect(registered).toContain('reset fragments');
      expect(registered).toContain('reset self-model');
      expect(registered).toContain('reset all');
    });
  });
});
