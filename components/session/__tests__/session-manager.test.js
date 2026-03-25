'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');
const { SESSION_STATES, SESSION_IDENTITIES, createSessionConfig } = require('../session-config.cjs');
const { MESSAGE_TYPES, URGENCY_LEVELS } = require('../../../../../core/services/wire/protocol.cjs');

/**
 * Creates a mock Conductor with spawnSession, stopSession, getSessionHealth, listSessions.
 */
function createMockConductor() {
  const spawned = [];
  const stopped = [];
  return {
    spawned,
    stopped,
    spawnSession({ sessionId, identity, env }) {
      spawned.push({ sessionId, identity, env });
      return { ok: true, value: { sessionId, pid: 1234, proc: {} } };
    },
    stopSession(sessionId) {
      stopped.push(sessionId);
      return { ok: true, value: { sessionId } };
    },
    getSessionHealth(sessionId) {
      return { ok: true, value: { sessionId, alive: true, pid: 1234, uptime: 1000 } };
    },
    listSessions() {
      return spawned.filter(s => !stopped.includes(s.sessionId))
        .map(s => ({ sessionId: s.sessionId, identity: s.identity, alive: true }));
    },
  };
}

/**
 * Creates a mock Wire with register, unregister, send, subscribe, createEnvelope.
 */
function createMockWire() {
  const registered = [];
  const unregistered = [];
  const sent = [];
  const envelopes = [];
  return {
    registered,
    unregistered,
    sent,
    envelopes,
    register(sessionId, info) {
      registered.push({ sessionId, info });
      return { ok: true, value: undefined };
    },
    unregister(sessionId) {
      unregistered.push(sessionId);
      return { ok: true, value: undefined };
    },
    async send(envelope) {
      sent.push(envelope);
      return { ok: true, value: undefined };
    },
    subscribe(sessionId, callback) {
      return function unsubscribe() {};
    },
    createEnvelope(params) {
      const env = {
        id: 'test-envelope-' + Date.now(),
        from: params.from,
        to: params.to,
        type: params.type,
        urgency: params.urgency || URGENCY_LEVELS.ACTIVE,
        payload: params.payload,
        timestamp: new Date().toISOString(),
        correlationId: params.correlationId || null,
      };
      envelopes.push(env);
      return { ok: true, value: env };
    },
  };
}

/**
 * Creates a mock Switchboard for event emission tracking.
 */
function createMockSwitchboard() {
  const events = [];
  return {
    events,
    emit(name, data) {
      events.push({ name, data });
    },
    on() {},
    off() {},
  };
}

/**
 * Creates a mock SublimationLoop.
 */
function createMockSublimationLoop() {
  return {
    getSystemPrompt() {
      return 'You are the Tertiary session -- the sublimation engine.';
    },
    getCycleConfig() {
      return { cycle_ms: 15000, max_candidates_per_cycle: 5, sensitivity_threshold: 0.3, batch_messages: true };
    },
    updateSensitivity() { return { ok: true, value: 0.5 }; },
    pause() { return { ok: true }; },
    resume() { return { ok: true }; },
    recordCycle() { return { ok: true, value: { cycles_completed: 1 } }; },
    getState() { return { cycles_completed: 0, last_cycle_at: null, sensitivity_threshold: 0.3, paused: false }; },
  };
}

/**
 * Creates a mock Self Model.
 */
function createMockSelfModel() {
  return {
    getAspect() { return null; },
    getIdentityCore() { return {}; },
  };
}

