'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');
const { createMindCycle } = require('../mind-cycle.cjs');

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockSelfModel() {
  const aspects = {};
  return {
    getAspect(name) { return aspects[name] || null; },
    setAspect(name, data) { aspects[name] = data; },
    _aspects: aspects,
  };
}

function createMockFormationPipeline(opts = {}) {
  const calls = [];
  return {
    prepareStimulus(hookPayload, sessionContext) {
      calls.push({ method: 'prepareStimulus', hookPayload, sessionContext });
      if (opts.belowThreshold) {
        return {
          turn_context: { user_prompt: '', tools_used: [], session_position: 0, turn_number: 0 },
          self_model: {},
          recalled_fragments: [],
          user_name: 'the user',
          session_id: 'unknown',
        };
      }
      return {
        turn_context: {
          user_prompt: hookPayload.user_prompt || '',
          tools_used: [],
          session_position: 0,
          turn_number: 0,
        },
        self_model: { identity_summary: 'test identity' },
        recalled_fragments: [],
        user_name: 'the user',
        session_id: 'test-session',
      };
    },
    _calls: calls,
  };
}

function createMockRecallEngine() {
  const calls = [];
  return {
    async recallPassive(context) {
      calls.push({ method: 'recallPassive', context });
      return { ok: true, value: { fragments: [], nudgePrompt: null, nudgeText: null } };
    },
    async recallExplicit(query) {
      calls.push({ method: 'recallExplicit', query });
      return { ok: true, value: { fragments: [{ id: 'recalled-1' }], reconstructionPrompt: 'test reconstruction' } };
    },
    _calls: calls,
  };
}

function createMockTemplateComposer() {
  return {
    compose(budgetPhase) {
      return `## Identity Frame\nTest identity\n## Referential Framing\nTest framing for phase ${budgetPhase}`;
    },
  };
}

function createMockReferentialFraming() {
  return {
    getPrompt() {
      return '<referential_frame>\nTest referential framing prompt\n</referential_frame>';
    },
    getMode() { return 'dual'; },
  };
}

function createMockSublimationLoop() {
  return {
    getCycleConfig() {
      return Object.freeze({
        cycle_ms: 15000,
        max_candidates_per_cycle: 5,
        sensitivity_threshold: 0.3,
        batch_messages: true,
      });
    },
  };
}

function createMockSwitchboard() {
  const events = [];
  return {
    emit(event, data) { events.push({ event, data }); },
    _events: events,
  };
}

function createMockWire() {
  const sends = [];
  return {
    async send(envelope) { sends.push(envelope); return { ok: true, value: undefined }; },
    _sends: sends,
  };
}

