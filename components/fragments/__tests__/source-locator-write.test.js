'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

// ---------------------------------------------------------------------------
// Mock factories (same pattern as fragment-writer.test.js)
// ---------------------------------------------------------------------------

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
// Test data
// ---------------------------------------------------------------------------

function createSourceReferenceFragment(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || 'frag-2026-03-25-b1c2d3e4',
    type: 'source-reference',
    created: now,
    source_session: 'session-001',
    self_model_version: 'sm-identity-v1',
    formation_group: 'fg-src-001',
    formation_frame: 'experiential',
    sibling_fragments: [],
    temporal: {
      absolute: now,
      session_relative: 0.5,
      sequence: 1,
    },
    decay: {
      initial_weight: 0.8,
      current_weight: 0.8,
      last_accessed: now,
      access_count: 0,
      consolidation_count: 0,
      pinned: false,
    },
    associations: {
      domains: ['coding'],
      entities: ['user-1'],
      self_model_relevance: {
        identity: 0.3,
        relational: 0.5,
        conditioning: 0.2,
      },
      emotional_valence: 0.5,
      attention_tags: ['architecture'],
    },
    pointers: {
      causal_antecedents: [],
      causal_consequents: [],
      thematic_siblings: [],
      contradictions: [],
      meta_recalls: [],
      source_fragments: [],
    },
    formation: {
      trigger: 'user shared a file',
      attention_pointer: 'architecture',
      active_domains_at_formation: ['coding'],
      sublimation_that_prompted: null,
    },
    source_locator: overrides.source_locator || {
      type: 'file',
      path: '/home/user/project/README.md',
      url: null,
      content_hash: 'abc123def456',
      last_verified: now,
    },
    ...overrides,
  };
}

function createExperientialFragment(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || 'frag-2026-03-25-a1b2c3d4',
    type: 'experiential',
    created: now,
    source_session: 'session-001',
    self_model_version: 'sm-identity-v1',
    formation_group: 'fg-001',
    formation_frame: 'experiential',
    sibling_fragments: [],
    temporal: {
      absolute: now,
      session_relative: 0.5,
      sequence: 1,
    },
    decay: {
      initial_weight: 0.8,
      current_weight: 0.8,
      last_accessed: now,
      access_count: 0,
      consolidation_count: 0,
      pinned: false,
    },
    associations: {
      domains: ['coding'],
      entities: ['user-1'],
      self_model_relevance: {
        identity: 0.3,
        relational: 0.5,
        conditioning: 0.2,
      },
      emotional_valence: 0.5,
      attention_tags: ['architecture'],
    },
    pointers: {
      causal_antecedents: [],
      causal_consequents: [],
      thematic_siblings: [],
      contradictions: [],
      meta_recalls: [],
      source_fragments: [],
    },
    formation: {
      trigger: 'user asked about architecture',
      attention_pointer: 'architecture',
      active_domains_at_formation: ['coding'],
      sublimation_that_prompted: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const { createFragmentWriter } = require('../fragment-writer.cjs');

describe('FragmentWriter source_locators', () => {
  let journal;
  let wire;
  let switchboard;
  let writer;

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

  describe('_queueAssociationIndexWrites with source_locator', () => {
    it('queues source_locators write when fragment.source_locator is present', async () => {
      const fragment = createSourceReferenceFragment();
      await writer.writeFragment(fragment, 'Source impression body');

      const slWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'source_locators'
      );
      expect(slWrite).toBeDefined();
    });

    it('does NOT queue source_locators write when fragment.source_locator is absent', async () => {
      const fragment = createExperientialFragment();
      await writer.writeFragment(fragment, 'Regular fragment body');

      const slWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'source_locators'
      );
      expect(slWrite).toBeUndefined();
    });

    it('source_locators envelope contains correct fields', async () => {
      const fragment = createSourceReferenceFragment();
      await writer.writeFragment(fragment, 'Source impression body');

      const slWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'source_locators'
      );
      expect(slWrite).toBeDefined();
      const row = slWrite.payload.data[0];
      expect(row.id).toBe('sl-' + fragment.id);
      expect(row.fragment_id).toBe(fragment.id);
      expect(row.locator_type).toBe('file');
      expect(row.path).toBe('/home/user/project/README.md');
      expect(row.url).toBeNull();
      expect(row.content_hash).toBe('abc123def456');
      expect(row.last_verified).toBeDefined();
    });

    it('source_locator id is generated as sl-{fragment_id}', async () => {
      const fragment = createSourceReferenceFragment({ id: 'frag-2026-03-25-deadbeef' });
      await writer.writeFragment(fragment, 'body');

      const slWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'source_locators'
      );
      expect(slWrite).toBeDefined();
      expect(slWrite.payload.data[0].id).toBe('sl-frag-2026-03-25-deadbeef');
    });
  });

  describe('writeFragment end-to-end with source-reference type', () => {
    it('writes to 6 tables (5 existing + source_locators)', async () => {
      const fragment = createSourceReferenceFragment();
      const result = await writer.writeFragment(fragment, 'Source impression body');
      expect(result.ok).toBe(true);

      // Count distinct tables written
      const tablesWritten = new Set();
      for (const env of wire.calls.queueWrite) {
        if (env.payload && env.payload.table) {
          tablesWritten.add(env.payload.table);
        }
      }

      expect(tablesWritten.has('fragment_decay')).toBe(true);
      expect(tablesWritten.has('fragment_domains')).toBe(true);
      expect(tablesWritten.has('fragment_entities')).toBe(true);
      expect(tablesWritten.has('fragment_attention_tags')).toBe(true);
      expect(tablesWritten.has('formation_groups')).toBe(true);
      expect(tablesWritten.has('source_locators')).toBe(true);
      expect(tablesWritten.size).toBe(6);
    });
  });
});
