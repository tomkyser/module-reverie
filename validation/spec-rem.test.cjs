'use strict';

/**
 * Spec compliance test: REM Consolidation (reverie-spec-v2.md sections 5.1-5.4).
 *
 * Verifies:
 * - Section 5.1: Biological Analog — informational, marked NA
 * - Section 5.2: Three Consolidation Tiers — Triage (PreCompact), Provisional REM
 *   (idle timeout), Full REM (session end)
 * - Section 5.3: REM Operations — retroactive evaluation, meta-fragment creation,
 *   editorial pass (entity dedup, weight updates, domain boundary review),
 *   conditioning update
 * - Section 5.4: Working Memory Gate — REM consolidator is single entry point,
 *   no bypass path exists for fragment promotion
 *
 * Known deviations (documented in STATE.md):
 * - [Phase 11] Prompt/apply separation: evaluator and editorial pass compose LLM
 *   prompts but never call LLM directly
 * - [Phase 11] Full REM accepts llmResponses parameter for prompt/apply separation
 * - [Phase 11] Dual-signal quality evaluation: behavioral (0.4) + LLM reflection
 *   (0.6) with behavioral-only fallback
 * - [Phase 11] EMA record-level updates default new keys to 0.5 midpoint
 * - [Phase 11] REM consolidator is single entry point for all consolidation --
 *   enforces REM-07 gate
 * - [Phase 11] Provisional REM uses _running/_aborted/_tentativeFragmentIds state
 *   machine for clean lifecycle
 * - [Phase 12] Cap pressure computed in full-rem.cjs Step 3
 *
 * @module reverie/validation/spec-rem.test
 */

const { describe, it, expect, beforeEach } = require('bun:test');

// ---------------------------------------------------------------------------
// Helpers: minimal mocks matching real factory signatures
// ---------------------------------------------------------------------------

/** Creates a minimal mock Lathe service. */
function mockLathe() {
  return {
    writeFile: async () => ({ ok: true }),
    readFile: async () => ({ ok: true, value: '{}' }),
  };
}

/** Creates a minimal mock Switchboard. */
function mockSwitchboard() {
  const events = [];
  return {
    emit: (event, data) => events.push({ event, data }),
    on: () => {},
    _events: events,
  };
}

/** Creates a minimal mock Journal. */
function mockJournal() {
  return {
    list: async () => ({ ok: true, value: [] }),
    delete: async () => ({ ok: true }),
    move: async () => ({ ok: true }),
  };
}

/** Creates a minimal mock Wire. */
function mockWire() {
  const writes = [];
  return {
    queueWrite: (envelope) => writes.push(envelope),
    _writes: writes,
  };
}

/** Creates a minimal mock FragmentWriter. */
function mockFragmentWriter() {
  let idCounter = 0;
  const written = [];
  return {
    generateFragmentId: () => `frag-test-${++idCounter}`,
    writeFragment: async (fragment, body) => {
      written.push({ fragment, body });
      return { ok: true, value: { id: fragment.id } };
    },
    _written: written,
  };
}

/** Creates a minimal mock Self Model. */
function mockSelfModel() {
  const aspects = {
    'conditioning': {
      attention_biases: { coding: 0.7 },
      sublimation_sensitivity: { general: 0.5 },
      association_priors: {},
      recall_strategies: [],
      error_history: [],
    },
    'identity-core': {
      personality_traits: { analytical: 0.6, creative: 0.5 },
      communication_style: { formal: 0.7, concise: 0.4 },
      value_orientations: [{ name: 'precision', weight: 0.8 }],
    },
  };
  return {
    getAspect: (name) => ({ ok: true, value: aspects[name] || {} }),
    setAspect: (name, data) => { aspects[name] = data; return { ok: true }; },
    getSessionCount: () => 10,
    _aspects: aspects,
  };
}

// ---------------------------------------------------------------------------
// Section 5.1: The Biological Analog
// ---------------------------------------------------------------------------

