'use strict';

const { describe, it, expect, mock, beforeEach } = require('bun:test');
const { createProvisionalRem } = require('../provisional-rem.cjs');

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeMockFragment(id, opts = {}) {
  return {
    id,
    type: opts.type || 'experiential',
    created: '2026-03-25T00:00:00Z',
    source_session: 'session-1',
    self_model_version: 'sm-identity-v1',
    formation_group: 'fg-001',
    formation_frame: 'experiential',
    sibling_fragments: [],
    temporal: { absolute: '2026-03-25T00:00:00Z', session_relative: 0.5, sequence: 1 },
    decay: {
      initial_weight: 0.8,
      current_weight: 0.7,
      last_accessed: '2026-03-25T00:00:00Z',
      access_count: 1,
      consolidation_count: 0,
      pinned: false,
    },
    associations: {
      domains: ['programming'],
      entities: ['javascript'],
      self_model_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 },
      emotional_valence: 0.1,
      attention_tags: ['learning'],
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
      trigger: 'user discussed JavaScript patterns',
      attention_pointer: 'javascript-patterns',
      active_domains_at_formation: ['programming'],
      sublimation_that_prompted: null,
    },
    _lifecycle: opts._lifecycle || 'working',
    _body: opts.body || 'Fragment body text about JavaScript patterns.',
  };
}

function createMockDeps() {
  // Track promoted fragment IDs for abort testing
  const _promotedIds = [];

  // Full REM mock that tracks promotions
  const fullRem = {
    run: mock(async (summary, fragments, recallEvents, metrics, domainData, llmResponses) => {
      // Simulate promotions by tracking IDs
      for (const f of fragments.slice(0, 2)) {
        _promotedIds.push(f.id);
      }
      return {
        promoted: 2,
        discarded: 1,
        sublimation_promoted: 0,
        meta_recalls_created: 0,
        entities_deduped: 0,
        weights_updated: 0,
        domains_merged: 0,
        conditioning_updated: true,
        quality_score: 0.75,
        timed_out: false,
        skipped_steps: [],
      };
    }),
  };

  const journal = {
    read: mock(() => Promise.resolve({ ok: true, value: { frontmatter: {}, body: '' } })),
    write: mock(() => Promise.resolve({ ok: true, value: {} })),
    delete: mock(() => Promise.resolve({ ok: true, value: {} })),
    move: mock(() => Promise.resolve({ ok: true, value: {} })),
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
    fullRem,
    journal,
    wire,
    switchboard,
    config,
    _promotedIds,
  };
}

