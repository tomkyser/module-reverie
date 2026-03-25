'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

/**
 * Tests for history subcommand handlers (D-03).
 *
 * Verifies:
 * - handleHistorySessions returns session records with expected fields
 * - handleHistoryFragments returns chronological fragment list
 * - handleHistoryFragments filters by --domain and --type flags
 * - handleHistoryConsolidations returns REM event timeline
 * - All handlers return { human, json, raw }
 * - registerReverieCommands registers 3 history subcommands
 */

const { createHistoryHandlers } = require('../history.cjs');
const { registerReverieCommands } = require('../register-commands.cjs');

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function createMockJournal() {
  const _fragments = [
    {
      id: 'frag-2026-03-20-aaa11111',
      type: 'experiential',
      created: '2026-03-20T10:00:00Z',
      associations: {
        domains: ['coding', 'testing'],
        entities: ['bun'],
        attention_tags: ['dev'],
        emotional_valence: 0.5,
      },
      decay: { current_weight: 0.8 },
      _lifecycle: 'active',
      formation: { trigger: 'user discussed testing patterns' },
    },
    {
      id: 'frag-2026-03-21-bbb22222',
      type: 'consolidation',
      created: '2026-03-21T12:00:00Z',
      associations: {
        domains: ['architecture'],
        entities: [],
        attention_tags: ['design'],
        emotional_valence: 0.3,
      },
      decay: { current_weight: 0.9 },
      _lifecycle: 'active',
      formation: { trigger: 'REM Tier 3 domain merge: coding + testing -> dev-practices' },
    },
    {
      id: 'frag-2026-03-22-ccc33333',
      type: 'experiential',
      created: '2026-03-22T08:00:00Z',
      associations: {
        domains: ['coding'],
        entities: ['node'],
        attention_tags: ['runtime'],
        emotional_valence: 0.7,
      },
      decay: { current_weight: 0.6 },
      _lifecycle: 'working',
      formation: { trigger: 'user compared runtimes' },
    },
  ];

  const _sessions = [
    {
      session_id: 'sess-001',
      timestamp: '2026-03-20T09:00:00Z',
      mode: 'Active',
      fragment_count: 5,
      rem_outcome: { promoted: 3, discarded: 2 },
      conditioning_drift: 0.02,
    },
    {
      session_id: 'sess-002',
      timestamp: '2026-03-21T14:00:00Z',
      mode: 'Passive',
      fragment_count: 2,
      rem_outcome: { promoted: 1, discarded: 1 },
      conditioning_drift: 0.01,
    },
  ];

  return {
    listFragments: () => ({ ok: true, value: _fragments }),
    listSessions: () => ({ ok: true, value: _sessions }),
  };
}

function createMockContext() {
  return {
    journal: createMockJournal(),
    wire: { send: () => ({ ok: true, value: undefined }) },
    switchboard: { emit: () => {} },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('history.cjs', () => {
  let handlers;
  let context;

  beforeEach(() => {
    context = createMockContext();
    handlers = createHistoryHandlers(context);
  });

  describe('createHistoryHandlers', () => {
    it('returns an object with three handler functions', () => {
      expect(typeof handlers.handleHistorySessions).toBe('function');
      expect(typeof handlers.handleHistoryFragments).toBe('function');
      expect(typeof handlers.handleHistoryConsolidations).toBe('function');
    });
  });

  describe('handleHistorySessions', () => {
    it('returns session records with expected fields', () => {
      const result = handlers.handleHistorySessions([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json).toBeInstanceOf(Array);
      expect(result.value.json.length).toBe(2);

      const first = result.value.json[0];
      expect(first).toHaveProperty('session_id');
      expect(first).toHaveProperty('timestamp');
      expect(first).toHaveProperty('mode');
      expect(first).toHaveProperty('fragment_count');
      expect(first).toHaveProperty('rem_outcome');
    });

    it('returns { human, json, raw } output modes', () => {
      const result = handlers.handleHistorySessions([], {});
      expect(result.ok).toBe(true);
      expect(typeof result.value.human).toBe('string');
      expect(result.value.json).toBeDefined();
      expect(typeof result.value.raw).toBe('string');
    });

    it('sorts sessions by timestamp descending (most recent first)', () => {
      const result = handlers.handleHistorySessions([], {});
      expect(result.ok).toBe(true);
      const sessions = result.value.json;
      expect(sessions[0].session_id).toBe('sess-002');
      expect(sessions[1].session_id).toBe('sess-001');
    });
  });

  describe('handleHistoryFragments', () => {
    it('returns chronological fragment list with expected fields', () => {
      const result = handlers.handleHistoryFragments([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json).toBeInstanceOf(Array);
      expect(result.value.json.length).toBe(3);

      const first = result.value.json[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('type');
      expect(first).toHaveProperty('created');
      expect(first).toHaveProperty('domains');
      expect(first).toHaveProperty('decay_weight');
    });

    it('returns { human, json, raw } output modes', () => {
      const result = handlers.handleHistoryFragments([], {});
      expect(result.ok).toBe(true);
      expect(typeof result.value.human).toBe('string');
      expect(result.value.json).toBeDefined();
      expect(typeof result.value.raw).toBe('string');
    });

    it('sorts fragments by created descending', () => {
      const result = handlers.handleHistoryFragments([], {});
      expect(result.ok).toBe(true);
      const frags = result.value.json;
      expect(frags[0].id).toBe('frag-2026-03-22-ccc33333');
      expect(frags[2].id).toBe('frag-2026-03-20-aaa11111');
    });

    it('filters by --domain flag when present', () => {
      const result = handlers.handleHistoryFragments([], { domain: 'architecture' });
      expect(result.ok).toBe(true);
      expect(result.value.json.length).toBe(1);
      expect(result.value.json[0].id).toBe('frag-2026-03-21-bbb22222');
    });

    it('filters by --type flag when present', () => {
      const result = handlers.handleHistoryFragments([], { type: 'consolidation' });
      expect(result.ok).toBe(true);
      expect(result.value.json.length).toBe(1);
      expect(result.value.json[0].type).toBe('consolidation');
    });
  });

  describe('registerReverieCommands (history)', () => {
    it('registers 3 history subcommands', () => {
      const registered = [];
      const mockCircuitApi = {
        registerCommand: (name, handler, meta) => {
          registered.push(name);
          return { ok: true, value: undefined };
        },
      };
      registerReverieCommands(mockCircuitApi, context);

      expect(registered).toContain('history sessions');
      expect(registered).toContain('history fragments');
      expect(registered).toContain('history consolidations');
    });
  });

  describe('handleHistoryConsolidations', () => {
    it('returns only consolidation-type fragments as REM event timeline', () => {
      const result = handlers.handleHistoryConsolidations([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json).toBeInstanceOf(Array);
      expect(result.value.json.length).toBe(1);
      expect(result.value.json[0].id).toBe('frag-2026-03-21-bbb22222');
    });

    it('returns { human, json, raw } output modes', () => {
      const result = handlers.handleHistoryConsolidations([], {});
      expect(result.ok).toBe(true);
      expect(typeof result.value.human).toBe('string');
      expect(result.value.json).toBeDefined();
      expect(typeof result.value.raw).toBe('string');
    });

    it('includes trigger description from formation', () => {
      const result = handlers.handleHistoryConsolidations([], {});
      expect(result.ok).toBe(true);
      const consolidation = result.value.json[0];
      expect(consolidation).toHaveProperty('trigger');
      expect(consolidation.trigger).toContain('domain merge');
    });
  });
});
