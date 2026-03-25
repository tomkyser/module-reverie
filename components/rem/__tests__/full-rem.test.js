'use strict';

const { describe, it, expect, mock, beforeEach } = require('bun:test');
const { createFullRem } = require('../full-rem.cjs');

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
      domains: opts.domains || ['programming'],
      entities: opts.entities || ['javascript'],
      self_model_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 },
      emotional_valence: 0.1,
      attention_tags: opts.attention_tags || ['learning'],
    },
    pointers: {
      causal_antecedents: [],
      causal_consequents: [],
      thematic_siblings: [],
      contradictions: [],
      meta_recalls: [],
      source_fragments: opts.source_fragments || [],
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
  // Retroactive evaluator mock
  const retroactiveEvaluator = {
    evaluate: mock((sessionSummary, fragments, recallEvents) => ({
      prompt: 'eval prompt',
      metaRecallPrompt: 'meta prompt',
      apply: mock(async (evalResponse, metaResponse) => ({
        promoted: 3,
        discarded: 1,
        meta_recalls_created: 1,
        errors: [],
        _promotedFragments: fragments.slice(0, 3).map(f => ({ ...f, type: f.type })),
      })),
    })),
  };

  // Editorial pass mock
  const editorialPass = {
    run: mock((domainPairs, entityList, associationStats) => ({
      prompt: 'editorial prompt',
      apply: mock(async (response) => ({
        entities_deduped: 2,
        weights_updated: 5,
        domains_merged: 1,
        domains_reviewed: 3,
        narratives_written: 1,
      })),
    })),
  };

  // Conditioning updater mock
  const conditioningUpdater = {
    updateConditioning: mock((current, evidence, config) => ({
      attention_biases: { topic_a: 0.6 },
      sublimation_sensitivity: { domain_a: 0.4 },
      recall_strategies: [],
      error_history: [],
    })),
    persistConditioning: mock((updatedConditioning) => ({ ok: true })),
    enforceIdentityFloors: mock((identityCore, floor) => identityCore),
    checkDiversityThreshold: mock((identityCore, threshold) => ({ belowThreshold: false, variance: 0.1 })),
    boostUnderrepresented: mock((identityCore, amount) => identityCore),
  };

  // Quality evaluator mock
  const qualityEvaluator = {
    evaluateSession: mock((metrics, llmScore) => ({
      quality_score: 0.75,
      behavioral_score: 0.7,
      llm_score: 0.8,
      entropy_evolved: true,
    })),
  };

  // Self Model mock
  const selfModel = {
    getAspect: mock((aspect) => {
      if (aspect === 'conditioning') {
        return { ok: true, value: { attention_biases: {}, sublimation_sensitivity: {}, recall_strategies: [], error_history: [] } };
      }
      if (aspect === 'identity-core') {
        return { ok: true, value: { personality_traits: { openness: 0.8 }, communication_style: { formality: 0.5 }, value_orientations: [] } };
      }
      return { ok: true, value: {} };
    }),
    setAspect: mock(() => ({ ok: true })),
    getSessionCount: mock(() => 10),
  };

  // Journal mock
  const journal = {
    read: mock(() => Promise.resolve({ ok: true, value: { frontmatter: {}, body: '' } })),
    list: mock(() => Promise.resolve({ ok: true, value: [] })),
  };

  // Wire mock
  const wire = {
    queueWrite: mock(() => ({ ok: true })),
    send: mock(() => Promise.resolve({ ok: true })),
  };

  // Switchboard mock
  const switchboard = {
    emit: mock(() => {}),
  };

  const config = {};

  return {
    retroactiveEvaluator,
    editorialPass,
    conditioningUpdater,
    qualityEvaluator,
    selfModel,
    journal,
    wire,
    switchboard,
    config,
  };
}

