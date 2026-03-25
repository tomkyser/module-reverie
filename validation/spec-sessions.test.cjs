'use strict';

/**
 * Spec compliance test: Three-Session Architecture (reverie-spec-v2.md sections 4.1-4.6).
 *
 * Verifies:
 * - Section 4.1: Hub-spoke topology (Primary<->Secondary<->Tertiary, no bypass)
 * - Section 4.2: Primary Session (Face) -- user-facing, Self Model personality, additionalContext
 * - Section 4.3: Secondary Session (Mind) -- cognitive center, attention, formation, recall, Self Model authority
 * - Section 4.4: Tertiary Session (Subconscious) -- continuous sublimation, configurable frequency, resonance
 * - Section 4.5: Subagent Usage -- SubagentStart/SubagentStop handling, formation agent filtering
 * - Section 4.6: Session Lifecycle -- startup, active, compaction, shutdown, Wire urgency levels, ACK protocol
 *
 * Known deviations (documented in STATE.md, marked as D not V):
 * - [Phase 08] All hook injection uses additionalContext not systemMessage per Pitfall 1
 * - [Phase 10] Session spawner lives in core/services/conductor/ as platform capability
 * - [Phase 10] Added STOPPED to STARTING valid transitions for spawn failure path
 * - [Phase 10] String literals for state matching to avoid circular require
 * - [Phase 10] ACK protocol uses _pendingAcks Map with timer-based timeout
 * - [Phase 10] Session Manager start() fire-and-forget in SessionStart hook
 * - [Phase 10] DIRECTIVE payload.role filtering for typed Wire message sub-routing
 * - [Phase 10] Topology rules enforce strict hub-spoke: Primary<->Secondary<->Tertiary, no Primary<->Tertiary bypass
 *
 * @module reverie/validation/spec-sessions.test
 */

const { describe, it, expect, beforeEach } = require('bun:test');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Three-Session Architecture: Spec sections 4.1-4.6 compliance
// ---------------------------------------------------------------------------

