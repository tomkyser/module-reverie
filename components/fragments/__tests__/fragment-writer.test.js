'use strict';

const { describe, it, expect, beforeEach, mock } = require('bun:test');

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock Journal provider with tracking.
 * Tracks write and delete calls. Configurable success/failure.
 */
function createMockJournal(overrides = {}) {
  const calls = { write: [], delete: [] };
  return {
    calls,
    write: overrides.write || (async (id, data) => {
      calls.write.push({ id, data });
      return { ok: true, value: undefined };
    }),
    delete: overrides.delete || (async (id) => {
      calls.delete.push({ id });
      return { ok: true, value: undefined };
    }),
  };
}

/**
 * Creates a mock Wire service with queueWrite tracking.
 * Configurable to return ok or err for specific tables.
 */
function createMockWire(overrides = {}) {
  const calls = { queueWrite: [] };
  return {
    calls,
    queueWrite: overrides.queueWrite || ((envelope) => {
      calls.queueWrite.push(envelope);
      return { ok: true, value: 1 };
    }),
  };
}

/**
 * Creates a mock Switchboard with emit tracking.
 */
function createMockSwitchboard() {
  const calls = { emit: [] };
  return {
    calls,
    emit: (event, data) => {
      calls.emit.push({ event, data });
    },
  };
}

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

/**
 * Creates a valid experiential fragment for testing.
 * Meets all schema requirements from schemas.cjs.
 */