describe('Session Manager', () => {
  let conductor, wire, selfModel, switchboard, sublimationLoop, config;

  beforeEach(() => {
    conductor = createMockConductor();
    wire = createMockWire();
    selfModel = createMockSelfModel();
    switchboard = createMockSwitchboard();
    sublimationLoop = createMockSublimationLoop();
    config = createSessionConfig();
  });

  describe('createSessionManager', () => {
    it('returns object with start, stop, upgrade, degrade, getState methods', () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      expect(typeof mgr.start).toBe('function');
      expect(typeof mgr.stop).toBe('function');
      expect(typeof mgr.upgrade).toBe('function');
      expect(typeof mgr.degrade).toBe('function');
      expect(typeof mgr.getState).toBe('function');
    });
  });

  describe('getState()', () => {
    it('initial state is uninitialized', () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      const state = mgr.getState();
      expect(state.state).toBe('uninitialized');
    });
  });

  describe('start()', () => {
    it('transitions state from uninitialized -> starting -> passive', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      const result = await mgr.start();
      expect(result.ok).toBe(true);
      expect(mgr.getState().state).toBe('passive');
    });

    it('calls conductor.spawnSession for Secondary with identity secondary', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      expect(conductor.spawned.length).toBe(1);
      expect(conductor.spawned[0].identity).toBe('secondary');
    });

    it('calls wire.register for Secondary with correct capabilities and writePermissions', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      expect(wire.registered.length).toBe(1);
      expect(wire.registered[0].info.identity).toBe('secondary');
      expect(wire.registered[0].info.capabilities).toContain('send');
      expect(wire.registered[0].info.capabilities).toContain('receive');
      expect(wire.registered[0].info.capabilities).toContain('write');
      expect(wire.registered[0].info.writePermissions).toContain('ledger');
      expect(wire.registered[0].info.writePermissions).toContain('journal');
      expect(wire.registered[0].info.writePermissions).toContain('magnet');
    });

    it('does NOT spawn Tertiary (starts in passive mode)', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      // Only one session spawned (Secondary)
      expect(conductor.spawned.length).toBe(1);
      expect(conductor.spawned[0].identity).toBe('secondary');
      // No Tertiary registered in Wire
      expect(wire.registered.every(r => r.info.identity !== 'tertiary')).toBe(true);
    });

    it('emits session:state-changed via switchboard with { from, to } payload', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      const stateEvents = switchboard.events.filter(e => e.name === 'session:state-changed');
      // Should have two state changes: uninitialized->starting, starting->passive
      expect(stateEvents.length).toBe(2);
      expect(stateEvents[0].data.from).toBe('uninitialized');
      expect(stateEvents[0].data.to).toBe('starting');
      expect(stateEvents[1].data.from).toBe('starting');
      expect(stateEvents[1].data.to).toBe('passive');
    });

    it('Secondary spawn failure during start() transitions to stopped with error', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      conductor.spawnSession = () => ({ ok: false, error: { code: 'SPAWN_FAILED', message: 'Unable to spawn' } });
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      const result = await mgr.start();
      expect(result.ok).toBe(false);
      expect(mgr.getState().state).toBe('stopped');
    });
  });

  describe('upgrade()', () => {
    it('transitions from passive -> upgrading -> active', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      const result = await mgr.upgrade();
      expect(result.ok).toBe(true);
      expect(mgr.getState().state).toBe('active');
    });

    it('calls conductor.spawnSession for Tertiary with identity tertiary', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      // Secondary first, then Tertiary
      expect(conductor.spawned.length).toBe(2);
      expect(conductor.spawned[1].identity).toBe('tertiary');
    });

    it('calls wire.register for Tertiary', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      // Secondary registered first, then Tertiary
      expect(wire.registered.length).toBe(2);
      expect(wire.registered[1].info.identity).toBe('tertiary');
    });

    it('after Tertiary Wire registration sends context-injection envelope containing sublimationLoop.getSystemPrompt() to Tertiary via wire.send', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      // Should have created and sent a context-injection envelope
      expect(wire.envelopes.length).toBeGreaterThanOrEqual(1);
      const contextEnvelope = wire.envelopes.find(e => e.type === MESSAGE_TYPES.CONTEXT_INJECTION);
      expect(contextEnvelope).toBeDefined();
      expect(contextEnvelope.payload.content).toBe(sublimationLoop.getSystemPrompt());
      expect(contextEnvelope.payload.role).toBe('system_prompt');
      expect(contextEnvelope.payload.source).toBe('sublimation-loop');
      // Should have been sent via wire.send
      expect(wire.sent.length).toBeGreaterThanOrEqual(1);
    });

    it('context-injection envelope has type MESSAGE_TYPES.CONTEXT_INJECTION and urgency URGENCY_LEVELS.DIRECTIVE', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      const contextEnvelope = wire.envelopes.find(e => e.type === MESSAGE_TYPES.CONTEXT_INJECTION);
      expect(contextEnvelope.type).toBe(MESSAGE_TYPES.CONTEXT_INJECTION);
      expect(contextEnvelope.urgency).toBe(URGENCY_LEVELS.DIRECTIVE);
    });

    it('from non-passive state returns err(INVALID_TRANSITION)', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      // State is uninitialized, upgrade should fail
      const result = await mgr.upgrade();
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_TRANSITION');
    });

    it('Tertiary spawn failure during upgrade() falls back to passive (not stopped)', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const origSpawn = conductor.spawnSession.bind(conductor);
      let callCount = 0;
      conductor.spawnSession = (opts) => {
        callCount++;
        // First call (Secondary) succeeds, second call (Tertiary) fails
        if (callCount === 1) {
          return origSpawn(opts);
        }
        return { ok: false, error: { code: 'SPAWN_FAILED', message: 'Unable to spawn tertiary' } };
      };
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      const result = await mgr.upgrade();
      expect(result.ok).toBe(false);
      expect(mgr.getState().state).toBe('passive');
    });
  });

  describe('degrade()', () => {
    it('transitions from active -> degrading -> passive', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      const result = await mgr.degrade();
      expect(result.ok).toBe(true);
      expect(mgr.getState().state).toBe('passive');
    });

    it('calls conductor.stopSession for Tertiary', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      await mgr.degrade();
      expect(conductor.stopped.length).toBe(1);
    });

    it('calls wire.unregister for Tertiary', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      await mgr.degrade();
      expect(wire.unregistered.length).toBe(1);
    });
  });

  describe('stop()', () => {
    it('transitions through shutting_down -> stopped', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      const result = await mgr.stop();
      expect(result.ok).toBe(true);
      expect(mgr.getState().state).toBe('stopped');
    });

    it('from active mode stops Tertiary first, then Secondary (ordered shutdown)', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      await mgr.stop();
      // Tertiary stopped first, then Secondary
      expect(conductor.stopped.length).toBe(2);
      // Verify ordering: Tertiary sessionId contains 'tertiary', Secondary contains 'secondary'
      expect(conductor.stopped[0]).toContain('tertiary');
      expect(conductor.stopped[1]).toContain('secondary');
    });

    it('from passive mode stops Secondary only', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.stop();
      expect(conductor.stopped.length).toBe(1);
      expect(conductor.stopped[0]).toContain('secondary');
    });

    it('calls wire.unregister for each stopped session', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      await mgr.stop();
      // Both Tertiary and Secondary unregistered
      expect(wire.unregistered.length).toBe(2);
    });
  });

  describe('transitionToRem()', () => {
    it('from SHUTTING_DOWN: stops Tertiary, keeps Secondary alive, transitions to REM_PROCESSING', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      // Use initShutdown to reach SHUTTING_DOWN without completing to STOPPED
      await mgr.initShutdown();
      expect(mgr.getState().state).toBe('shutting_down');

      const result = await mgr.transitionToRem();
      expect(result.ok).toBe(true);
      expect(mgr.getState().state).toBe('rem_processing');
      // Tertiary should be stopped
      expect(mgr.getState().tertiary).toBe(null);
      // Secondary should still be alive
      expect(mgr.getState().secondary).not.toBe(null);
      expect(result.value.secondary).not.toBe(null);
    });

    it('from non-SHUTTING_DOWN state returns error', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      // In passive state, transitionToRem should fail
      const result = await mgr.transitionToRem();
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_TRANSITION');
    });

    it('getState() includes state=rem_processing when in REM_PROCESSING', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.initShutdown();
      await mgr.transitionToRem();
      expect(mgr.getState().state).toBe('rem_processing');
    });

    it('does NOT call conductor.stopSession for Secondary', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.initShutdown();
      const stoppedBefore = [...conductor.stopped];
      await mgr.transitionToRem();
      // No new stops should have happened (no Tertiary in passive path)
      const newStops = conductor.stopped.slice(stoppedBefore.length);
      const secondaryStops = newStops.filter(id => id.includes('secondary'));
      expect(secondaryStops.length).toBe(0);
    });
  });

  describe('completeRem()', () => {
    it('from non-REM_PROCESSING state returns error', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      const result = await mgr.completeRem();
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('REM lifecycle: initShutdown -> transitionToRem -> completeRem', () => {
    it('full REM path: passive -> shutting_down -> rem_processing -> stopped', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      // initShutdown to get to SHUTTING_DOWN without completing to STOPPED
      const shutdownResult = await mgr.initShutdown();
      expect(shutdownResult.ok).toBe(true);
      expect(mgr.getState().state).toBe('shutting_down');

      // Now transitionToRem: stops Tertiary (none in passive), keeps Secondary
      const remResult = await mgr.transitionToRem();
      expect(remResult.ok).toBe(true);
      expect(mgr.getState().state).toBe('rem_processing');
      // Secondary should still be alive
      expect(mgr.getState().secondary).not.toBe(null);

      // completeRem: stops Secondary, transitions to STOPPED
      const completeResult = await mgr.completeRem();
      expect(completeResult.ok).toBe(true);
      expect(mgr.getState().state).toBe('stopped');
      expect(mgr.getState().secondary).toBe(null);
    });

    it('full REM path from active: active -> shutting_down -> rem_processing -> stopped', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      await mgr.start();
      await mgr.upgrade();
      expect(mgr.getState().state).toBe('active');

      // initShutdown from active
      const shutdownResult = await mgr.initShutdown();
      expect(shutdownResult.ok).toBe(true);
      expect(mgr.getState().state).toBe('shutting_down');

      // transitionToRem: stops Tertiary, keeps Secondary
      const remResult = await mgr.transitionToRem();
      expect(remResult.ok).toBe(true);
      expect(mgr.getState().state).toBe('rem_processing');
      // Tertiary should be gone (stopped by transitionToRem)
      expect(mgr.getState().tertiary).toBe(null);
      // Secondary still alive
      expect(mgr.getState().secondary).not.toBe(null);

      // Verify Tertiary was stopped via conductor
      const tertiaryStops = conductor.stopped.filter(id => id.includes('tertiary'));
      expect(tertiaryStops.length).toBe(1);
      // Verify Secondary was NOT stopped
      const secondaryStops = conductor.stopped.filter(id => id.includes('secondary'));
      expect(secondaryStops.length).toBe(0);

      // completeRem: stops Secondary
      await mgr.completeRem();
      expect(mgr.getState().state).toBe('stopped');
      // Now Secondary should be stopped
      const secondaryStopsAfter = conductor.stopped.filter(id => id.includes('secondary'));
      expect(secondaryStopsAfter.length).toBe(1);
    });
  });

  describe('invalid transitions', () => {
    it('invalid state transitions return err(INVALID_TRANSITION)', async () => {
      const { createSessionManager } = require('../session-manager.cjs');
      const mgr = createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config });
      // Try to stop from uninitialized -- should fail
      const result = await mgr.stop();
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_TRANSITION');
    });
  });
});