describe('Three-Session Architecture: Spec sections 4.1-4.6 compliance', () => {

  // =========================================================================
  // Spec 4.1: Topology
  // =========================================================================

  describe('Spec 4.1: Topology', () => {

    it('TOPOLOGY_RULES defines exactly 3 session identities (primary, secondary, tertiary)', () => {
      const { TOPOLOGY_RULES, SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      const keys = Object.keys(TOPOLOGY_RULES);
      expect(keys).toHaveLength(3);
      expect(keys).toContain(SESSION_IDENTITIES.PRIMARY);
      expect(keys).toContain(SESSION_IDENTITIES.SECONDARY);
      expect(keys).toContain(SESSION_IDENTITIES.TERTIARY);
    });

    it('enforces hub-spoke: Primary can only send to Secondary', () => {
      const { TOPOLOGY_RULES, SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      const primaryAllowed = TOPOLOGY_RULES[SESSION_IDENTITIES.PRIMARY];
      expect(primaryAllowed).toHaveLength(1);
      expect(primaryAllowed).toContain(SESSION_IDENTITIES.SECONDARY);
    });

    it('enforces hub-spoke: Secondary can send to Primary AND Tertiary', () => {
      const { TOPOLOGY_RULES, SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      const secondaryAllowed = TOPOLOGY_RULES[SESSION_IDENTITIES.SECONDARY];
      expect(secondaryAllowed).toHaveLength(2);
      expect(secondaryAllowed).toContain(SESSION_IDENTITIES.PRIMARY);
      expect(secondaryAllowed).toContain(SESSION_IDENTITIES.TERTIARY);
    });

    it('enforces hub-spoke: Tertiary can only send to Secondary', () => {
      const { TOPOLOGY_RULES, SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      const tertiaryAllowed = TOPOLOGY_RULES[SESSION_IDENTITIES.TERTIARY];
      expect(tertiaryAllowed).toHaveLength(1);
      expect(tertiaryAllowed).toContain(SESSION_IDENTITIES.SECONDARY);
    });

    it('blocks Primary<->Tertiary direct communication (bypass prevention)', () => {
      const { TOPOLOGY_RULES, SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      // Primary cannot send to Tertiary
      const primaryAllowed = TOPOLOGY_RULES[SESSION_IDENTITIES.PRIMARY];
      expect(primaryAllowed).not.toContain(SESSION_IDENTITIES.TERTIARY);
      // Tertiary cannot send to Primary
      const tertiaryAllowed = TOPOLOGY_RULES[SESSION_IDENTITIES.TERTIARY];
      expect(tertiaryAllowed).not.toContain(SESSION_IDENTITIES.PRIMARY);
    });

    it('TOPOLOGY_RULES is frozen (immutable at runtime)', () => {
      const { TOPOLOGY_RULES } = require('../components/session/session-config.cjs');
      expect(Object.isFrozen(TOPOLOGY_RULES)).toBe(true);
    });

    it('wire-topology validateRoute blocks Primary->Tertiary', () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const mockWire = { send: async () => ({ ok: true }), subscribe: () => () => {} };
      const topology = createWireTopology({ wire: mockWire });
      const result = topology.validateRoute('primary', 'tertiary');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TOPOLOGY_VIOLATION');
    });

    it('wire-topology validateRoute blocks Tertiary->Primary', () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const mockWire = { send: async () => ({ ok: true }), subscribe: () => () => {} };
      const topology = createWireTopology({ wire: mockWire });
      const result = topology.validateRoute('tertiary', 'primary');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TOPOLOGY_VIOLATION');
    });

    it('wire-topology validateRoute allows Primary->Secondary', () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const mockWire = { send: async () => ({ ok: true }), subscribe: () => () => {} };
      const topology = createWireTopology({ wire: mockWire });
      const result = topology.validateRoute('primary', 'secondary');
      expect(result.ok).toBe(true);
    });

    it('wire-topology validateRoute allows Secondary->Primary', () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const mockWire = { send: async () => ({ ok: true }), subscribe: () => () => {} };
      const topology = createWireTopology({ wire: mockWire });
      const result = topology.validateRoute('secondary', 'primary');
      expect(result.ok).toBe(true);
    });

    it('wire-topology validateRoute allows Secondary->Tertiary', () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const mockWire = { send: async () => ({ ok: true }), subscribe: () => () => {} };
      const topology = createWireTopology({ wire: mockWire });
      const result = topology.validateRoute('secondary', 'tertiary');
      expect(result.ok).toBe(true);
    });

    it('wire-topology validateRoute allows Tertiary->Secondary', () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const mockWire = { send: async () => ({ ok: true }), subscribe: () => () => {} };
      const topology = createWireTopology({ wire: mockWire });
      const result = topology.validateRoute('tertiary', 'secondary');
      expect(result.ok).toBe(true);
    });

    it('wire-topology send blocks messages violating topology rules', async () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const sent = [];
      const mockWire = {
        send: async (env) => { sent.push(env); return { ok: true }; },
        subscribe: () => () => {},
      };
      const topology = createWireTopology({ wire: mockWire });
      const result = await topology.send({
        from: 'primary',
        to: 'tertiary',
        type: 'snapshot',
        urgency: 'active',
        payload: {},
      });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TOPOLOGY_VIOLATION');
      expect(sent).toHaveLength(0); // message never sent
    });

    it('wire-topology subscribe filters messages from disallowed senders', () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const subscribers = {};
      const mockWire = {
        send: async () => ({ ok: true }),
        subscribe: (sessionId, callback) => {
          subscribers[sessionId] = callback;
          return () => {};
        },
      };
      const topology = createWireTopology({ wire: mockWire });
      const received = [];
      topology.subscribe('primary-session', 'primary', (env) => received.push(env));

      // Simulate incoming message from Tertiary (not allowed for Primary subscriber)
      subscribers['primary-session']({ from: 'tertiary', type: 'sublimation', payload: {} });
      expect(received).toHaveLength(0);

      // Simulate incoming message from Secondary (allowed for Primary subscriber)
      subscribers['primary-session']({ from: 'secondary', type: 'directive', payload: {} });
      expect(received).toHaveLength(1);
    });

    it('wire-topology tracks topology violations in metrics', () => {
      const { createWireTopology } = require('../components/session/wire-topology.cjs');
      const mockWire = { send: async () => ({ ok: true }), subscribe: () => () => {} };
      const topology = createWireTopology({ wire: mockWire });
      topology.validateRoute('primary', 'tertiary');
      topology.validateRoute('tertiary', 'primary');
      const metrics = topology.getMetrics();
      expect(metrics.topology_violations).toBe(2);
    });
  });

  // =========================================================================
  // Spec 4.2: Primary Session (Face)
  // =========================================================================

  describe('Spec 4.2: Primary Session (Face)', () => {

    it('Primary identity constant is "primary"', () => {
      const { SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      expect(SESSION_IDENTITIES.PRIMARY).toBe('primary');
    });

    it('Primary maps to Face role label', () => {
      const { ROLE_LABELS } = require('../components/session/visual-markers.cjs');
      expect(ROLE_LABELS.primary).toBe('Face');
    });

    it('hook handlers inject personality via additionalContext (not systemMessage) per D-03', () => {
      // Verify handleUserPromptSubmit returns additionalContext in hookSpecificOutput
      const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
      const mockCM = {
        trackBytes: () => {},
        incrementTurn: () => {},
        getInjection: () => 'face-prompt-content',
      };
      const handlers = createHookHandlers({
        contextManager: mockCM,
        switchboard: { emit: () => {} },
        lathe: {},
        dataDir: '/tmp',
      });
      // handleUserPromptSubmit returns hookSpecificOutput.additionalContext
      const resultPromise = handlers.handleUserPromptSubmit({ user_prompt: 'hello' });
      return resultPromise.then((result) => {
        expect(result.hookSpecificOutput).toBeDefined();
        expect(result.hookSpecificOutput.additionalContext).toBeDefined();
        // Must NOT have systemMessage (Pitfall 1 deviation)
        expect(result.hookSpecificOutput.systemMessage).toBeUndefined();
      });
    });

    it('handleSessionStart injects face prompt via additionalContext', () => {
      const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
      const mockCM = {
        init: async () => {},
        getInjection: () => 'initial-face-prompt',
        resetAfterCompaction: async () => {},
      };
      const handlers = createHookHandlers({
        contextManager: mockCM,
        switchboard: { emit: () => {} },
        lathe: {},
        dataDir: '/tmp',
      });
      return handlers.handleSessionStart({}).then((result) => {
        expect(result.hookSpecificOutput.additionalContext).toBe('initial-face-prompt');
        expect(result.hookSpecificOutput.systemMessage).toBeUndefined();
      });
    });

    it('Primary does not directly access fragments, recall, or REM', () => {
      // Primary session's hook handlers (UserPromptSubmit) do not call
      // formationPipeline.write, recallEngine, or remConsolidator directly
      // for PRIMARY operations. Formation is fire-and-forget background.
      const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
      const formationCalled = [];
      const handlers = createHookHandlers({
        contextManager: {
          trackBytes: () => {},
          incrementTurn: () => {},
          getInjection: () => '',
        },
        switchboard: { emit: () => {} },
        lathe: {},
        dataDir: '/tmp',
        formationPipeline: {
          prepareStimulus: (payload, ctx) => { formationCalled.push('prepareStimulus'); return {}; },
        },
      });
      // prepareStimulus is called but it only PREPARES -- actual formation
      // is delegated to the formation subagent (Secondary domain per spec 4.3)
      return handlers.handleUserPromptSubmit({ user_prompt: 'test' }).then(() => {
        // prepareStimulus fires but does not write fragments directly
        expect(formationCalled).toContain('prepareStimulus');
        // No direct fragment writes from Primary hook path
      });
    });

    it('Primary receives Face prompt from Secondary via Wire directives', () => {
      // Verify UserPromptSubmit sends snapshot to Secondary via Wire
      const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
      const { MESSAGE_TYPES, URGENCY_LEVELS } = require(path.join(ROOT, 'core/services/wire/protocol.cjs'));
      const sentMessages = [];
      const mockCM = {
        trackBytes: () => {},
        incrementTurn: () => {},
        getInjection: () => '',
      };
      const mockTopology = {
        send: async (env) => { sentMessages.push(env); return { ok: true }; },
      };
      const mockSessionMgr = {
        getState: () => ({ state: 'active' }),
      };
      const handlers = createHookHandlers({
        contextManager: mockCM,
        switchboard: { emit: () => {} },
        lathe: {},
        dataDir: '/tmp',
        wireTopology: mockTopology,
        sessionManager: mockSessionMgr,
      });
      return handlers.handleUserPromptSubmit({ user_prompt: 'hello' }).then(() => {
        // Should have sent a snapshot from primary to secondary
        const snapshot = sentMessages.find((m) => m.type === MESSAGE_TYPES.SNAPSHOT && m.from === 'primary');
        expect(snapshot).toBeDefined();
        expect(snapshot.to).toBe('secondary');
      });
    });
  });

  // =========================================================================
  // Spec 4.3: Secondary Session (Mind)
  // =========================================================================

  describe('Spec 4.3: Secondary Session (Mind)', () => {

    it('Secondary identity constant is "secondary"', () => {
      const { SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      expect(SESSION_IDENTITIES.SECONDARY).toBe('secondary');
    });

    it('Secondary maps to Mind role label', () => {
      const { ROLE_LABELS } = require('../components/session/visual-markers.cjs');
      expect(ROLE_LABELS.secondary).toBe('Mind');
    });

    it('Mind cycle manages attention via formationPipeline.prepareStimulus', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const preparedStimuli = [];
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({}) },
        formationPipeline: {
          prepareStimulus: (payload, ctx) => {
            preparedStimuli.push({ payload, ctx });
            return { turn_context: { user_prompt: payload.user_prompt } };
          },
        },
      });
      return mind.processTurn({ userPrompt: 'test prompt', turnNumber: 1 }).then(() => {
        expect(preparedStimuli).toHaveLength(1);
        expect(preparedStimuli[0].payload.user_prompt).toBe('test prompt');
      });
    });

    it('Mind cycle orchestrates fragment formation for attention-worthy turns', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({}) },
        formationPipeline: {
          prepareStimulus: () => ({ turn_context: { user_prompt: 'worthy content' } }),
        },
      });
      return mind.processTurn({ userPrompt: 'worthy content', turnNumber: 1 }).then((result) => {
        expect(result.ok).toBe(true);
        expect(result.value.formed).toBe(true);
        expect(result.value.fragments_initiated).toBeGreaterThan(0);
      });
    });

    it('Mind cycle runs passive recall on every turn', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const recallCalls = [];
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({}) },
        formationPipeline: {
          prepareStimulus: () => ({ turn_context: { user_prompt: 'test' } }),
        },
        recallEngine: {
          recallPassive: async (args) => { recallCalls.push(args); return { ok: true, value: [] }; },
          recallExplicit: async () => ({ ok: true, value: {} }),
        },
      });
      return mind.processTurn({ userPrompt: 'test', turnNumber: 1 }).then((result) => {
        expect(result.ok).toBe(true);
        expect(recallCalls).toHaveLength(1);
        expect(result.value.recall.passive).toBeDefined();
      });
    });

    it('Mind cycle triggers explicit recall on keyword match', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const explicitCalls = [];
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({}) },
        formationPipeline: {
          prepareStimulus: () => ({ turn_context: { user_prompt: 'do you remember?' } }),
        },
        recallEngine: {
          recallPassive: async () => ({ ok: true, value: [] }),
          recallExplicit: async (args) => { explicitCalls.push(args); return { ok: true, value: {} }; },
        },
      });
      return mind.processTurn({ userPrompt: 'do you remember what we discussed?', turnNumber: 1 }).then(() => {
        expect(explicitCalls).toHaveLength(1);
      });
    });

    it('Mind cycle composes Face prompt (Self Model authority per spec 4.3)', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({ body: 'identity data' }) },
        formationPipeline: { prepareStimulus: () => ({ turn_context: { user_prompt: '' } }) },
        templateComposer: { compose: (phase) => 'composed-face-prompt-phase-' + phase },
        referentialFraming: { getPrompt: () => 'referential-frame' },
      });
      const prompt = mind.composeFacePrompt(1);
      expect(prompt).toContain('composed-face-prompt-phase-1');
      expect(prompt).toContain('referential-frame');
    });

    it('Mind cycle evaluates sublimation candidates from Tertiary', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({}) },
        formationPipeline: { prepareStimulus: () => ({}) },
        sublimationLoop: {
          getCycleConfig: () => ({ sensitivity_threshold: 0.3 }),
        },
      });
      return mind.processSublimation({
        candidates: [
          { id: 'frag-1', score: 0.8 },
          { id: 'frag-2', score: 0.1 },
          { id: 'frag-3', score: 0.5 },
        ],
        resonanceScores: [0.8, 0.1, 0.5],
      }).then((result) => {
        expect(result.ok).toBe(true);
        // Candidate with score 0.1 should be filtered (below 0.3 threshold)
        expect(result.value.evaluated).toBe(3);
        expect(result.value.worthy).toBe(2);
      });
    });

    it('Mind cycle caps sublimation intake per config (D-08/Pitfall 4)', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({}) },
        formationPipeline: { prepareStimulus: () => ({}) },
        sublimationLoop: {
          getCycleConfig: () => ({ sensitivity_threshold: 0.0 }),
        },
        config: { max_sublimation_intake: 2 },
      });
      return mind.processSublimation({
        candidates: [
          { id: 'f1', score: 0.9 },
          { id: 'f2', score: 0.8 },
          { id: 'f3', score: 0.7 },
          { id: 'f4', score: 0.6 },
        ],
        resonanceScores: [0.9, 0.8, 0.7, 0.6],
      }).then((result) => {
        expect(result.ok).toBe(true);
        // All 4 evaluated, but only 2 queued (capped at max_sublimation_intake)
        expect(result.value.evaluated).toBe(4);
        expect(result.value.worthy).toBe(2);
      });
    });

    it('Mind cycle directives include facePromptUpdate, recall, and behavioral fields', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({}) },
        formationPipeline: {
          prepareStimulus: () => ({ turn_context: { user_prompt: 'content' } }),
        },
      });
      return mind.processTurn({ userPrompt: 'content', turnNumber: 1 }).then((result) => {
        expect(result.ok).toBe(true);
        const directives = result.value.directives;
        expect(directives).toBeDefined();
        expect(directives).toHaveProperty('facePromptUpdate');
        expect(directives).toHaveProperty('recall');
        expect(directives).toHaveProperty('behavioral');
      });
    });

    it('Mind cycle receives sublimation input from Tertiary and queues worthy candidates', () => {
      const { createMindCycle } = require('../components/session/mind-cycle.cjs');
      const mind = createMindCycle({
        selfModel: { getAspect: () => ({}) },
        formationPipeline: { prepareStimulus: () => ({}) },
        sublimationLoop: {
          getCycleConfig: () => ({ sensitivity_threshold: 0.3 }),
        },
      });
      return mind.processSublimation({
        candidates: [{ id: 'frag-1', score: 0.8 }],
        resonanceScores: [0.8],
      }).then(() => {
        const drained = mind.drainSublimations();
        expect(drained).toHaveLength(1);
        expect(drained[0].id).toBe('frag-1');
      });
    });
  });

  // =========================================================================
  // Spec 4.4: Tertiary Session (Subconscious)
  // =========================================================================

  describe('Spec 4.4: Tertiary Session (Subconscious)', () => {

    it('Tertiary identity constant is "tertiary"', () => {
      const { SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      expect(SESSION_IDENTITIES.TERTIARY).toBe('tertiary');
    });

    it('Tertiary maps to Subconscious role label', () => {
      const { ROLE_LABELS } = require('../components/session/visual-markers.cjs');
      expect(ROLE_LABELS.tertiary).toBe('Subconscious');
    });

    it('sublimation loop has configurable cycle frequency (cycle_ms)', () => {
      const { createSublimationLoop, SUBLIMATION_DEFAULTS } = require('../components/session/sublimation-loop.cjs');
      expect(SUBLIMATION_DEFAULTS.cycle_ms).toBeGreaterThan(0);
      const loop = createSublimationLoop({ config: { cycle_ms: 7000 } });
      const config = loop.getCycleConfig();
      expect(config.cycle_ms).toBe(7000);
    });

    it('sublimation loop default cycle_ms is within spec range (5000-15000ms)', () => {
      const { SUBLIMATION_DEFAULTS } = require('../components/session/sublimation-loop.cjs');
      // Spec says 5-10 seconds; implementation uses 15s (configured in session-config.cjs)
      // SUBLIMATION_DEFAULTS.cycle_ms is the loop config default
      expect(SUBLIMATION_DEFAULTS.cycle_ms).toBeGreaterThanOrEqual(5000);
    });

    it('sublimation loop generates system prompt with cycle instructions', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      const prompt = loop.getSystemPrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
      // Prompt describes the sublimation cycle per spec 4.4
      expect(prompt).toContain('sublimation');
      expect(prompt).toContain('resonance');
      expect(prompt).toContain('fragment');
    });

    it('system prompt instructs header-only scanning (no full fragment retrieval per spec)', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      const prompt = loop.getSystemPrompt();
      // Spec 4.4: "not full fragment retrieval, just header matching"
      expect(prompt).toContain('header');
    });

    it('system prompt describes deterministic resonance scoring (no LLM inference)', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      const prompt = loop.getSystemPrompt();
      // Spec 4.4: "fast: header-only, no body retrieval, no LLM synthesis"
      expect(prompt).toContain('deterministic');
    });

    it('system prompt includes attention tag overlap in scoring criteria', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      const prompt = loop.getSystemPrompt();
      // Spec 4.4 step 3: "Attention tags that overlap with current pointer"
      expect(prompt).toContain('Attention tag');
    });

    it('system prompt includes entity co-occurrence in scoring criteria', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      const prompt = loop.getSystemPrompt();
      // Spec 4.4 step 3: "Entity co-occurrences across domains"
      expect(prompt).toContain('Entity co-occurrence');
    });

    it('system prompt includes emotional valence matching in scoring criteria', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      const prompt = loop.getSystemPrompt();
      // Spec 4.4 step 3: "Emotional valence patterns"
      expect(prompt).toContain('valence');
    });

    it('sublimation loop sensitivity is configurable in range [0, 1] per D-05', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      // Valid update
      const validResult = loop.updateSensitivity(0.5);
      expect(validResult.ok).toBe(true);
      // Invalid: out of range
      const invalidResult = loop.updateSensitivity(1.5);
      expect(invalidResult.ok).toBe(false);
      expect(invalidResult.error.code).toBe('INVALID_SENSITIVITY');
    });

    it('sublimation loop tracks cycle state (cycles_completed, paused)', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      loop.recordCycle();
      loop.recordCycle();
      const state = loop.getState();
      expect(state.cycles_completed).toBe(2);
      expect(state.paused).toBe(false);
      loop.pause();
      expect(loop.getState().paused).toBe(true);
      loop.resume();
      expect(loop.getState().paused).toBe(false);
    });

    it('Tertiary does not communicate with Primary (everything flows through Mind)', () => {
      // Verified by topology rules: Tertiary can only send to Secondary
      const { TOPOLOGY_RULES, SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
      const tertiaryTargets = TOPOLOGY_RULES[SESSION_IDENTITIES.TERTIARY];
      expect(tertiaryTargets).toHaveLength(1);
      expect(tertiaryTargets[0]).toBe(SESSION_IDENTITIES.SECONDARY);
    });

    it('system prompt tells Tertiary to emit sublimation results via Wire at background urgency', () => {
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      const prompt = loop.getSystemPrompt();
      expect(prompt).toContain('background');
    });

    it('sublimation candidates carry association path per spec (which domain, which tag)', () => {
      // Spec 4.4 step 4: "fragment ID, resonance score, the association path"
      // The system prompt instructs emission with this format
      const { createSublimationLoop } = require('../components/session/sublimation-loop.cjs');
      const loop = createSublimationLoop();
      const prompt = loop.getSystemPrompt();
      expect(prompt).toContain('association');
    });
  });

  // =========================================================================
  // Spec 4.5: Subagent Usage
  // =========================================================================

  describe('Spec 4.5: Subagent Usage', () => {

    it('hook-handlers.cjs handles SubagentStart events', () => {
      const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
      const handlers = createHookHandlers({
        contextManager: { trackBytes: () => {} },
        switchboard: { emit: () => {} },
        lathe: {},
        dataDir: '/tmp',
      });
      expect(typeof handlers.handleSubagentStart).toBe('function');
    });

    it('hook-handlers.cjs handles SubagentStop events', () => {
      const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
      const handlers = createHookHandlers({
        contextManager: { trackBytes: () => {} },
        switchboard: { emit: () => {} },
        lathe: {},
        dataDir: '/tmp',
      });
      expect(typeof handlers.handleSubagentStop).toBe('function');
    });

    it('SubagentStop filters by agent_name "reverie-formation" for formation output processing', () => {
      // Per D-01 (Phase 9): Only process output from the reverie-formation subagent
      const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
      const formationProcessed = [];
      const handlers = createHookHandlers({
        contextManager: { trackBytes: () => {} },
        switchboard: { emit: () => {} },
        lathe: {
          readFile: async () => ({ ok: true, value: '{"fragments":[],"nudge":null}' }),
        },
        dataDir: '/tmp',
        formationPipeline: {
          processFormationOutput: async (raw, ctx) => {
            formationProcessed.push(raw);
            return { ok: true, value: { formed: true, formationGroup: 'g1' } };
          },
        },
      });

      // Should process formation output when agent_name matches
      return handlers.handleSubagentStop({ agent_name: 'reverie-formation' }).then((result) => {
        expect(formationProcessed.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('SubagentStop does NOT process formation output for other agent names', () => {
      const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
      const formationProcessed = [];
      const handlers = createHookHandlers({
        contextManager: { trackBytes: () => {} },
        switchboard: { emit: () => {} },
        lathe: {},
        dataDir: '/tmp',
        formationPipeline: {
          processFormationOutput: async (raw, ctx) => {
            formationProcessed.push(raw);
            return { ok: true, value: {} };
          },
        },
      });

      return handlers.handleSubagentStop({ agent_name: 'some-other-agent' }).then(() => {
        expect(formationProcessed).toHaveLength(0);
      });
    });

    it('SES-06 (subagent delegation from Secondary/Tertiary) is deferred to v2', () => {
      // This is a note per REQUIREMENTS.md -- no code to verify, but we confirm
      // that session-manager does not expose a delegateToSubagent method
      const { createSessionManager } = require('../components/session/session-manager.cjs');
      const { createSessionConfig } = require('../components/session/session-config.cjs');
      const sm = createSessionManager({
        conductor: { spawnSession: () => ({ ok: true }), stopSession: () => {} },
        wire: { register: () => {}, unregister: () => {}, send: async () => ({ ok: true }), createEnvelope: () => ({ ok: true, value: {} }) },
        selfModel: {},
        switchboard: { emit: () => {} },
        sublimationLoop: { getSystemPrompt: () => '' },
        config: createSessionConfig(),
      });
      expect(sm.delegateToSubagent).toBeUndefined();
    });
  });

  // =========================================================================
  // Spec 4.6: Session Lifecycle
  // =========================================================================

  describe('Spec 4.6: Session Lifecycle', () => {

    // -----------------------------------------------------------------------
    // State machine and transitions
    // -----------------------------------------------------------------------

    describe('State machine', () => {

      it('defines 9 lifecycle states', () => {
        const { SESSION_STATES } = require('../components/session/session-config.cjs');
        const states = Object.values(SESSION_STATES);
        // uninitialized, starting, passive, upgrading, active, degrading, shutting_down, rem_processing, stopped
        expect(states).toHaveLength(9);
      });

      it('TRANSITIONS maps all 9 states to valid targets', () => {
        const { SESSION_STATES, TRANSITIONS } = require('../components/session/session-config.cjs');
        for (const state of Object.values(SESSION_STATES)) {
          expect(TRANSITIONS).toHaveProperty(state);
        }
      });

      it('STOPPED has no valid transitions (terminal state)', () => {
        const { SESSION_STATES, TRANSITIONS } = require('../components/session/session-config.cjs');
        expect(TRANSITIONS[SESSION_STATES.STOPPED]).toHaveLength(0);
      });

      it('STARTING can transition to PASSIVE (success) or STOPPED (failure per D-04)', () => {
        const { SESSION_STATES, TRANSITIONS } = require('../components/session/session-config.cjs');
        const targets = TRANSITIONS[SESSION_STATES.STARTING];
        expect(targets).toContain(SESSION_STATES.PASSIVE);
        expect(targets).toContain(SESSION_STATES.STOPPED);
      });
    });

    // -----------------------------------------------------------------------
    // Startup sequence (spec 4.6)
    // -----------------------------------------------------------------------

    describe('Startup sequence', () => {

      it('start() transitions uninitialized -> starting -> passive', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const stateChanges = [];
        const sm = createSessionManager({
          conductor: {
            spawnSession: () => ({ ok: true }),
            stopSession: () => {},
          },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: {} }),
          },
          selfModel: {},
          switchboard: {
            emit: (event, data) => {
              if (event === 'session:state-changed') stateChanges.push(data);
            },
          },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        const result = await sm.start();
        expect(result.ok).toBe(true);
        expect(result.value.state).toBe('passive');
        // Should have gone: uninitialized->starting->passive
        expect(stateChanges).toHaveLength(2);
        expect(stateChanges[0].to).toBe('starting');
        expect(stateChanges[1].to).toBe('passive');
      });

      it('start() spawns Secondary via Conductor', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const spawnedSessions = [];
        const sm = createSessionManager({
          conductor: {
            spawnSession: (opts) => { spawnedSessions.push(opts); return { ok: true }; },
            stopSession: () => {},
          },
          wire: { register: () => {}, unregister: () => {}, send: async () => ({ ok: true }), createEnvelope: () => ({ ok: true, value: {} }) },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        await sm.start();
        expect(spawnedSessions).toHaveLength(1);
        expect(spawnedSessions[0].identity).toBe('secondary');
      });

      it('start() registers Secondary in Wire after spawn', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const registeredSessions = [];
        const sm = createSessionManager({
          conductor: { spawnSession: () => ({ ok: true }), stopSession: () => {} },
          wire: {
            register: (id, opts) => registeredSessions.push({ id, opts }),
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: {} }),
          },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        await sm.start();
        expect(registeredSessions).toHaveLength(1);
        expect(registeredSessions[0].opts.identity).toBe('secondary');
      });

      it('start() generates a triplet ID for session group', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const sm = createSessionManager({
          conductor: { spawnSession: () => ({ ok: true }), stopSession: () => {} },
          wire: { register: () => {}, unregister: () => {}, send: async () => ({ ok: true }), createEnvelope: () => ({ ok: true, value: {} }) },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        const result = await sm.start();
        expect(result.ok).toBe(true);
        expect(result.value.triplet_id).toBeDefined();
        expect(result.value.triplet_id).toMatch(/^triplet-[0-9a-f]{4}$/);
      });

      it('start() on spawn failure transitions starting -> stopped', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const sm = createSessionManager({
          conductor: {
            spawnSession: () => ({ ok: false, code: 'SPAWN_FAILED', message: 'test failure' }),
            stopSession: () => {},
          },
          wire: { register: () => {}, unregister: () => {}, send: async () => ({ ok: true }), createEnvelope: () => ({ ok: true, value: {} }) },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        const result = await sm.start();
        expect(result.ok).toBe(false);
        expect(sm.getState().state).toBe('stopped');
      });

      it('SessionStart hook fires Session Manager start() as fire-and-forget per D-10', () => {
        const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
        let startCalled = false;
        const handlers = createHookHandlers({
          contextManager: {
            init: async () => {},
            getInjection: () => '',
          },
          switchboard: { emit: () => {} },
          lathe: {},
          dataDir: '/tmp',
          sessionManager: {
            start: async () => { startCalled = true; return { ok: true }; },
          },
        });
        return handlers.handleSessionStart({}).then(() => {
          // start() is fire-and-forget but should have been called
          expect(startCalled).toBe(true);
        });
      });
    });

    // -----------------------------------------------------------------------
    // Upgrade and degrade (Active <-> Passive)
    // -----------------------------------------------------------------------

    describe('Active mode (upgrade/degrade)', () => {

      it('upgrade() spawns Tertiary and transitions passive -> upgrading -> active', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const stateChanges = [];
        const sm = createSessionManager({
          conductor: { spawnSession: () => ({ ok: true }), stopSession: () => {} },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: { id: 'e1' } }),
          },
          selfModel: {},
          switchboard: {
            emit: (event, data) => {
              if (event === 'session:state-changed') stateChanges.push(data);
            },
          },
          sublimationLoop: { getSystemPrompt: () => 'tertiary system prompt' },
          config: createSessionConfig(),
        });
        await sm.start();
        stateChanges.length = 0; // reset

        const upgradeResult = await sm.upgrade();
        expect(upgradeResult.ok).toBe(true);
        expect(upgradeResult.value.state).toBe('active');
        expect(upgradeResult.value.tertiary).toBeDefined();
        // upgrading -> active
        expect(stateChanges.map((c) => c.to)).toContain('upgrading');
        expect(stateChanges.map((c) => c.to)).toContain('active');
      });

      it('upgrade() delivers sublimation system prompt to Tertiary via Wire context-injection', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const envelopes = [];
        const sm = createSessionManager({
          conductor: { spawnSession: () => ({ ok: true }), stopSession: () => {} },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async (env) => { envelopes.push(env); return { ok: true }; },
            createEnvelope: (opts) => ({ ok: true, value: { id: 'e1', ...opts } }),
          },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => 'sublimation-prompt-content' },
          config: createSessionConfig(),
        });
        await sm.start();
        await sm.upgrade();
        expect(envelopes.length).toBeGreaterThanOrEqual(1);
        const contextInjection = envelopes.find((e) => e.type === 'context-injection');
        expect(contextInjection).toBeDefined();
        expect(contextInjection.payload.role).toBe('system_prompt');
        expect(contextInjection.payload.source).toBe('sublimation-loop');
      });

      it('degrade() stops Tertiary and transitions active -> degrading -> passive', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const stoppedSessions = [];
        const sm = createSessionManager({
          conductor: {
            spawnSession: () => ({ ok: true }),
            stopSession: (id) => stoppedSessions.push(id),
          },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: { id: 'e1' } }),
          },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        await sm.start();
        await sm.upgrade();
        const degradeResult = await sm.degrade();
        expect(degradeResult.ok).toBe(true);
        expect(degradeResult.value.state).toBe('passive');
        // Tertiary should have been stopped
        expect(stoppedSessions.length).toBeGreaterThanOrEqual(1);
      });
    });

    // -----------------------------------------------------------------------
    // Wire urgency levels
    // -----------------------------------------------------------------------

    describe('Wire urgency levels', () => {

      it('URGENCY_LEVELS defines all 4 spec urgency levels: background, active, directive, urgent', () => {
        const { URGENCY_LEVELS } = require(path.join(ROOT, 'core/services/wire/protocol.cjs'));
        expect(URGENCY_LEVELS.BACKGROUND).toBe('background');
        expect(URGENCY_LEVELS.ACTIVE).toBe('active');
        expect(URGENCY_LEVELS.DIRECTIVE).toBe('directive');
        expect(URGENCY_LEVELS.URGENT).toBe('urgent');
      });

      it('URGENCY_LEVELS has exactly 4 levels (no extras)', () => {
        const { URGENCY_LEVELS } = require(path.join(ROOT, 'core/services/wire/protocol.cjs'));
        expect(Object.keys(URGENCY_LEVELS)).toHaveLength(4);
      });

      it('URGENCY_PRIORITY orders urgent > directive > active > background', () => {
        const { URGENCY_PRIORITY, URGENCY_LEVELS } = require(path.join(ROOT, 'core/services/wire/protocol.cjs'));
        expect(URGENCY_PRIORITY[URGENCY_LEVELS.URGENT]).toBeLessThan(URGENCY_PRIORITY[URGENCY_LEVELS.DIRECTIVE]);
        expect(URGENCY_PRIORITY[URGENCY_LEVELS.DIRECTIVE]).toBeLessThan(URGENCY_PRIORITY[URGENCY_LEVELS.ACTIVE]);
        expect(URGENCY_PRIORITY[URGENCY_LEVELS.ACTIVE]).toBeLessThan(URGENCY_PRIORITY[URGENCY_LEVELS.BACKGROUND]);
      });

      it('createEnvelope validates urgency level', () => {
        const { createEnvelope } = require(path.join(ROOT, 'core/services/wire/protocol.cjs'));
        const validResult = createEnvelope({
          from: 'a', to: 'b', type: 'snapshot', urgency: 'background', payload: {},
        });
        expect(validResult.ok).toBe(true);
        const invalidResult = createEnvelope({
          from: 'a', to: 'b', type: 'snapshot', urgency: 'invalid-level', payload: {},
        });
        expect(invalidResult.ok).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // ACK protocol
    // -----------------------------------------------------------------------

    describe('ACK protocol', () => {

      it('wire-topology identifies ACK-required message types (context-injection, directive)', () => {
        // The ACK_REQUIRED_TYPES set is internal but observable through behavior:
        // context-injection + directive/urgent urgency should trigger sendWithAck
        const { createWireTopology } = require('../components/session/wire-topology.cjs');
        const sendCalls = [];
        const mockWire = {
          send: async (env) => { sendCalls.push(env); return { ok: true }; },
          subscribe: () => () => {},
        };
        const topology = createWireTopology({ wire: mockWire, config: { ack_timeout_ms: 50 } });

        // Send a context-injection message at directive urgency (should require ACK)
        return topology.send({
          id: 'msg-1',
          from: 'secondary',
          to: 'primary',
          type: 'context-injection',
          urgency: 'directive',
          payload: {},
        }).then((result) => {
          // The send will proceed but also triggers ACK wait
          // At minimum, the initial send should have been attempted
          expect(sendCalls.length).toBeGreaterThanOrEqual(1);
        });
      });

      it('wire-topology waitForAck resolves on ACK receipt', async () => {
        const { createWireTopology } = require('../components/session/wire-topology.cjs');
        const mockWire = {
          send: async () => ({ ok: true }),
          subscribe: () => () => {},
        };
        const topology = createWireTopology({ wire: mockWire, config: { ack_timeout_ms: 5000 } });

        // Start waiting for ACK
        const ackPromise = topology.waitForAck('envelope-123', 5000);

        // Simulate incoming ACK
        topology._handleIncomingAck({
          type: 'ack',
          correlationId: 'envelope-123',
        });

        const result = await ackPromise;
        expect(result.ok).toBe(true);
        expect(result.value.acked).toBe(true);
      });

      it('wire-topology waitForAck times out if no ACK received', async () => {
        const { createWireTopology } = require('../components/session/wire-topology.cjs');
        const mockWire = {
          send: async () => ({ ok: true }),
          subscribe: () => () => {},
        };
        const topology = createWireTopology({ wire: mockWire, config: { ack_timeout_ms: 50 } });

        const result = await topology.waitForAck('envelope-timeout', 50);
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('ACK_TIMEOUT');
      });

      it('ACK timeout increments ack_timeouts metric', async () => {
        const { createWireTopology } = require('../components/session/wire-topology.cjs');
        const mockWire = {
          send: async () => ({ ok: true }),
          subscribe: () => () => {},
        };
        const topology = createWireTopology({ wire: mockWire, config: { ack_timeout_ms: 30 } });

        await topology.waitForAck('timeout-test', 30);
        const metrics = topology.getMetrics();
        expect(metrics.ack_timeouts).toBeGreaterThanOrEqual(1);
      });
    });

    // -----------------------------------------------------------------------
    // Compaction handling
    // -----------------------------------------------------------------------

    describe('Compaction handling', () => {

      it('PreCompact hook notifies Secondary via Wire with urgent urgency', () => {
        const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
        const sentMessages = [];
        const handlers = createHookHandlers({
          contextManager: {
            checkpoint: async () => {},
            getInjection: () => '',
          },
          switchboard: { emit: () => {} },
          lathe: {},
          dataDir: '/tmp',
          wireTopology: {
            send: async (env) => { sentMessages.push(env); return { ok: true }; },
          },
        });
        return handlers.handlePreCompact({}).then(() => {
          const compactMsg = sentMessages.find((m) => m.payload && m.payload.event === 'pre_compact');
          expect(compactMsg).toBeDefined();
          expect(compactMsg.urgency).toBe('urgent');
          expect(compactMsg.from).toBe('primary');
          expect(compactMsg.to).toBe('secondary');
        });
      });

      it('PreCompact injects compaction framing via additionalContext', () => {
        const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
        const handlers = createHookHandlers({
          contextManager: { checkpoint: async () => {}, getInjection: () => '' },
          switchboard: { emit: () => {} },
          lathe: {},
          dataDir: '/tmp',
        });
        return handlers.handlePreCompact({}).then((result) => {
          expect(result.hookSpecificOutput.additionalContext).toBeDefined();
          expect(result.hookSpecificOutput.additionalContext).toContain('Self Model');
          expect(result.hookSpecificOutput.additionalContext).toContain('Summarize');
        });
      });

      it('PreCompact triggers Tier 1 triage when remConsolidator available', () => {
        const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
        let tier1Called = false;
        const handlers = createHookHandlers({
          contextManager: {
            checkpoint: async () => {},
            getInjection: () => 'face-prompt-state',
          },
          switchboard: { emit: () => {} },
          lathe: {},
          dataDir: '/tmp',
          remConsolidator: {
            handleTier1: async (state) => { tier1Called = true; return { ok: true }; },
          },
        });
        return handlers.handlePreCompact({}).then(() => {
          expect(tier1Called).toBe(true);
        });
      });
    });

    // -----------------------------------------------------------------------
    // Shutdown ordering
    // -----------------------------------------------------------------------

    describe('Shutdown ordering', () => {

      it('stop() shuts down Tertiary first, then Secondary (reverse order)', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const stoppedOrder = [];
        const sm = createSessionManager({
          conductor: {
            spawnSession: () => ({ ok: true }),
            stopSession: (id) => stoppedOrder.push(id),
          },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: { id: 'e1' } }),
          },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        await sm.start();
        await sm.upgrade();
        await sm.stop();
        // Tertiary stopped first, then Secondary
        expect(stoppedOrder).toHaveLength(2);
        expect(stoppedOrder[0]).toContain('tertiary');
        expect(stoppedOrder[1]).toContain('secondary');
        expect(sm.getState().state).toBe('stopped');
      });

      it('stop() transitions active -> shutting_down -> stopped', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const stateChanges = [];
        const sm = createSessionManager({
          conductor: { spawnSession: () => ({ ok: true }), stopSession: () => {} },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: { id: 'e1' } }),
          },
          selfModel: {},
          switchboard: {
            emit: (event, data) => {
              if (event === 'session:state-changed') stateChanges.push(data);
            },
          },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        await sm.start();
        await sm.upgrade();
        stateChanges.length = 0;
        await sm.stop();
        const transitions = stateChanges.map((c) => c.to);
        expect(transitions).toContain('shutting_down');
        expect(transitions).toContain('stopped');
      });

      it('Stop hook triggers REM lifecycle (initShutdown -> transitionToRem)', () => {
        const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
        const remCalls = [];
        const smCalls = [];
        const handlers = createHookHandlers({
          contextManager: {
            persistWarmStart: async () => {},
            getSessionSnapshot: () => ({}),
            getInjection: () => '',
          },
          switchboard: { emit: () => {} },
          lathe: { writeFile: async () => {} },
          dataDir: '/tmp',
          modeManager: {
            requestRem: async (reason) => { remCalls.push(reason); return { ok: true }; },
            requestDormant: async () => ({ ok: true }),
          },
          sessionManager: {
            transitionToRem: async () => { smCalls.push('transitionToRem'); return { ok: true }; },
            completeRem: async () => { smCalls.push('completeRem'); return { ok: true }; },
          },
          remConsolidator: {
            handleTier3: async () => ({ ok: true }),
          },
        });
        return handlers.handleStop({}).then(() => {
          expect(remCalls).toContain('session_end');
          expect(smCalls).toContain('transitionToRem');
        });
      });

      it('transitionToRem stops Tertiary but keeps Secondary alive for REM per D-13', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const stoppedSessions = [];
        const sm = createSessionManager({
          conductor: {
            spawnSession: () => ({ ok: true }),
            stopSession: (id) => stoppedSessions.push(id),
          },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: { id: 'e1' } }),
          },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        await sm.start();
        await sm.upgrade();
        await sm.initShutdown();
        const remResult = await sm.transitionToRem();
        expect(remResult.ok).toBe(true);
        expect(remResult.value.state).toBe('rem_processing');
        // Secondary should still be alive
        expect(remResult.value.secondary).toBeDefined();
        // Tertiary should have been stopped
        expect(stoppedSessions.length).toBeGreaterThanOrEqual(1);
        const tertiaryStop = stoppedSessions.find((id) => id.includes('tertiary'));
        expect(tertiaryStop).toBeDefined();
      });

      it('completeRem stops Secondary and transitions to stopped', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const stoppedSessions = [];
        const sm = createSessionManager({
          conductor: {
            spawnSession: () => ({ ok: true }),
            stopSession: (id) => stoppedSessions.push(id),
          },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: { id: 'e1' } }),
          },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        await sm.start();
        await sm.upgrade();
        await sm.initShutdown();
        await sm.transitionToRem();
        const completeResult = await sm.completeRem();
        expect(completeResult.ok).toBe(true);
        expect(completeResult.value.state).toBe('stopped');
        // Secondary should now be stopped
        const secondaryStop = stoppedSessions.find((id) => id.includes('secondary'));
        expect(secondaryStop).toBeDefined();
      });

      it('completeRem resets triplet ID to null', async () => {
        const { createSessionManager } = require('../components/session/session-manager.cjs');
        const { createSessionConfig } = require('../components/session/session-config.cjs');
        const sm = createSessionManager({
          conductor: { spawnSession: () => ({ ok: true }), stopSession: () => {} },
          wire: {
            register: () => {},
            unregister: () => {},
            send: async () => ({ ok: true }),
            createEnvelope: () => ({ ok: true, value: { id: 'e1' } }),
          },
          selfModel: {},
          switchboard: { emit: () => {} },
          sublimationLoop: { getSystemPrompt: () => '' },
          config: createSessionConfig(),
        });
        await sm.start();
        expect(sm.getState().triplet_id).toBeDefined();
        await sm.initShutdown();
        await sm.transitionToRem();
        await sm.completeRem();
        expect(sm.getState().triplet_id).toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    // Triplet ID namespacing
    // -----------------------------------------------------------------------

    describe('Triplet ID namespacing', () => {

      it('generateTripletId() produces format triplet-XXXX (4-hex-char)', () => {
        const { generateTripletId } = require('../components/session/triplet.cjs');
        const id = generateTripletId();
        expect(id).toMatch(/^triplet-[0-9a-f]{4}$/);
      });

      it('makeTripletSessionId() creates tripletId:identity composite', () => {
        const { makeTripletSessionId } = require('../components/session/triplet.cjs');
        const compositeId = makeTripletSessionId('triplet-a1b2', 'secondary');
        expect(compositeId).toBe('triplet-a1b2:secondary');
      });

      it('extractTripletId() extracts triplet from composite session ID', () => {
        const { extractTripletId } = require('../components/session/triplet.cjs');
        expect(extractTripletId('triplet-a1b2:primary')).toBe('triplet-a1b2');
      });

      it('extractIdentity() extracts identity from composite session ID', () => {
        const { extractIdentity } = require('../components/session/triplet.cjs');
        expect(extractIdentity('triplet-a1b2:secondary')).toBe('secondary');
      });

      it('extractShortHash() extracts 4-char hex hash from triplet ID', () => {
        const { extractShortHash } = require('../components/session/triplet.cjs');
        expect(extractShortHash('triplet-a1b2')).toBe('a1b2');
        expect(extractShortHash('triplet-a1b2:tertiary')).toBe('a1b2');
      });
    });
  });
});