function createMockLithograph() {
  return {
    readTranscript() { return { ok: true, value: [] }; },
    queryTurns(filter) { return { ok: true, value: [] }; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mind-cycle', () => {
  let selfModel;
  let formationPipeline;
  let recallEngine;
  let templateComposer;
  let referentialFraming;
  let sublimationLoop;
  let switchboard;
  let wire;
  let lithograph;
  let config;

  beforeEach(() => {
    selfModel = createMockSelfModel();
    formationPipeline = createMockFormationPipeline();
    recallEngine = createMockRecallEngine();
    templateComposer = createMockTemplateComposer();
    referentialFraming = createMockReferentialFraming();
    sublimationLoop = createMockSublimationLoop();
    switchboard = createMockSwitchboard();
    wire = createMockWire();
    lithograph = createMockLithograph();
    config = { max_sublimation_intake: 5 };
  });

  function createDefault(overrides = {}) {
    return createMindCycle({
      selfModel,
      formationPipeline,
      recallEngine,
      templateComposer,
      referentialFraming,
      sublimationLoop,
      switchboard,
      wire,
      lithograph,
      config,
      ...overrides,
    });
  }

  describe('factory', () => {
    it('returns instance with processTurn, processSublimation, composeFacePrompt, getState methods', () => {
      const mind = createDefault();
      expect(typeof mind.processTurn).toBe('function');
      expect(typeof mind.processSublimation).toBe('function');
      expect(typeof mind.composeFacePrompt).toBe('function');
      expect(typeof mind.getState).toBe('function');
    });

    it('returns instance with drainSublimations method', () => {
      const mind = createDefault();
      expect(typeof mind.drainSublimations).toBe('function');
    });
  });

  describe('processTurn', () => {
    it('runs attention check and determines formation-worthy stimulus', async () => {
      const mind = createDefault();
      const result = await mind.processTurn({
        userPrompt: 'Tell me about your approach to problem solving and how you think about complexity',
        toolUse: null,
        turnNumber: 1,
      });
      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(true);
      expect(result.value.stimulus).toBeDefined();
      expect(result.value.fragments_initiated).toBe(1);
    });

    it('returns formed: false for non-attention-worthy stimulus', async () => {
      const belowPipeline = createMockFormationPipeline({ belowThreshold: true });
      const mind = createDefault({ formationPipeline: belowPipeline });
      const result = await mind.processTurn({
        userPrompt: '',
        toolUse: null,
        turnNumber: 1,
      });
      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(false);
      expect(result.value.reason).toBe('below_threshold');
    });

    it('triggers passive recall and includes recall result in response', async () => {
      const mind = createDefault();
      const result = await mind.processTurn({
        userPrompt: 'A meaningful conversation about architecture and design patterns we should explore',
        toolUse: null,
        turnNumber: 5,
      });
      expect(result.ok).toBe(true);
      expect(recallEngine._calls.some(c => c.method === 'recallPassive')).toBe(true);
      expect(result.value.directives).toBeDefined();
      expect(result.value.directives.recall).toBeDefined();
    });

    it('generates directives for Primary (face prompt update, behavioral directives)', async () => {
      const mind = createDefault();
      const result = await mind.processTurn({
        userPrompt: 'Something interesting about development workflows and our collaborative process',
        toolUse: null,
        turnNumber: 2,
      });
      expect(result.ok).toBe(true);
      expect(result.value.directives).toBeDefined();
      expect(typeof result.value.directives.facePromptUpdate).toBe('string');
      expect(result.value.directives.behavioral).toBeNull();
    });

    it('increments turns_processed counter', async () => {
      const mind = createDefault();
      expect(mind.getState().turns_processed).toBe(0);

      await mind.processTurn({ userPrompt: 'A reasonably long test prompt to pass the attention gate check here', turnNumber: 1 });
      expect(mind.getState().turns_processed).toBe(1);

      await mind.processTurn({ userPrompt: 'Another reasonably long test prompt to increment the counter again here', turnNumber: 2 });
      expect(mind.getState().turns_processed).toBe(2);
    });

    it('triggers recallExplicit when user prompt contains recall keywords', async () => {
      const mind = createDefault();
      await mind.processTurn({
        userPrompt: 'Do you remember what we discussed last time about the architecture decisions?',
        toolUse: null,
        turnNumber: 3,
      });
      expect(recallEngine._calls.some(c => c.method === 'recallExplicit')).toBe(true);
    });

    it('does not trigger recallExplicit for prompts without recall keywords', async () => {
      const mind = createDefault();
      await mind.processTurn({
        userPrompt: 'Please help me refactor this function to use proper error handling patterns',
        toolUse: null,
        turnNumber: 3,
      });
      expect(recallEngine._calls.some(c => c.method === 'recallExplicit')).toBe(false);
    });
  });

  describe('processSublimation', () => {
    it('evaluates sublimation candidates from Tertiary', async () => {
      const mind = createDefault();
      const result = await mind.processSublimation({
        candidates: [
          { id: 'frag-1', score: 0.8 },
          { id: 'frag-2', score: 0.5 },
          { id: 'frag-3', score: 0.1 },
        ],
        resonanceScores: [0.8, 0.5, 0.1],
      });
      expect(result.ok).toBe(true);
      expect(result.value.evaluated).toBe(3);
    });

    it('filters candidates below sensitivity threshold', async () => {
      const mind = createDefault();
      const result = await mind.processSublimation({
        candidates: [
          { id: 'frag-1', score: 0.8 },
          { id: 'frag-2', score: 0.5 },
          { id: 'frag-3', score: 0.1 },
        ],
        resonanceScores: [0.8, 0.5, 0.1],
      });
      expect(result.ok).toBe(true);
      // threshold is 0.3, so frag-3 (0.1) is filtered out
      expect(result.value.worthy).toBe(2);
    });

    it('queues worthy candidates for formation evaluation', async () => {
      const mind = createDefault();
      await mind.processSublimation({
        candidates: [
          { id: 'frag-1', score: 0.8 },
          { id: 'frag-2', score: 0.5 },
        ],
        resonanceScores: [0.8, 0.5],
      });
      expect(mind.getState().pending_sublimations).toBe(2);
    });

    it('caps intake at config.max_sublimation_intake per D-08/Pitfall 4', async () => {
      const mind = createDefault({ config: { max_sublimation_intake: 2 } });
      const result = await mind.processSublimation({
        candidates: [
          { id: 'frag-1', score: 0.8 },
          { id: 'frag-2', score: 0.7 },
          { id: 'frag-3', score: 0.6 },
          { id: 'frag-4', score: 0.5 },
        ],
        resonanceScores: [0.8, 0.7, 0.6, 0.5],
      });
      expect(result.ok).toBe(true);
      expect(result.value.worthy).toBeLessThanOrEqual(2);
      expect(mind.getState().pending_sublimations).toBeLessThanOrEqual(2);
    });
  });

  describe('composeFacePrompt', () => {
    it('delegates to template-composer with current Self Model state and referential framing', () => {
      const mind = createDefault();
      const prompt = mind.composeFacePrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      // Should contain the template composer output
      expect(prompt).toContain('Identity Frame');
    });

    it('returns string containing referential_frame section', () => {
      const mind = createDefault();
      const prompt = mind.composeFacePrompt();
      expect(prompt).toContain('referential_frame');
    });

    it('returns minimal face prompt when templateComposer not available', () => {
      const mind = createDefault({ templateComposer: null });
      const prompt = mind.composeFacePrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('getState', () => {
    it('returns correct initial state', () => {
      const mind = createDefault();
      const state = mind.getState();
      expect(state.turns_processed).toBe(0);
      expect(state.formations_initiated).toBe(0);
      expect(state.sublimations_evaluated).toBe(0);
      expect(state.last_turn_at).toBeNull();
      expect(state.pending_sublimations).toBe(0);
    });

    it('reflects updated state after processing turns', async () => {
      const mind = createDefault();
      await mind.processTurn({
        userPrompt: 'A long enough test prompt to pass the attention gate threshold check value',
        turnNumber: 1,
      });
      const state = mind.getState();
      expect(state.turns_processed).toBe(1);
      expect(state.formations_initiated).toBe(1);
      expect(state.last_turn_at).not.toBeNull();
    });
  });

  describe('drainSublimations', () => {
    it('returns and clears pending sublimations', async () => {
      const mind = createDefault();
      await mind.processSublimation({
        candidates: [{ id: 'frag-1', score: 0.8 }],
        resonanceScores: [0.8],
      });
      expect(mind.getState().pending_sublimations).toBe(1);

      const drained = mind.drainSublimations();
      expect(Array.isArray(drained)).toBe(true);
      expect(drained.length).toBe(1);
      expect(mind.getState().pending_sublimations).toBe(0);
    });
  });
});