function makeSessionContext() {
  return {
    sessionSummary: 'User worked on JavaScript refactoring patterns for 45 minutes.',
    fragments: [
      makeMockFragment('frag-001'),
      makeMockFragment('frag-002'),
      makeMockFragment('frag-003', { type: 'sublimation' }),
      makeMockFragment('frag-004', { type: 'sublimation' }),
    ],
    recallEvents: [
      { query: 'javascript patterns', fragments_composed: ['frag-old-1'], reconstruction_output: 'Recalled JS patterns', trigger: 'explicit', incorporated: true, significance: 0.8 },
    ],
    sessionMetrics: {
      turn_count: 20,
      avg_turn_length: 150,
      session_duration_ms: 2700000,
      recall_events: 1,
      recall_incorporated: 1,
      directive_compliance_rate: 0.9,
      friction_signals: 0,
    },
    domainData: {
      domainPairs: [{ domain_a: { id: 'd1', name: 'programming' }, domain_b: { id: 'd2', name: 'coding' }, overlap_score: 0.8, shared_entities: ['javascript'] }],
      entityList: [{ id: 'e1', name: 'javascript', occurrence_count: 5 }],
      associationStats: [{ id: 'a1', source_id: 'frag-001', target_id: 'frag-002', weight: 0.6, access_count: 3, last_accessed: '2026-03-25T00:00:00Z' }],
    },
    llmEvalResponse: JSON.stringify([
      { fragment_id: 'frag-001', action: 'promote', updated_relevance: { identity: 0.4, relational: 0.6, conditioning: 0.3 }, new_attention_tags: ['refactoring'], reason: 'Valuable JS pattern' },
      { fragment_id: 'frag-002', action: 'promote', updated_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 }, new_attention_tags: [], reason: 'Useful context' },
      { fragment_id: 'frag-003', action: 'promote', updated_relevance: { identity: 0.2, relational: 0.3, conditioning: 0.1 }, new_attention_tags: [], reason: 'Sublimation insight' },
      { fragment_id: 'frag-004', action: 'discard', updated_relevance: {}, new_attention_tags: [], reason: 'Low signal' },
    ]),
    llmMetaRecallResponse: JSON.stringify([{ source_fragments: ['frag-old-1'], body: 'Significant recall about JS patterns', attention_tags: ['meta-recall'] }]),
    llmEditorialResponse: JSON.stringify({ entity_merges: [], domain_decisions: [{ domain_a: 'programming', domain_b: 'coding', action: 'merge', reason: 'Near-synonym', merge_narrative: 'Merged coding into programming.' }], weight_updates: [] }),
    llmQualityScore: 0.8,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('full-rem', () => {
  let deps;
  let fullRem;

  beforeEach(() => {
    deps = createMockDeps();
    fullRem = createFullRem(deps);
  });

  describe('createFullRem', () => {
    it('returns a frozen object', () => {
      expect(Object.isFrozen(fullRem)).toBe(true);
    });

    it('exposes run method', () => {
      expect(typeof fullRem.run).toBe('function');
    });
  });

  describe('run()', () => {
    it('calls retroactiveEvaluator.evaluate with session summary and fragments', async () => {
      const ctx = makeSessionContext();
      await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(deps.retroactiveEvaluator.evaluate).toHaveBeenCalledTimes(1);
      const callArgs = deps.retroactiveEvaluator.evaluate.mock.calls[0];
      expect(callArgs[0]).toBe(ctx.sessionSummary);
      expect(callArgs[1]).toBe(ctx.fragments);
    });

    it('calls editorialPass.run with domain data', async () => {
      const ctx = makeSessionContext();
      await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(deps.editorialPass.run).toHaveBeenCalledTimes(1);
      const callArgs = deps.editorialPass.run.mock.calls[0];
      expect(callArgs[0]).toBe(ctx.domainData.domainPairs);
      expect(callArgs[1]).toBe(ctx.domainData.entityList);
      expect(callArgs[2]).toBe(ctx.domainData.associationStats);
    });

    it('calls conditioningUpdater.updateConditioning with session evidence', async () => {
      const ctx = makeSessionContext();
      await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(deps.conditioningUpdater.updateConditioning).toHaveBeenCalledTimes(1);
    });

    it('calls conditioningUpdater.persistConditioning with updated conditioning', async () => {
      const ctx = makeSessionContext();
      await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(deps.conditioningUpdater.persistConditioning).toHaveBeenCalledTimes(1);
    });

    it('calls conditioningUpdater.enforceIdentityFloors when session count >= identity_min_sessions', async () => {
      deps.selfModel.getSessionCount = mock(() => 10); // >= 5
      const ctx = makeSessionContext();
      await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(deps.conditioningUpdater.enforceIdentityFloors).toHaveBeenCalledTimes(1);
    });

    it('does NOT call enforceIdentityFloors when session count < identity_min_sessions', async () => {
      deps.selfModel.getSessionCount = mock(() => 2); // < 5
      const ctx = makeSessionContext();
      await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(deps.conditioningUpdater.enforceIdentityFloors).not.toHaveBeenCalled();
    });

    it('calls qualityEvaluator.evaluateSession with session metrics', async () => {
      const ctx = makeSessionContext();
      await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(deps.qualityEvaluator.evaluateSession).toHaveBeenCalledTimes(1);
      const callArgs = deps.qualityEvaluator.evaluateSession.mock.calls[0];
      expect(callArgs[0]).toBe(ctx.sessionMetrics);
    });

    it('enforces max_consolidated_per_session cap on promotions', async () => {
      // Create more fragments than the cap
      const manyFragments = [];
      const evalDecisions = [];
      for (let i = 0; i < 25; i++) {
        manyFragments.push(makeMockFragment(`frag-${String(i).padStart(3, '0')}`));
        evalDecisions.push({
          fragment_id: `frag-${String(i).padStart(3, '0')}`,
          action: 'promote',
          updated_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
          new_attention_tags: [],
          reason: 'Good',
          _score: 1.0 - (i * 0.01), // descending score so first 20 are kept
        });
      }

      deps.retroactiveEvaluator.evaluate = mock(() => ({
        prompt: 'eval prompt',
        metaRecallPrompt: null,
        apply: mock(async () => ({
          promoted: 25,
          discarded: 0,
          meta_recalls_created: 0,
          errors: [],
          _promotedFragments: manyFragments.map(f => ({ ...f })),
        })),
      }));

      const ctx = makeSessionContext();
      const result = await fullRem.run(ctx.sessionSummary, manyFragments, [], ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: JSON.stringify(evalDecisions),
        llmMetaRecallResponse: null,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      // max_consolidated_per_session is 20 by default
      expect(result.promoted).toBeLessThanOrEqual(20);
    });

    it('enforces sublimation_triage_cap on sublimation fragment promotions', async () => {
      // Create many sublimation fragments
      const fragments = [];
      const evalDecisions = [];
      for (let i = 0; i < 10; i++) {
        fragments.push(makeMockFragment(`frag-sub-${i}`, { type: 'sublimation' }));
        evalDecisions.push({
          fragment_id: `frag-sub-${i}`,
          action: 'promote',
          updated_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
          new_attention_tags: [],
          reason: 'Good sublimation',
          _score: 1.0 - (i * 0.05),
        });
      }

      deps.retroactiveEvaluator.evaluate = mock(() => ({
        prompt: 'eval prompt',
        metaRecallPrompt: null,
        apply: mock(async () => ({
          promoted: 10,
          discarded: 0,
          meta_recalls_created: 0,
          errors: [],
          _promotedFragments: fragments.map(f => ({ ...f })),
        })),
      }));

      const ctx = makeSessionContext();
      const result = await fullRem.run(ctx.sessionSummary, fragments, [], ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: JSON.stringify(evalDecisions),
        llmMetaRecallResponse: null,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      // sublimation_triage_cap is 5 by default
      expect(result.sublimation_promoted).toBeLessThanOrEqual(5);
    });

    it('enforces rem_time_budget_ms timeout', async () => {
      // Provide a very small time budget
      const deps2 = createMockDeps();
      const fullRem2 = createFullRem({ ...deps2, config: { rem_time_budget_ms: 1 } });

      // Make retroactive evaluate take some time
      deps2.retroactiveEvaluator.evaluate = mock(() => ({
        prompt: 'eval prompt',
        metaRecallPrompt: null,
        apply: mock(async () => {
          // Simulate some work
          return { promoted: 2, discarded: 0, meta_recalls_created: 0, errors: [], _promotedFragments: [] };
        }),
      }));

      const ctx = makeSessionContext();
      const result = await fullRem2.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      // Should still return a result (partial if timed out)
      expect(result).toBeDefined();
      expect(typeof result.timed_out).toBe('boolean');
    });

    it('emits reverie:rem:tier3-complete with summary stats', async () => {
      const ctx = makeSessionContext();
      await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(deps.switchboard.emit).toHaveBeenCalled();
      const emitCalls = deps.switchboard.emit.mock.calls;
      const tier3Call = emitCalls.find(c => c[0] === 'reverie:rem:tier3-complete');
      expect(tier3Call).toBeDefined();
    });

    it('returns result object with expected fields', async () => {
      const ctx = makeSessionContext();
      const result = await fullRem.run(ctx.sessionSummary, ctx.fragments, ctx.recallEvents, ctx.sessionMetrics, ctx.domainData, {
        llmEvalResponse: ctx.llmEvalResponse,
        llmMetaRecallResponse: ctx.llmMetaRecallResponse,
        llmEditorialResponse: ctx.llmEditorialResponse,
        llmQualityScore: ctx.llmQualityScore,
      });

      expect(typeof result.promoted).toBe('number');
      expect(typeof result.discarded).toBe('number');
      expect(typeof result.meta_recalls_created).toBe('number');
      expect(typeof result.entities_deduped).toBe('number');
      expect(typeof result.conditioning_updated).toBe('boolean');
      expect(typeof result.quality_score).toBe('number');
    });
  });
});