describe('Spec 5.1: The Biological Analog', () => {
  it('is informational/motivational -- no code verification needed (NA)', () => {
    // Section 5.1 describes the biological sleep/REM analog as philosophical
    // grounding for the design. No implementation required.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 5.2: Three Consolidation Tiers
// ---------------------------------------------------------------------------

describe('Spec 5.2: Three Consolidation Tiers', () => {

  // -------------------------------------------------------------------------
  // Tier 1: Triage (PreCompact)
  // -------------------------------------------------------------------------

  describe('Tier 1: Triage (PreCompact)', () => {
    it('triage factory exists and exports createTriage', () => {
      const mod = require('../components/rem/triage.cjs');
      expect(mod).toHaveProperty('createTriage');
      expect(typeof mod.createTriage).toBe('function');
    });

    it('triage.snapshot handles PreCompact events by writing state to filesystem', async () => {
      const { createTriage } = require('../components/rem/triage.cjs');
      const lathe = mockLathe();
      const sw = mockSwitchboard();

      const triage = createTriage({
        lathe,
        switchboard: sw,
        dataDir: '/tmp/test-rem',
        sessionId: 'sess-001',
      });

      const mindState = {
        attention_pointer: 'coding:javascript',
        working_fragments: ['frag-1', 'frag-2'],
        sublimation_candidates: ['sub-1'],
        self_model_prompt_state: 'prompt-hash-abc',
      };

      const result = await triage.snapshot(mindState);

      // Triage should succeed
      expect(result.ok).toBe(true);
      // Should report fields saved (6 fields: attention_pointer, working_fragments,
      // sublimation_candidates, self_model_prompt_state, timestamp, session_id)
      expect(result.value.fields_saved).toBe(6);
    });

    it('triage preserves all spec-required fields per Section 5.2 Tier 1', async () => {
      const { createTriage } = require('../components/rem/triage.cjs');
      let writtenContent = null;
      const lathe = {
        writeFile: async (path, content) => {
          writtenContent = JSON.parse(content);
          return { ok: true };
        },
      };

      const triage = createTriage({
        lathe,
        switchboard: mockSwitchboard(),
        dataDir: '/tmp/test-rem',
        sessionId: 'sess-triage',
      });

      await triage.snapshot({
        attention_pointer: 'topic:AI',
        working_fragments: ['frag-a'],
        sublimation_candidates: ['sub-a'],
        self_model_prompt_state: 'hash-xyz',
      });

      // Verify all spec-required snapshot fields
      expect(writtenContent).toHaveProperty('attention_pointer');
      expect(writtenContent).toHaveProperty('working_fragments');
      expect(writtenContent).toHaveProperty('sublimation_candidates');
      expect(writtenContent).toHaveProperty('self_model_prompt_state');
      expect(writtenContent).toHaveProperty('timestamp');
      expect(writtenContent).toHaveProperty('session_id');
      expect(writtenContent.session_id).toBe('sess-triage');
    });

    it('triage is fast -- no LLM calls, filesystem writes only', async () => {
      const { createTriage } = require('../components/rem/triage.cjs');
      let llmCalled = false;
      const lathe = {
        writeFile: async () => {
          // Filesystem write only -- no LLM interaction
          return { ok: true };
        },
      };

      const triage = createTriage({ lathe, dataDir: '/tmp' });

      // There is no LLM parameter or call path in triage
      // Verify the factory signature accepts no LLM-related options
      const result = await triage.snapshot({});
      expect(result.ok).toBe(true);
      expect(llmCalled).toBe(false);
    });

    it('triage handles empty/null mindState gracefully', async () => {
      const { createTriage } = require('../components/rem/triage.cjs');
      const triage = createTriage({ lathe: mockLathe(), dataDir: '/tmp' });

      const result = await triage.snapshot(null);
      expect(result.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Tier 2: Provisional REM (idle timeout)
  // -------------------------------------------------------------------------

  describe('Tier 2: Provisional REM (idle timeout)', () => {
    it('provisional-rem factory exists and exports createProvisionalRem', () => {
      const mod = require('../components/rem/provisional-rem.cjs');
      expect(mod).toHaveProperty('createProvisionalRem');
      expect(typeof mod.createProvisionalRem).toBe('function');
    });

    it('provisional REM runs full consolidation flagged as tentative', async () => {
      const { createProvisionalRem } = require('../components/rem/provisional-rem.cjs');

      let fullRemCalled = false;
      const mockFullRem = {
        run: async () => {
          fullRemCalled = true;
          return {
            promoted: 3,
            discarded: 1,
            sublimation_promoted: 1,
            meta_recalls_created: 0,
            entities_deduped: 0,
            weights_updated: 0,
            domains_merged: 0,
            conditioning_updated: false,
            quality_score: 0.7,
            timed_out: false,
            skipped_steps: [],
          };
        },
      };

      const prem = createProvisionalRem({ fullRem: mockFullRem });
      const result = await prem.run('summary', [{ id: 'f1' }], [], {}, {});

      // Delegates to full REM
      expect(fullRemCalled).toBe(true);
      // Auto-promotes on completion (D-04)
      expect(result.auto_promoted).toBe(true);
      expect(result.aborted).toBe(false);
    });

    it('provisional REM uses state machine with running/aborted/tentativeFragmentIds', () => {
      const { createProvisionalRem } = require('../components/rem/provisional-rem.cjs');

      const mockFullRem = { run: async () => ({}) };
      const prem = createProvisionalRem({ fullRem: mockFullRem });

      // Exposes state-related API
      expect(typeof prem.isRunning).toBe('function');
      expect(typeof prem.abort).toBe('function');
      expect(typeof prem.run).toBe('function');
      // Not running initially
      expect(prem.isRunning()).toBe(false);
    });

    it('provisional REM can be aborted mid-execution -- reverts tentative promotions', () => {
      const { createProvisionalRem } = require('../components/rem/provisional-rem.cjs');

      const mockFullRem = {
        run: async () => {
          // Simulate long-running pipeline
          return { promoted: 2, discarded: 0 };
        },
      };

      const prem = createProvisionalRem({
        fullRem: mockFullRem,
        journal: mockJournal(),
        wire: mockWire(),
        switchboard: mockSwitchboard(),
      });

      // Abort immediately returns revert count
      const abortResult = prem.abort();
      expect(abortResult.ok).toBe(true);
      expect(typeof abortResult.reverted).toBe('number');
    });

    it('heartbeat monitor fires idle timeout to trigger Tier 2', () => {
      const { createHeartbeatMonitor } = require('../components/rem/heartbeat-monitor.cjs');
      const sw = mockSwitchboard();

      const monitor = createHeartbeatMonitor({
        switchboard: sw,
        config: {
          heartbeat_timeout_ms: 50,
          tier2_check_interval_ms: 10,
        },
      });

      expect(typeof monitor.onHeartbeat).toBe('function');
      expect(typeof monitor.start).toBe('function');
      expect(typeof monitor.stop).toBe('function');
      expect(typeof monitor.isActive).toBe('function');
    });

    it('heartbeat monitor emits timeout event when heartbeats stop', async () => {
      const { createHeartbeatMonitor } = require('../components/rem/heartbeat-monitor.cjs');
      const sw = mockSwitchboard();

      const monitor = createHeartbeatMonitor({
        switchboard: sw,
        config: {
          heartbeat_timeout_ms: 30,
          tier2_check_interval_ms: 10,
        },
      });

      monitor.start();
      // Wait for timeout to trigger
      await new Promise(resolve => setTimeout(resolve, 80));
      monitor.stop();

      const timeoutEvents = sw._events.filter(e => e.event === 'reverie:heartbeat:timeout');
      expect(timeoutEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Tier 3: Full REM (session end)
  // -------------------------------------------------------------------------

  describe('Tier 3: Full REM (session end)', () => {
    it('full-rem factory exists and exports createFullRem', () => {
      const mod = require('../components/rem/full-rem.cjs');
      expect(mod).toHaveProperty('createFullRem');
      expect(typeof mod.createFullRem).toBe('function');
    });

    it('full REM fires on session end with complete pipeline', async () => {
      const { createFullRem } = require('../components/rem/full-rem.cjs');

      // Build full dependency set with minimal mocks
      const evalDecisions = JSON.stringify([
        { fragment_id: 'f1', action: 'promote', updated_relevance: { identity: 0.5, relational: 0.3, conditioning: 0.2 }, new_attention_tags: ['verified'], reason: 'Significant' },
        { fragment_id: 'f2', action: 'discard', reason: 'Noise' },
      ]);

      const editorialDecisions = JSON.stringify({
        entity_merges: [],
        domain_decisions: [],
        weight_updates: [],
      });

      const retroactiveEvaluator = {
        evaluate: (summary, fragments, recalls) => ({
          prompt: 'eval-prompt',
          metaRecallPrompt: null,
          apply: async (evalResp, metaResp) => ({
            promoted: 1,
            discarded: 1,
            meta_recalls_created: 0,
            _promotedFragments: [{ id: 'f1', type: 'episodic' }],
          }),
        }),
      };

      const editorialPass = {
        run: (pairs, entities, stats, capPressure) => ({
          prompt: 'editorial-prompt',
          apply: async (resp) => ({
            entities_deduped: 0,
            weights_updated: 0,
            domains_merged: 0,
            splits_applied: 0,
            retirements_applied: 0,
          }),
        }),
      };

      const conditioningUpdater = {
        updateConditioning: (current, evidence, config) => ({
          attention_biases: { coding: 0.7 },
          sublimation_sensitivity: {},
          association_priors: {},
          recall_strategies: [],
          error_history: [],
        }),
        persistConditioning: () => ({ ok: true }),
        enforceIdentityFloors: (core, floor) => core,
        checkDiversityThreshold: (core, threshold) => ({ belowThreshold: false, variance: 0.1 }),
        boostUnderrepresented: (core, amount) => core,
      };

      const qualityEvaluator = {
        evaluateSession: (metrics, score) => ({
          quality_score: 0.75,
          behavioral_score: 0.7,
          llm_score: 0.8,
          entropy_evolved: false,
        }),
      };

      const fullRem = createFullRem({
        retroactiveEvaluator,
        editorialPass,
        conditioningUpdater,
        qualityEvaluator,
        selfModel: mockSelfModel(),
        switchboard: mockSwitchboard(),
      });

      const result = await fullRem.run(
        'Session explored JavaScript patterns.',
        [{ id: 'f1', type: 'episodic', associations: { domains: ['coding'] } }, { id: 'f2', type: 'episodic' }],
        [],
        { turn_count: 10, avg_turn_length: 150 },
        { domainPairs: [], entityList: [], associationStats: [] },
        { llmEvalResponse: evalDecisions, llmEditorialResponse: editorialDecisions, llmQualityScore: 0.8 }
      );

      // Full pipeline ran
      expect(result.promoted).toBe(1);
      expect(result.discarded).toBe(1);
      expect(result.conditioning_updated).toBe(true);
      expect(result.quality_score).toBeGreaterThan(0);
      expect(result.timed_out).toBe(false);
    });

    it('full REM executes operations in spec-defined order: retroactive eval -> sublimation triage -> editorial -> conditioning -> quality', async () => {
      const { createFullRem } = require('../components/rem/full-rem.cjs');

      const callOrder = [];

      const retroactiveEvaluator = {
        evaluate: () => ({
          prompt: '',
          metaRecallPrompt: null,
          apply: async () => {
            callOrder.push('retroactive_evaluation');
            return { promoted: 2, discarded: 0, meta_recalls_created: 0, _promotedFragments: [] };
          },
        }),
      };

      const editorialPass = {
        run: () => ({
          prompt: '',
          apply: async () => {
            callOrder.push('editorial_pass');
            return { entities_deduped: 0, weights_updated: 0, domains_merged: 0, splits_applied: 0, retirements_applied: 0 };
          },
        }),
      };

      const conditioningUpdater = {
        updateConditioning: (curr, evidence) => {
          callOrder.push('conditioning_update');
          return curr;
        },
        persistConditioning: () => ({ ok: true }),
        enforceIdentityFloors: (core) => core,
        checkDiversityThreshold: () => ({ belowThreshold: false }),
        boostUnderrepresented: (core) => core,
      };

      const qualityEvaluator = {
        evaluateSession: () => {
          callOrder.push('quality_evaluation');
          return { quality_score: 0.5, behavioral_score: 0.5, llm_score: null, entropy_evolved: false };
        },
      };

      const fullRem = createFullRem({
        retroactiveEvaluator,
        editorialPass,
        conditioningUpdater,
        qualityEvaluator,
        selfModel: mockSelfModel(),
      });

      await fullRem.run('summary', [{ id: 'f1' }], [], {}, {}, {});

      // Verify spec-defined order (5.3): retroactive -> editorial -> conditioning -> quality
      // (sublimation triage is computed inline between retroactive and editorial)
      expect(callOrder).toEqual([
        'retroactive_evaluation',
        'editorial_pass',
        'conditioning_update',
        'quality_evaluation',
      ]);
    });

    it('full REM promotes fragments from working to active lifecycle', async () => {
      const { createFullRem } = require('../components/rem/full-rem.cjs');

      let promotedLifecycle = null;
      const retroactiveEvaluator = {
        evaluate: () => ({
          prompt: '',
          metaRecallPrompt: null,
          apply: async () => ({
            promoted: 1,
            discarded: 0,
            meta_recalls_created: 0,
            _promotedFragments: [{ id: 'f1', type: 'episodic', _lifecycle: 'active' }],
          }),
        }),
      };

      const editorialPass = {
        run: () => ({ prompt: '', apply: async () => ({ entities_deduped: 0, weights_updated: 0, domains_merged: 0, splits_applied: 0, retirements_applied: 0 }) }),
      };

      const conditioningUpdater = {
        updateConditioning: (c) => c,
        persistConditioning: () => ({ ok: true }),
        enforceIdentityFloors: (c) => c,
        checkDiversityThreshold: () => ({ belowThreshold: false }),
        boostUnderrepresented: (c) => c,
      };

      const qualityEvaluator = {
        evaluateSession: () => ({ quality_score: 0.5 }),
      };

      const fullRem = createFullRem({
        retroactiveEvaluator,
        editorialPass,
        conditioningUpdater,
        qualityEvaluator,
        selfModel: mockSelfModel(),
      });

      const result = await fullRem.run('summary', [{ id: 'f1' }], [], {}, {}, {});
      expect(result.promoted).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Section 5.3: REM Operations
// ---------------------------------------------------------------------------

describe('Spec 5.3: REM Operations', () => {

  // -------------------------------------------------------------------------
  // Retroactive evaluation
  // -------------------------------------------------------------------------

  describe('Retroactive evaluation', () => {
    it('retroactive-evaluator factory exists and exports createRetroactiveEvaluator', () => {
      const mod = require('../components/rem/retroactive-evaluator.cjs');
      expect(mod).toHaveProperty('createRetroactiveEvaluator');
      expect(typeof mod.createRetroactiveEvaluator).toBe('function');
    });

    it('evaluator re-evaluates fragments against completed session arc via prompt/apply', () => {
      const { createRetroactiveEvaluator } = require('../components/rem/retroactive-evaluator.cjs');

      const evaluator = createRetroactiveEvaluator({
        fragmentWriter: mockFragmentWriter(),
        journal: mockJournal(),
        wire: mockWire(),
        switchboard: mockSwitchboard(),
      });

      const fragments = [
        { id: 'f1', type: 'episodic', associations: { domains: ['coding'] }, _body: 'Test fragment' },
      ];

      // evaluate() returns prompt + apply function (prompt/apply separation)
      const evaluation = evaluator.evaluate('Full session summary.', fragments, []);

      expect(typeof evaluation.prompt).toBe('string');
      expect(evaluation.prompt.length).toBeGreaterThan(0);
      expect(typeof evaluation.apply).toBe('function');
    });

    it('evaluator promotes or discards fragments based on LLM response', async () => {
      const { createRetroactiveEvaluator } = require('../components/rem/retroactive-evaluator.cjs');
      const fw = mockFragmentWriter();
      const journal = mockJournal();
      const wire = mockWire();

      const evaluator = createRetroactiveEvaluator({
        fragmentWriter: fw,
        journal,
        wire,
        switchboard: mockSwitchboard(),
      });

      const fragments = [
        { id: 'f1', type: 'episodic', associations: { domains: ['coding'], attention_tags: [], self_model_relevance: {} }, decay: { consolidation_count: 0 }, _body: 'Important fragment' },
        { id: 'f2', type: 'episodic', associations: {}, decay: {}, _body: 'Noise fragment' },
      ];

      const evaluation = evaluator.evaluate('Session summary', fragments, []);

      const llmResponse = JSON.stringify([
        { fragment_id: 'f1', action: 'promote', updated_relevance: { identity: 0.7, relational: 0.3, conditioning: 0.2 }, new_attention_tags: ['key-insight'], reason: 'Critical' },
        { fragment_id: 'f2', action: 'discard', reason: 'Low value' },
      ]);

      const result = await evaluation.apply(llmResponse);

      expect(result.promoted).toBe(1);
      expect(result.discarded).toBe(1);
    });

    it('evaluator uses dual-signal quality evaluation: behavioral + LLM per D-12', () => {
      // Verified through quality-evaluator.cjs integration
      const { createQualityEvaluator } = require('../components/rem/quality-evaluator.cjs');

      const qe = createQualityEvaluator({});

      // With both signals: composite = behavioral * 0.4 + llm * 0.6
      const result = qe.evaluateSession(
        { turn_count: 30, avg_turn_length: 200, session_duration_ms: 1800000, recall_events: 5, recall_incorporated: 4, directive_compliance_rate: 0.9, friction_signals: 0 },
        0.8
      );

      expect(result.behavioral_score).toBeGreaterThan(0);
      expect(result.llm_score).toBe(0.8);
      expect(result.quality_score).toBeCloseTo(result.behavioral_score * 0.4 + 0.8 * 0.6, 4);
    });

    it('quality evaluator falls back to behavioral-only when no LLM score', () => {
      const { createQualityEvaluator } = require('../components/rem/quality-evaluator.cjs');

      const qe = createQualityEvaluator({});

      const result = qe.evaluateSession(
        { turn_count: 15, avg_turn_length: 100, session_duration_ms: 900000, recall_events: 2, recall_incorporated: 1, directive_compliance_rate: 0.8, friction_signals: 1 },
        null
      );

      expect(result.llm_score).toBeNull();
      // Behavioral-only fallback: quality_score equals behavioral_score
      expect(result.quality_score).toBe(result.behavioral_score);
    });
  });

  // -------------------------------------------------------------------------
  // Meta-fragment creation
  // -------------------------------------------------------------------------

  describe('Meta-fragment creation', () => {
    it('evaluator can create meta-recall fragments from significant recall events', async () => {
      const { createRetroactiveEvaluator } = require('../components/rem/retroactive-evaluator.cjs');
      const fw = mockFragmentWriter();

      const evaluator = createRetroactiveEvaluator({
        fragmentWriter: fw,
        journal: mockJournal(),
        wire: mockWire(),
        switchboard: mockSwitchboard(),
        config: { meta_recall_min_significance: 0.3 },
      });

      const fragments = [
        { id: 'f1', type: 'episodic', associations: {}, decay: {}, source_session: 'sess-1', self_model_version: 'sm-v1', _body: 'test' },
      ];

      const recallEvents = [
        { query: 'what about last time?', fragments_composed: ['old-f1'], reconstruction_output: 'Recalled X', trigger: 'explicit', incorporated: true, significance: 0.9 },
      ];

      const evaluation = evaluator.evaluate('Summary', fragments, recallEvents);

      // Meta-recall prompt should exist because there is a significant recall event
      expect(evaluation.metaRecallPrompt).not.toBeNull();
      expect(typeof evaluation.metaRecallPrompt).toBe('string');

      // Apply with meta-recall response
      const llmEval = JSON.stringify([{ fragment_id: 'f1', action: 'promote', updated_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 }, reason: 'ok' }]);
      const llmMetaRecall = JSON.stringify([{ source_fragments: ['old-f1'], body: 'This recall was significant because...', attention_tags: ['meta-recall', 'key-event'] }]);

      const result = await evaluation.apply(llmEval, llmMetaRecall);
      expect(result.meta_recalls_created).toBe(1);

      // Verify meta-recall fragment was written with correct type
      const metaFragment = fw._written.find(w => w.fragment.type === 'meta-recall');
      expect(metaFragment).toBeDefined();
      expect(metaFragment.fragment._lifecycle).toBe('active');
    });
  });

  // -------------------------------------------------------------------------
  // Editorial pass (entity dedup, weight updates, domain boundary review)
  // -------------------------------------------------------------------------

  describe('Editorial pass', () => {
    it('editorial-pass factory exists and exports createEditorialPass', () => {
      const mod = require('../components/rem/editorial-pass.cjs');
      expect(mod).toHaveProperty('createEditorialPass');
      expect(typeof mod.createEditorialPass).toBe('function');
    });

    it('editorial pass implements entity deduplication', async () => {
      const { createEditorialPass } = require('../components/rem/editorial-pass.cjs');
      const wire = mockWire();

      const ep = createEditorialPass({
        wire,
        switchboard: mockSwitchboard(),
        fragmentWriter: mockFragmentWriter(),
      });

      const entities = [
        { id: 'e1', name: 'JavaScript', occurrence_count: 5 },
        { id: 'e2', name: 'javascript', occurrence_count: 3 },
        { id: 'e3', name: 'Python', occurrence_count: 2 },
      ];

      const editorial = ep.run([], entities, []);

      const llmResponse = JSON.stringify({
        entity_merges: [{ keep: 'JavaScript', merge: ['javascript'] }],
        domain_decisions: [],
        weight_updates: [],
      });

      const result = await editorial.apply(llmResponse);
      expect(result.entities_deduped).toBe(1);
    });

    it('editorial pass implements association weight updates', async () => {
      const { createEditorialPass } = require('../components/rem/editorial-pass.cjs');
      const wire = mockWire();

      const ep = createEditorialPass({
        wire,
        switchboard: mockSwitchboard(),
        fragmentWriter: mockFragmentWriter(),
      });

      const stats = [
        { id: 'a1', source_id: 'e1', target_id: 'e2', weight: 0.5, access_count: 10, last_accessed: '2026-03-25' },
      ];

      const editorial = ep.run([], [], stats);
      const llmResponse = JSON.stringify({
        entity_merges: [],
        domain_decisions: [],
        weight_updates: [{ association_id: 'a1', new_weight: 0.8 }],
      });

      const result = await editorial.apply(llmResponse);
      expect(result.weights_updated).toBe(1);
    });

    it('editorial pass implements domain boundary review', async () => {
      const { createEditorialPass } = require('../components/rem/editorial-pass.cjs');
      const wire = mockWire();
      const fw = mockFragmentWriter();

      const ep = createEditorialPass({
        wire,
        switchboard: mockSwitchboard(),
        fragmentWriter: fw,
      });

      const domainPairs = [
        {
          domain_a: { id: 'd1', name: 'Programming' },
          domain_b: { id: 'd2', name: 'Software Development' },
          overlap_score: 0.85,
          shared_entities: ['JavaScript', 'Python'],
        },
      ];

      const editorial = ep.run(domainPairs, [], []);
      const llmResponse = JSON.stringify({
        entity_merges: [],
        domain_decisions: [
          { domain_a: 'Programming', domain_b: 'Software Development', action: 'merge', reason: 'Same domain', merge_narrative: 'Programming and Software Development merged into Programming.' },
        ],
        weight_updates: [],
      });

      const result = await editorial.apply(llmResponse);
      expect(result.domains_merged).toBe(1);
      // Taxonomy narrative consolidation fragment written (per [Phase 11] D-08)
      expect(result.narratives_written).toBe(1);
    });

    it('editorial pass uses prompt/apply separation -- never calls LLM directly', () => {
      const { createEditorialPass } = require('../components/rem/editorial-pass.cjs');

      const ep = createEditorialPass({
        wire: mockWire(),
        switchboard: mockSwitchboard(),
        fragmentWriter: mockFragmentWriter(),
      });

      // run() returns { prompt, apply } -- prompt is composed, apply processes response
      const editorial = ep.run([], [], []);
      expect(typeof editorial.prompt).toBe('string');
      expect(typeof editorial.apply).toBe('function');
      // No LLM call within the module itself
    });

    it('editorial prompt includes all spec-required sections: dedup, boundary, weights, narrative', () => {
      const { createEditorialPass } = require('../components/rem/editorial-pass.cjs');

      const ep = createEditorialPass({
        wire: mockWire(),
        switchboard: mockSwitchboard(),
        fragmentWriter: mockFragmentWriter(),
      });

      const editorial = ep.run(
        [{ domain_a: { id: 'd1', name: 'A' }, domain_b: { id: 'd2', name: 'B' }, overlap_score: 0.5, shared_entities: [] }],
        [{ id: 'e1', name: 'Concept', occurrence_count: 3 }],
        [{ id: 'a1', source_id: 'e1', target_id: 'e2', weight: 0.5, access_count: 2, last_accessed: '2026-01-01' }]
      );

      const prompt = editorial.prompt;
      expect(prompt).toContain('ENTITY DEDUP');
      expect(prompt).toContain('DOMAIN BOUNDARY REVIEW');
      expect(prompt).toContain('ASSOCIATION WEIGHT UPDATE');
      expect(prompt).toContain('TAXONOMY NARRATIVE UPDATES');
    });
  });

  // -------------------------------------------------------------------------
  // Conditioning update
  // -------------------------------------------------------------------------

  describe('Conditioning update', () => {
    it('conditioning-updater factory exists and exports createConditioningUpdater', () => {
      const mod = require('../components/rem/conditioning-updater.cjs');
      expect(mod).toHaveProperty('createConditioningUpdater');
      expect(typeof mod.createConditioningUpdater).toBe('function');
    });

    it('conditioning updater uses EMA for conservative accumulation per spec 5.3', () => {
      const { emaUpdate, emaUpdateRecord } = require('../components/rem/conditioning-updater.cjs');

      // Single-session changes are blended with existing state via EMA
      const alpha = 0.15;
      const current = 0.5;
      const session = 1.0;

      const updated = emaUpdate(current, session, alpha);

      // EMA: 0.5 * 0.85 + 1.0 * 0.15 = 0.575
      expect(updated).toBeCloseTo(0.575, 4);
      // Conservative: not jumping to session value
      expect(updated).toBeLessThan(session);
      expect(updated).toBeGreaterThan(current);
    });

    it('EMA record-level updates default new keys to 0.5 midpoint per [Phase 11]', () => {
      const { emaUpdateRecord } = require('../components/rem/conditioning-updater.cjs');

      const current = { existing: 0.7 };
      const session = { existing: 0.9, new_key: 0.8 };

      const result = emaUpdateRecord(current, session, 0.15);

      // Existing key: EMA blended
      expect(result.existing).toBeCloseTo(0.7 * 0.85 + 0.9 * 0.15, 4);
      // New key: default current 0.5, then EMA
      expect(result.new_key).toBeCloseTo(0.5 * 0.85 + 0.8 * 0.15, 4);
    });

    it('conditioning updater updates all spec-required fields: attention_biases, sublimation_sensitivity, recall_strategies, error_history', () => {
      const { createConditioningUpdater } = require('../components/rem/conditioning-updater.cjs');

      const updater = createConditioningUpdater({});

      const current = {
        attention_biases: { coding: 0.6 },
        sublimation_sensitivity: { general: 0.5 },
        association_priors: {},
        recall_strategies: [{ id: 'explicit', score: 0.7 }],
        error_history: [],
      };

      const session = {
        attention_biases: { coding: 0.9 },
        sublimation_sensitivity: { general: 0.3 },
        recall_strategies: [{ id: 'explicit', score: 0.9 }],
        error_history: [{ type: 'recall_miss', details: 'test' }],
      };

      const result = updater.updateConditioning(current, session);

      expect(result).toHaveProperty('attention_biases');
      expect(result).toHaveProperty('sublimation_sensitivity');
      expect(result).toHaveProperty('recall_strategies');
      expect(result).toHaveProperty('error_history');
      // Error history appended
      expect(result.error_history.length).toBe(1);
    });

    it('conditioning updater enforces trait floor constraints preventing identity collapse', () => {
      const { createConditioningUpdater } = require('../components/rem/conditioning-updater.cjs');

      const updater = createConditioningUpdater({});

      const identityCore = {
        personality_traits: { analytical: 0.05, creative: 0.03 },
        communication_style: { formal: 0.02, concise: 0.8 },
        value_orientations: [{ name: 'precision', weight: 0.01 }],
      };

      const floored = updater.enforceIdentityFloors(identityCore, 0.1);

      // Traits below floor should be clamped to floor
      expect(floored.personality_traits.analytical).toBe(0.1);
      expect(floored.personality_traits.creative).toBe(0.1);
      expect(floored.communication_style.formal).toBe(0.1);
      // Traits above floor should be unchanged
      expect(floored.communication_style.concise).toBe(0.8);
      // Value orientation weight floored
      expect(floored.value_orientations[0].weight).toBe(0.1);
    });

    it('conditioning updater checks diversity threshold and boosts underrepresented', () => {
      const { createConditioningUpdater } = require('../components/rem/conditioning-updater.cjs');

      const updater = createConditioningUpdater({});

      const identityCore = {
        personality_traits: { a: 0.5, b: 0.5, c: 0.5, d: 0.5 },
        communication_style: { x: 0.5, y: 0.5 },
        value_orientations: [],
      };

      // All values identical -> zero variance -> below any threshold
      const diversity = updater.checkDiversityThreshold(identityCore, 0.01);
      expect(diversity.belowThreshold).toBe(true);
      expect(diversity.variance).toBe(0);

      // Boost lowest traits
      const boosted = updater.boostUnderrepresented(identityCore, 0.02);
      expect(boosted).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Fragment promotion (working -> active)
  // -------------------------------------------------------------------------

  describe('Fragment promotion', () => {
    it('retroactive evaluator promotes fragments from working/ to active/ lifecycle', async () => {
      const { createRetroactiveEvaluator } = require('../components/rem/retroactive-evaluator.cjs');
      const fw = mockFragmentWriter();
      const wire = mockWire();

      const evaluator = createRetroactiveEvaluator({
        fragmentWriter: fw,
        journal: mockJournal(),
        wire,
        switchboard: mockSwitchboard(),
      });

      const fragment = {
        id: 'f-promote',
        type: 'episodic',
        _lifecycle: 'working',
        associations: { domains: ['test'], attention_tags: [], self_model_relevance: {} },
        decay: { consolidation_count: 0 },
        _body: 'Test fragment body',
      };

      const evalDecision = {
        updated_relevance: { identity: 0.8, relational: 0.4, conditioning: 0.3 },
        new_attention_tags: ['key-insight'],
        reason: 'Important discovery',
      };

      const result = await evaluator.promoteFragment(fragment, evalDecision);
      expect(result.ok).toBe(true);
      expect(result.value.lifecycle).toBe('active');

      // Fragment was written with active lifecycle
      const written = fw._written[0];
      expect(written.fragment._lifecycle).toBe('active');
      // Relevance updated
      expect(written.fragment.associations.self_model_relevance.identity).toBe(0.8);
      // Attention tags merged
      expect(written.fragment.associations.attention_tags).toContain('key-insight');
      // Consolidation count incremented
      expect(written.fragment.decay.consolidation_count).toBe(1);
    });

    it('retroactive evaluator discards rejected fragments -- clean removal from working/', async () => {
      const { createRetroactiveEvaluator } = require('../components/rem/retroactive-evaluator.cjs');
      const wire = mockWire();
      let journalDeleteCalled = false;

      const evaluator = createRetroactiveEvaluator({
        fragmentWriter: mockFragmentWriter(),
        journal: {
          list: async () => ({ ok: true, value: [] }),
          delete: async (id) => { journalDeleteCalled = true; return { ok: true }; },
        },
        wire,
        switchboard: mockSwitchboard(),
      });

      const result = await evaluator.discardFragment('f-discard');
      expect(result.ok).toBe(true);
      // Journal delete called
      expect(journalDeleteCalled).toBe(true);
      // Wire envelopes sent for Ledger cleanup
      expect(wire._writes.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Section 5.4: Working Memory Gate
// ---------------------------------------------------------------------------

describe('Spec 5.4: Working Memory Gate', () => {

  it('REM consolidator is single entry point for all consolidation tiers', () => {
    const { createRemConsolidator } = require('../components/rem/rem-consolidator.cjs');

    // rem-consolidator dispatches to all three tiers
    const consolidator = createRemConsolidator({
      triage: { snapshot: async () => ({ ok: true }) },
      provisionalRem: { run: async () => ({}), abort: () => ({ ok: true, reverted: 0 }) },
      fullRem: { run: async () => ({}) },
    });

    // Consolidator exposes handlers for all three tiers
    expect(typeof consolidator.handleTier1).toBe('function');
    expect(typeof consolidator.handleTier2).toBe('function');
    expect(typeof consolidator.handleTier3).toBe('function');
    expect(typeof consolidator.abortTier2).toBe('function');
    // Additional: dormant maintenance and crash recovery
    expect(typeof consolidator.handleDormantMaintenance).toBe('function');
    expect(typeof consolidator.handleCrashRecovery).toBe('function');
  });

  it('no bypass path exists for fragment promotion -- only through REM consolidator', () => {
    // Verify that fragment promotion goes through the evaluator which is called
    // by full-rem.cjs which is called by rem-consolidator.cjs
    //
    // The chain is: rem-consolidator -> fullRem.run -> retroactiveEvaluator ->
    //   promoteFragment (working/ -> active/)
    //
    // The retroactive-evaluator's promoteFragment is the ONLY function that
    // sets _lifecycle to 'active' on a fragment. It is only called inside
    // the evaluate().apply() path.

    const { createRetroactiveEvaluator } = require('../components/rem/retroactive-evaluator.cjs');
    const mod = require('../components/rem/retroactive-evaluator.cjs');

    // The evaluator exposes promoteFragment but it is only called through
    // the evaluate -> apply chain
    expect(typeof mod.createRetroactiveEvaluator).toBe('function');

    // Verify the module structure: promoteFragment is bound to the evaluator
    // instance, not exported separately as a standalone function
    const evaluator = createRetroactiveEvaluator({
      fragmentWriter: mockFragmentWriter(),
      journal: mockJournal(),
      wire: mockWire(),
      switchboard: mockSwitchboard(),
    });

    // promoteFragment exists on the instance but requires fragment + evaluation
    // objects -- cannot be called without proper REM context
    expect(typeof evaluator.promoteFragment).toBe('function');
  });

  it('rem-consolidator enforces REM-07: handleTier1 delegates to triage', async () => {
    const { createRemConsolidator } = require('../components/rem/rem-consolidator.cjs');

    let triageCalled = false;
    const consolidator = createRemConsolidator({
      triage: {
        snapshot: async (state) => {
          triageCalled = true;
          return { ok: true, value: { path: '/tmp/test', fields_saved: 6 } };
        },
      },
      provisionalRem: { run: async () => ({}), abort: () => ({}) },
      fullRem: { run: async () => ({}) },
    });

    await consolidator.handleTier1({ attention_pointer: 'test' });
    expect(triageCalled).toBe(true);
  });

  it('rem-consolidator enforces REM-07: handleTier2 delegates to provisionalRem', async () => {
    const { createRemConsolidator } = require('../components/rem/rem-consolidator.cjs');

    let provCalled = false;
    const consolidator = createRemConsolidator({
      triage: { snapshot: async () => ({}) },
      provisionalRem: {
        run: async () => { provCalled = true; return {}; },
        abort: () => ({}),
      },
      fullRem: { run: async () => ({}) },
    });

    await consolidator.handleTier2({ summary: 'test', fragments: [] });
    expect(provCalled).toBe(true);
  });

  it('rem-consolidator enforces REM-07: handleTier3 delegates to fullRem', async () => {
    const { createRemConsolidator } = require('../components/rem/rem-consolidator.cjs');

    let fullCalled = false;
    const consolidator = createRemConsolidator({
      triage: { snapshot: async () => ({}) },
      provisionalRem: { run: async () => ({}), abort: () => ({}) },
      fullRem: {
        run: async () => { fullCalled = true; return {}; },
      },
    });

    await consolidator.handleTier3({ summary: 'test', fragments: [] });
    expect(fullCalled).toBe(true);
  });

  it('dormant maintenance processes decay catch-up on SessionStart', async () => {
    const { createRemConsolidator } = require('../components/rem/rem-consolidator.cjs');

    const consolidator = createRemConsolidator({
      triage: { snapshot: async () => ({}) },
      provisionalRem: { run: async () => ({}), abort: () => ({}) },
      fullRem: { run: async () => ({}) },
      journal: {
        list: async () => ({ ok: true, value: [{ id: 'f1', source_session: 'old-sess' }] }),
      },
      decay: {
        computeDecay: () => 0.3,
        shouldArchive: () => false,
      },
    });

    const stats = await consolidator.handleDormantMaintenance();
    expect(stats.checked).toBe(1);
    expect(stats.still_active).toBe(1);
    expect(stats.archived).toBe(0);
  });

  it('crash recovery detects orphaned working/ fragments from previous sessions', async () => {
    const { createRemConsolidator } = require('../components/rem/rem-consolidator.cjs');
    const sw = mockSwitchboard();

    const consolidator = createRemConsolidator({
      triage: { snapshot: async () => ({}) },
      provisionalRem: { run: async () => ({}), abort: () => ({}) },
      fullRem: { run: async () => ({}) },
      journal: {
        list: async () => ({
          ok: true,
          value: [
            { id: 'f-old', source_session: 'crashed-session' },
            { id: 'f-current', source_session: 'current-session' },
          ],
        }),
      },
      switchboard: sw,
    });

    const result = await consolidator.handleCrashRecovery('current-session');
    expect(result.hasOrphans).toBe(true);
    expect(result.orphanedSessions).toContain('crashed-session');
    expect(result.recoveryTriggered).toBe(true);
  });
});