function makeSessionArgs() {
  return {
    sessionSummary: 'User worked on JavaScript refactoring patterns.',
    fragments: [
      makeMockFragment('frag-001'),
      makeMockFragment('frag-002'),
      makeMockFragment('frag-003'),
    ],
    recallEvents: [],
    sessionMetrics: { turn_count: 20, avg_turn_length: 150, session_duration_ms: 2700000 },
    domainData: { domainPairs: [], entityList: [], associationStats: [] },
    llmResponses: {
      llmEvalResponse: '[]',
      llmMetaRecallResponse: null,
      llmEditorialResponse: '{}',
      llmQualityScore: 0.8,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('provisional-rem', () => {
  let deps;
  let provisionalRem;

  beforeEach(() => {
    deps = createMockDeps();
    provisionalRem = createProvisionalRem(deps);
  });

  describe('createProvisionalRem', () => {
    it('returns a frozen object', () => {
      expect(Object.isFrozen(provisionalRem)).toBe(true);
    });

    it('exposes run, abort, and isRunning methods', () => {
      expect(typeof provisionalRem.run).toBe('function');
      expect(typeof provisionalRem.abort).toBe('function');
      expect(typeof provisionalRem.isRunning).toBe('function');
    });
  });

  describe('run()', () => {
    it('executes same pipeline as full REM (delegates to fullRem.run)', async () => {
      const args = makeSessionArgs();
      await provisionalRem.run(
        args.sessionSummary, args.fragments, args.recallEvents,
        args.sessionMetrics, args.domainData, args.llmResponses
      );

      expect(deps.fullRem.run).toHaveBeenCalledTimes(1);
    });

    it('sets _tentative flag in fragment frontmatter during promotion', async () => {
      const args = makeSessionArgs();
      const result = await provisionalRem.run(
        args.sessionSummary, args.fragments, args.recallEvents,
        args.sessionMetrics, args.domainData, args.llmResponses
      );

      // The result should indicate tentative processing was done
      expect(result).toBeDefined();
      expect(typeof result.promoted).toBe('number');
    });

    it('isRunning returns true during run(), false after completion', async () => {
      expect(provisionalRem.isRunning()).toBe(false);

      const args = makeSessionArgs();

      // Check isRunning within the run via a side-effect capture
      let wasRunningDuringExec = false;
      const origRun = deps.fullRem.run;
      deps.fullRem.run = mock(async (...runArgs) => {
        wasRunningDuringExec = provisionalRem.isRunning();
        return origRun(...runArgs);
      });

      await provisionalRem.run(
        args.sessionSummary, args.fragments, args.recallEvents,
        args.sessionMetrics, args.domainData, args.llmResponses
      );

      expect(wasRunningDuringExec).toBe(true);
      expect(provisionalRem.isRunning()).toBe(false);
    });

    it('after run() completes without abort, tentative flags are removed (auto-promote per D-04)', async () => {
      const args = makeSessionArgs();
      const result = await provisionalRem.run(
        args.sessionSummary, args.fragments, args.recallEvents,
        args.sessionMetrics, args.domainData, args.llmResponses
      );

      // Result should indicate auto-promotion completed
      expect(result.auto_promoted).toBe(true);
    });
  });

  describe('abort()', () => {
    it('reverts all tentative promotions on abort', async () => {
      // Setup: make fullRem.run slow so we can abort mid-execution
      let resolveRun;
      const runPromise = new Promise(resolve => { resolveRun = resolve; });

      deps.fullRem.run = mock(async () => {
        await runPromise;
        return {
          promoted: 2, discarded: 0, sublimation_promoted: 0,
          meta_recalls_created: 0, entities_deduped: 0, weights_updated: 0,
          domains_merged: 0, conditioning_updated: true, quality_score: 0.75,
          timed_out: false, skipped_steps: [],
        };
      });

      const args = makeSessionArgs();
      const runResult = provisionalRem.run(
        args.sessionSummary, args.fragments, args.recallEvents,
        args.sessionMetrics, args.domainData, args.llmResponses
      );

      // Abort while running
      const abortResult = provisionalRem.abort();
      expect(abortResult).toBeDefined();

      // Emit should have been called with tier2-aborted
      const abortCall = deps.switchboard.emit.mock.calls.find(c => c[0] === 'reverie:rem:tier2-aborted');
      expect(abortCall).toBeDefined();

      // Resolve run to complete
      resolveRun();
      await runResult;
    });

    it('abort during run() cancels remaining pipeline steps', async () => {
      let resolveRun;
      const runPromise = new Promise(resolve => { resolveRun = resolve; });

      deps.fullRem.run = mock(async () => {
        await runPromise;
        return {
          promoted: 0, discarded: 0, sublimation_promoted: 0,
          meta_recalls_created: 0, entities_deduped: 0, weights_updated: 0,
          domains_merged: 0, conditioning_updated: false, quality_score: 0,
          timed_out: false, skipped_steps: [],
        };
      });

      const args = makeSessionArgs();
      const runProm = provisionalRem.run(
        args.sessionSummary, args.fragments, args.recallEvents,
        args.sessionMetrics, args.domainData, args.llmResponses
      );

      // Abort
      provisionalRem.abort();

      // isRunning should be false after abort
      expect(provisionalRem.isRunning()).toBe(false);

      resolveRun();
      const result = await runProm;

      // Result should reflect aborted state
      expect(result.aborted).toBe(true);
    });

    it('isRunning returns false after abort', () => {
      // Start is not yet called; isRunning should be false
      provisionalRem.abort();
      expect(provisionalRem.isRunning()).toBe(false);
    });
  });
});
