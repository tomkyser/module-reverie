'use strict';

const { describe, it, expect, mock, beforeEach } = require('bun:test');
const { createRemConsolidator } = require('../rem-consolidator.cjs');

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeMockFragment(id, opts = {}) {
  return {
    id,
    type: opts.type || 'experiential',
    created: opts.created || '2026-03-25T00:00:00Z',
    source_session: opts.source_session || 'session-1',
    _lifecycle: opts._lifecycle || 'active',
    _body: opts.body || 'Fragment body text.',
    decay: {
      initial_weight: 0.8,
      current_weight: opts.current_weight || 0.5,
      last_accessed: '2026-03-25T00:00:00Z',
      access_count: 1,
      consolidation_count: 0,
      pinned: opts.pinned || false,
    },
    associations: {
      domains: ['programming'],
      entities: ['javascript'],
      self_model_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 },
      emotional_valence: 0.1,
      attention_tags: ['learning'],
    },
  };
}

function createMockDeps() {
  const triage = {
    snapshot: mock(async (mindState) => ({
      ok: true,
      value: { path: '/tmp/triage-123.json', fields_saved: 6 },
    })),
  };

  const provisionalRem = {
    run: mock(async () => ({
      promoted: 3, discarded: 1, sublimation_promoted: 0,
      meta_recalls_created: 0, entities_deduped: 0, weights_updated: 0,
      domains_merged: 0, conditioning_updated: true, quality_score: 0.7,
      timed_out: false, skipped_steps: [], auto_promoted: true, aborted: false,
    })),
    abort: mock(() => ({ ok: true, reverted: 2 })),
    isRunning: mock(() => false),
  };

  const fullRem = {
    run: mock(async () => ({
      promoted: 5, discarded: 2, sublimation_promoted: 1,
      meta_recalls_created: 1, entities_deduped: 2, weights_updated: 3,
      domains_merged: 1, conditioning_updated: true, quality_score: 0.8,
      timed_out: false, skipped_steps: [],
    })),
  };

  const heartbeatMonitor = {
    start: mock(() => {}),
    stop: mock(() => {}),
    isActive: mock(() => true),
    onHeartbeat: mock(() => {}),
  };

  const journal = {
    read: mock(() => Promise.resolve({ ok: true, value: { frontmatter: {}, body: '' } })),
    list: mock((dir) => {
      if (dir === 'active') {
        return Promise.resolve({
          ok: true,
          value: [
            makeMockFragment('frag-active-001', { current_weight: 0.5 }),
            makeMockFragment('frag-active-002', { current_weight: 0.05 }),
            makeMockFragment('frag-active-003', { current_weight: 0.3 }),
          ],
        });
      }
      if (dir === 'working') {
        return Promise.resolve({
          ok: true,
          value: [
            makeMockFragment('frag-orphan-001', { source_session: 'old-session', _lifecycle: 'working' }),
          ],
        });
      }
      return Promise.resolve({ ok: true, value: [] });
    }),
    delete: mock(() => Promise.resolve({ ok: true })),
    move: mock(() => Promise.resolve({ ok: true })),
  };

  const decay = {
    computeDecay: mock((fragment) => fragment.decay.current_weight),
    shouldArchive: mock((fragment) => fragment.decay.current_weight < 0.1),
  };

  const lathe = {
    readDir: mock(() => Promise.resolve({ ok: true, value: [] })),
    writeFile: mock(() => Promise.resolve({ ok: true })),
  };

  const wire = {
    queueWrite: mock(() => ({ ok: true })),
    send: mock(() => Promise.resolve({ ok: true })),
  };

  const switchboard = {
    emit: mock(() => {}),
  };

  const config = {};

  return {
    triage,
    provisionalRem,
    fullRem,
    heartbeatMonitor,
    journal,
    decay,
    lathe,
    wire,
    switchboard,
    config,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rem-consolidator', () => {
  let deps;
  let consolidator;

  beforeEach(() => {
    deps = createMockDeps();
    consolidator = createRemConsolidator(deps);
  });

  describe('createRemConsolidator', () => {
    it('returns a frozen object with all handler methods', () => {
      expect(Object.isFrozen(consolidator)).toBe(true);
      expect(typeof consolidator.handleTier1).toBe('function');
      expect(typeof consolidator.handleTier2).toBe('function');
      expect(typeof consolidator.abortTier2).toBe('function');
      expect(typeof consolidator.handleTier3).toBe('function');
      expect(typeof consolidator.handleDormantMaintenance).toBe('function');
      expect(typeof consolidator.handleCrashRecovery).toBe('function');
    });
  });

  describe('handleTier1', () => {
    it('delegates to triage.snapshot(payload)', async () => {
      const mindState = {
        attention_pointer: 'javascript-patterns',
        working_fragments: ['frag-001', 'frag-002'],
        sublimation_candidates: [],
        self_model_prompt_state: 'hash-abc123',
      };

      await consolidator.handleTier1(mindState);

      expect(deps.triage.snapshot).toHaveBeenCalledTimes(1);
      expect(deps.triage.snapshot.mock.calls[0][0]).toBe(mindState);
    });

    it('emits reverie:rem:tier1-complete', async () => {
      await consolidator.handleTier1({});

      const emitCalls = deps.switchboard.emit.mock.calls;
      const tier1Call = emitCalls.find(c => c[0] === 'reverie:rem:tier1-complete');
      expect(tier1Call).toBeDefined();
    });
  });

  describe('handleTier2', () => {
    it('delegates to provisionalRem.run()', async () => {
      const sessionContext = {
        summary: 'Session summary',
        fragments: [makeMockFragment('frag-001')],
        recallEvents: [],
        metrics: { turn_count: 10 },
        domainData: { domainPairs: [], entityList: [], associationStats: [] },
        llmResponses: {},
      };

      await consolidator.handleTier2(sessionContext);

      expect(deps.provisionalRem.run).toHaveBeenCalledTimes(1);
    });

    it('emits reverie:rem:tier2-complete on success', async () => {
      const sessionContext = {
        summary: 'Session summary',
        fragments: [],
        recallEvents: [],
        metrics: {},
        domainData: {},
        llmResponses: {},
      };

      await consolidator.handleTier2(sessionContext);

      const emitCalls = deps.switchboard.emit.mock.calls;
      const tier2Call = emitCalls.find(c => c[0] === 'reverie:rem:tier2-complete');
      expect(tier2Call).toBeDefined();
    });
  });

  describe('abortTier2', () => {
    it('delegates to provisionalRem.abort()', () => {
      consolidator.abortTier2();

      expect(deps.provisionalRem.abort).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleTier3', () => {
    it('delegates to fullRem.run()', async () => {
      const sessionContext = {
        summary: 'Session summary',
        fragments: [makeMockFragment('frag-001')],
        recallEvents: [],
        metrics: { turn_count: 30 },
        domainData: { domainPairs: [], entityList: [], associationStats: [] },
        llmResponses: {},
      };

      await consolidator.handleTier3(sessionContext);

      expect(deps.fullRem.run).toHaveBeenCalledTimes(1);
    });

    it('emits reverie:rem:tier3-complete', async () => {
      const sessionContext = {
        summary: 'Session summary',
        fragments: [],
        recallEvents: [],
        metrics: {},
        domainData: {},
        llmResponses: {},
      };

      await consolidator.handleTier3(sessionContext);

      const emitCalls = deps.switchboard.emit.mock.calls;
      const tier3Call = emitCalls.find(c => c[0] === 'reverie:rem:tier3-complete');
      expect(tier3Call).toBeDefined();
    });
  });

  describe('handleDormantMaintenance', () => {
    it('runs decay computation on all active fragments', async () => {
      const result = await consolidator.handleDormantMaintenance();

      expect(deps.journal.list).toHaveBeenCalledWith('active');
      expect(deps.decay.computeDecay).toHaveBeenCalled();
      expect(typeof result.checked).toBe('number');
      expect(typeof result.archived).toBe('number');
      expect(typeof result.still_active).toBe('number');
    });

    it('archives fragments below archive_threshold', async () => {
      const result = await consolidator.handleDormantMaintenance();

      // frag-active-002 has current_weight 0.05 which is < 0.1 (archive threshold)
      expect(result.archived).toBeGreaterThan(0);
    });
  });

  describe('handleCrashRecovery', () => {
    it('detects orphaned working/ fragments and triggers recovery REM', async () => {
      const result = await consolidator.handleCrashRecovery('current-session-id');

      expect(deps.journal.list).toHaveBeenCalledWith('working');
      expect(typeof result.hasOrphans).toBe('boolean');
      expect(Array.isArray(result.orphanedSessions)).toBe(true);
      expect(typeof result.recoveryTriggered).toBe('boolean');
    });

    it('identifies orphans by session ID mismatch', async () => {
      const result = await consolidator.handleCrashRecovery('current-session-id');

      // frag-orphan-001 has source_session 'old-session' != 'current-session-id'
      expect(result.hasOrphans).toBe(true);
      expect(result.orphanedSessions).toContain('old-session');
    });
  });
});