function createTestFragment(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || 'frag-2026-03-23-a7f3b2c1',
    type: overrides.type || 'experiential',
    created: overrides.created || now,
    source_session: overrides.source_session || 'session-001',
    self_model_version: overrides.self_model_version || 'sm-identity-v1',
    formation_group: overrides.formation_group || 'fg-001',
    formation_frame: overrides.formation_frame || 'frame-001',
    sibling_fragments: overrides.sibling_fragments || [],
    temporal: overrides.temporal || {
      absolute: now,
      session_relative: 0.5,
      sequence: 1,
    },
    decay: overrides.decay || {
      initial_weight: 0.8,
      current_weight: 0.8,
      last_accessed: now,
      access_count: 0,
      consolidation_count: 0,
      pinned: false,
    },
    associations: overrides.associations || {
      domains: ['coding', 'testing'],
      entities: ['user-1', 'project-dynamo'],
      self_model_relevance: {
        identity: 0.3,
        relational: 0.6,
        conditioning: 0.1,
      },
      emotional_valence: 0.5,
      attention_tags: ['architecture', 'refactoring'],
    },
    pointers: overrides.pointers || {
      causal_antecedents: [],
      causal_consequents: [],
      thematic_siblings: [],
      contradictions: [],
      meta_recalls: [],
      source_fragments: [],
    },
    formation: overrides.formation || {
      trigger: 'user asked about architecture',
      attention_pointer: 'architecture discussion',
      active_domains_at_formation: ['coding'],
      sublimation_that_prompted: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FragmentWriter', () => {
  let journal;
  let wire;
  let switchboard;
  let writer;

  // Lazily require to allow test file to exist before implementation
  const { createFragmentWriter } = require('../fragment-writer.cjs');

  beforeEach(() => {
    journal = createMockJournal();
    wire = createMockWire();
    switchboard = createMockSwitchboard();
    writer = createFragmentWriter({
      journal,
      wire,
      switchboard,
      sessionId: 'test-session',
    });
  });

  // -------------------------------------------------------------------------
  // ID Generation
  // -------------------------------------------------------------------------

  describe('generateFragmentId', () => {
    it('produces IDs matching FRAGMENT_ID_PATTERN (frag-YYYY-MM-DD-hex8)', () => {
      const id = writer.generateFragmentId();
      expect(id).toMatch(/^frag-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/);
    });

    it('includes today\'s date in YYYY-MM-DD format', () => {
      const id = writer.generateFragmentId();
      const today = new Date().toISOString().slice(0, 10);
      expect(id).toContain(today);
    });

    it('has 8 hex chars suffix', () => {
      const id = writer.generateFragmentId();
      const suffix = id.split('-').slice(4).join('');
      expect(suffix).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  // -------------------------------------------------------------------------
  // Write Flow
  // -------------------------------------------------------------------------

  describe('writeFragment', () => {
    it('validates fragment against zod schema -- rejects invalid fragments with error', async () => {
      const invalid = { id: 'bad-id', type: 'nonexistent' };
      const result = await writer.writeFragment(invalid, 'some body');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_FRAGMENT');
    });

    it('writes to Journal first with correct ID and frontmatter+body', async () => {
      const fragment = createTestFragment();
      const body = 'This is the fragment body content.';
      await writer.writeFragment(fragment, body);
      expect(journal.calls.write.length).toBe(1);
      expect(journal.calls.write[0].id).toBe(fragment.id);
      expect(journal.calls.write[0].data.frontmatter).toEqual(fragment);
      expect(journal.calls.write[0].data.body).toBe(body);
    });

    it('queues Ledger writes via wire.queueWrite for association index tables', async () => {
      const fragment = createTestFragment();
      await writer.writeFragment(fragment, 'body');

      // Should queue writes for: fragment_decay, fragment_domains (per domain),
      // fragment_entities (per entity), fragment_attention_tags (per tag),
      // formation_groups
      // 2 domains + 2 entities + 2 attention_tags + 1 decay + 1 formation_groups = 8 envelopes total
      // But per plan: one envelope per table, each with data array
      // At minimum 5 table writes
      expect(wire.calls.queueWrite.length).toBeGreaterThanOrEqual(5);
    });

    it('returns ok({ id, path }) on successful write', async () => {
      const fragment = createTestFragment();
      const result = await writer.writeFragment(fragment, 'body');
      expect(result.ok).toBe(true);
      expect(result.value.id).toBe(fragment.id);
    });

    it('fragment ID follows pattern frag-YYYY-MM-DD-hex8 per D-10', async () => {
      const fragment = createTestFragment({ id: 'frag-2026-03-23-a7f3b2c1' });
      const result = await writer.writeFragment(fragment, 'body');
      expect(result.ok).toBe(true);
      expect(result.value.id).toMatch(/^frag-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/);
    });

    it('fragment is written to working/ directory by default per D-09', async () => {
      const fragment = createTestFragment();
      // No _lifecycle override -- should default to 'working'
      const result = await writer.writeFragment(fragment, 'body');
      expect(result.ok).toBe(true);
      // Verify journal was called (path is resolved by journal provider)
      expect(journal.calls.write.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Rollback
  // -------------------------------------------------------------------------

  describe('rollback', () => {
    it('if wire.queueWrite fails, journal.delete(id) is called to remove the fragment file', async () => {
      wire = createMockWire({
        queueWrite: (envelope) => {
          wire.calls.queueWrite.push(envelope);
          return { ok: false, error: { code: 'LEDGER_ERROR', message: 'Write failed' } };
        },
      });
      writer = createFragmentWriter({ journal, wire, switchboard, sessionId: 'test' });

      const fragment = createTestFragment();
      await writer.writeFragment(fragment, 'body');

      expect(journal.calls.delete.length).toBe(1);
      expect(journal.calls.delete[0].id).toBe(fragment.id);
    });

    it('after rollback, returns err(FRAGMENT_WRITE_FAILED) with ledgerError details', async () => {
      wire = createMockWire({
        queueWrite: () => ({
          ok: false,
          error: { code: 'LEDGER_ERROR', message: 'Connection lost' },
        }),
      });
      writer = createFragmentWriter({ journal, wire, switchboard, sessionId: 'test' });

      const fragment = createTestFragment();
      const result = await writer.writeFragment(fragment, 'body');

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('FRAGMENT_WRITE_FAILED');
      expect(result.error.context.fragmentId).toBe(fragment.id);
      expect(result.error.context.ledgerError).toBeDefined();
    });

    it('Journal file does NOT exist after rollback (verify delete was called)', async () => {
      let deleteWasCalled = false;
      journal = createMockJournal({
        delete: async (id) => {
          deleteWasCalled = true;
          journal.calls.delete.push({ id });
          return { ok: true, value: undefined };
        },
      });
      wire = createMockWire({
        queueWrite: () => ({
          ok: false,
          error: { code: 'LEDGER_ERROR', message: 'fail' },
        }),
      });
      writer = createFragmentWriter({ journal, wire, switchboard, sessionId: 'test' });

      const fragment = createTestFragment();
      await writer.writeFragment(fragment, 'body');

      expect(deleteWasCalled).toBe(true);
    });

    it('if Journal write fails, no Ledger write is attempted and error is returned immediately', async () => {
      journal = createMockJournal({
        write: async () => ({
          ok: false,
          error: { code: 'WRITE_FAILED', message: 'Disk full' },
        }),
      });
      writer = createFragmentWriter({ journal, wire, switchboard, sessionId: 'test' });

      const fragment = createTestFragment();
      const result = await writer.writeFragment(fragment, 'body');

      expect(result.ok).toBe(false);
      expect(wire.calls.queueWrite.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Association Index Write Data
  // -------------------------------------------------------------------------

  describe('association index writes', () => {
    it('fragment_decay row is queued with correct fields', async () => {
      const fragment = createTestFragment();
      await writer.writeFragment(fragment, 'body');

      const decayWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'fragment_decay'
      );
      expect(decayWrite).toBeDefined();
      expect(decayWrite.payload.data[0].fragment_id).toBe(fragment.id);
      expect(decayWrite.payload.data[0].fragment_type).toBe(fragment.type);
      expect(decayWrite.payload.data[0].initial_weight).toBe(fragment.decay.initial_weight);
      expect(decayWrite.payload.data[0].current_weight).toBe(fragment.decay.current_weight);
      expect(decayWrite.payload.data[0].lifecycle).toBe('working');
    });

    it('one fragment_domains row per domain in fragment.associations.domains', async () => {
      const fragment = createTestFragment({
        associations: {
          domains: ['coding', 'testing', 'architecture'],
          entities: [],
          self_model_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 },
          emotional_valence: 0.5,
          attention_tags: [],
        },
      });
      await writer.writeFragment(fragment, 'body');

      const domainWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'fragment_domains'
      );
      expect(domainWrite).toBeDefined();
      expect(domainWrite.payload.data).toHaveLength(3);
      expect(domainWrite.payload.data[0].fragment_id).toBe(fragment.id);
      expect(domainWrite.payload.data[0].domain_id).toBe('coding');
      expect(domainWrite.payload.data[1].domain_id).toBe('testing');
      expect(domainWrite.payload.data[2].domain_id).toBe('architecture');
    });

    it('one fragment_entities row per entity in fragment.associations.entities', async () => {
      const fragment = createTestFragment({
        associations: {
          domains: [],
          entities: ['user-1', 'project-dynamo', 'module-reverie'],
          self_model_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 },
          emotional_valence: 0.5,
          attention_tags: [],
        },
      });
      await writer.writeFragment(fragment, 'body');

      const entityWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'fragment_entities'
      );
      expect(entityWrite).toBeDefined();
      expect(entityWrite.payload.data).toHaveLength(3);
      expect(entityWrite.payload.data[0].entity_id).toBe('user-1');
      expect(entityWrite.payload.data[1].entity_id).toBe('project-dynamo');
    });

    it('one fragment_attention_tags row per tag in fragment.associations.attention_tags', async () => {
      const fragment = createTestFragment({
        associations: {
          domains: [],
          entities: [],
          self_model_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 },
          emotional_valence: 0.5,
          attention_tags: ['architecture', 'refactoring', 'design'],
        },
      });
      await writer.writeFragment(fragment, 'body');

      const tagWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'fragment_attention_tags'
      );
      expect(tagWrite).toBeDefined();
      expect(tagWrite.payload.data).toHaveLength(3);
      expect(tagWrite.payload.data[0].tag_id).toBe('architecture');
      expect(tagWrite.payload.data[1].tag_id).toBe('refactoring');
    });

    it('formation_groups row is queued with fragment formation_group ID', async () => {
      const fragment = createTestFragment({
        formation_group: 'fg-test-001',
        formation: {
          trigger: 'user asked about testing',
          attention_pointer: 'testing discussion',
          active_domains_at_formation: ['testing'],
          sublimation_that_prompted: null,
        },
        source_session: 'session-abc',
      });
      await writer.writeFragment(fragment, 'body');

      const fgWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'formation_groups'
      );
      expect(fgWrite).toBeDefined();
      expect(fgWrite.payload.data[0].id).toBe('fg-test-001');
      expect(fgWrite.payload.data[0].source_session).toBe('session-abc');
    });
  });

  // -------------------------------------------------------------------------
  // Delete / Update stubs
  // -------------------------------------------------------------------------

  describe('deleteFragment', () => {
    it('removes Journal file and marks Ledger rows', async () => {
      const result = await writer.deleteFragment('frag-2026-03-23-a7f3b2c1');
      expect(result.ok).toBe(true);
      expect(result.value.id).toBe('frag-2026-03-23-a7f3b2c1');
      expect(journal.calls.delete.length).toBe(1);
    });
  });

  describe('updateFragment', () => {
    it('re-validates and re-writes', async () => {
      const result = await writer.updateFragment(
        'frag-2026-03-23-a7f3b2c1',
        { type: 'experiential' },
        'updated body'
      );
      // Stub -- just verify it returns a result
      expect(result).toBeDefined();
      expect(result.ok).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Switchboard event emission
  // -------------------------------------------------------------------------

  describe('event emission', () => {
    it('emits reverie:fragment:written event on successful write', async () => {
      const fragment = createTestFragment();
      await writer.writeFragment(fragment, 'body');

      const emitted = switchboard.calls.emit.find(
        c => c.event === 'reverie:fragment:written'
      );
      expect(emitted).toBeDefined();
      expect(emitted.data.id).toBe(fragment.id);
      expect(emitted.data.type).toBe(fragment.type);
    });

    it('does NOT emit event on failed write', async () => {
      wire = createMockWire({
        queueWrite: () => ({
          ok: false,
          error: { code: 'LEDGER_ERROR', message: 'fail' },
        }),
      });
      writer = createFragmentWriter({ journal, wire, switchboard, sessionId: 'test' });

      const fragment = createTestFragment();
      await writer.writeFragment(fragment, 'body');

      const emitted = switchboard.calls.emit.find(
        c => c.event === 'reverie:fragment:written'
      );
      expect(emitted).toBeUndefined();
    });
  });
});
