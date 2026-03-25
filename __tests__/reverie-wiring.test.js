'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

// ---------------------------------------------------------------------------
// Test helpers: mock factories for reverie.cjs wiring verification
// ---------------------------------------------------------------------------

/**
 * Creates a mock Switchboard that tracks both .emit() and .on() registrations.
 * Enhanced to support listener replay for testing session:state-changed wiring.
 */
function createMockSwitchboard() {
  const _events = [];
  const _listeners = {};
  return {
    emit(name, payload) {
      _events.push({ name, payload });
      // Also invoke registered listeners
      if (_listeners[name]) {
        _listeners[name].forEach(function (fn) { fn(payload); });
      }
    },
    on(name, handler) {
      if (!_listeners[name]) _listeners[name] = [];
      _listeners[name].push(handler);
    },
    getEvents() { return _events; },
    getListeners() { return _listeners; },
  };
}

/**
 * Creates a mock Wire service that tracks subscribe() and register() calls.
 */
function createMockWire() {
  const _registered = [];
  const _subscriptions = [];
  const _sends = [];

  return {
    register(sessionId, opts) {
      _registered.push({ sessionId, opts });
    },
    unregister(sessionId) {},
    subscribe(sessionId, callback) {
      _subscriptions.push({ sessionId, callback });
      return function unsubscribe() {};
    },
    async send(envelope) {
      _sends.push(envelope);
      return { ok: true, value: { delivered: true } };
    },
    createEnvelope(opts) {
      return { ok: true, value: { id: 'env-' + Date.now(), ...opts } };
    },
    getRegistered() { return _registered; },
    getSubscriptions() { return _subscriptions; },
    getSends() { return _sends; },
  };
}

/**
 * Creates a full mock facade for register() with controllable services.
 * All components (contextManager, wireTopology, etc.) are created internally
 * by register() from these services.
 */
function createMockFacade(overrides) {
  const opts = overrides || {};
  const switchboard = opts.switchboard || createMockSwitchboard();
  const wire = opts.wire || createMockWire();

  const services = {
    switchboard: switchboard,
    lathe: {
      async readFile() { return { ok: false, error: { code: 'FILE_NOT_FOUND' } }; },
      async writeFile(p, c) { return { ok: true, value: { path: p } }; },
    },
    magnet: {
      get() { return null; },
      set() {},
    },
    wire: wire,
    assay: {
      search() { return { ok: true, value: [] }; },
    },
    conductor: {
      spawnSession() { return { ok: true, value: { sessionId: 'sec-1', pid: 123, proc: {} } }; },
      stopSession() { return { ok: true }; },
      getSessionHealth() { return { ok: true, value: { healthy: true } }; },
    },
    exciter: {
      registerHooks(name, handlers) {
        return { ok: true, value: Object.keys(handlers).length };
      },
    },
  };

  const providers = {
    journal: {
      read() { return { ok: false }; },
      write() { return { ok: true }; },
      list() { return { ok: true, value: [] }; },
    },
    lithograph: {
      setTranscriptPath() { return { ok: true }; },
    },
  };

  return {
    events: switchboard,
    getService(name) { return services[name]; },
    getProvider(name) { return providers[name]; },
  };
}

// ---------------------------------------------------------------------------
// Tests: Phase 10 — Secondary face prompt authority wiring in reverie.cjs
// ---------------------------------------------------------------------------

describe('Phase 10: Secondary face prompt authority wiring', () => {

  describe('Switchboard session:state-changed listener', () => {
    it('registers a listener on session:state-changed during register()', () => {
      const switchboard = createMockSwitchboard();
      const { register } = require('../reverie.cjs');
      const facade = createMockFacade({ switchboard });

      register(facade);

      const listeners = switchboard.getListeners();
      expect(listeners['session:state-changed']).toBeDefined();
      expect(listeners['session:state-changed'].length).toBeGreaterThanOrEqual(1);
    });

    it('emits context:face-prompt-updated is NOT emitted when transitioning to passive (setSecondaryActive only toggles flag)', () => {
      // When session:state-changed to passive fires, the wiring should call
      // contextManager.setSecondaryActive(true). Since contextManager is internal,
      // we verify indirectly: the switchboard should NOT get a context:face-prompt-updated
      // event just from the state change (that only happens when receiveSecondaryUpdate is called).
      const switchboard = createMockSwitchboard();
      const { register } = require('../reverie.cjs');
      const facade = createMockFacade({ switchboard });

      register(facade);

      // Emit state change to passive
      switchboard.emit('session:state-changed', { from: 'starting', to: 'passive' });

      // setSecondaryActive(true) just sets an internal flag — no event emitted.
      // Verify no context:face-prompt-updated event was emitted (that only comes from receiveSecondaryUpdate)
      const facePromptEvents = switchboard.getEvents().filter(function (e) {
        return e.name === 'context:face-prompt-updated';
      });
      expect(facePromptEvents.length).toBe(0);
    });

    it('session:state-changed to stopped does not cause errors', () => {
      const switchboard = createMockSwitchboard();
      const { register } = require('../reverie.cjs');
      const facade = createMockFacade({ switchboard });

      register(facade);

      // Should not throw
      switchboard.emit('session:state-changed', { from: 'shutting_down', to: 'stopped' });
    });

    it('session:state-changed with null data does not crash', () => {
      const switchboard = createMockSwitchboard();
      const { register } = require('../reverie.cjs');
      const facade = createMockFacade({ switchboard });

      register(facade);

      // Should not throw with null or undefined data
      switchboard.emit('session:state-changed', null);
      switchboard.emit('session:state-changed', undefined);
    });
  });

  describe('Wire topology subscription for face prompt updates', () => {
    it('wire.subscribe is called for Primary session during register()', () => {
      const switchboard = createMockSwitchboard();
      const wire = createMockWire();
      const { register } = require('../reverie.cjs');
      const facade = createMockFacade({ switchboard, wire });

      register(facade);

      // wireTopology.subscribe() calls wire.subscribe() internally.
      // Check that wire.subscribe was called with a 'primary' session.
      const subs = wire.getSubscriptions();
      const primarySubs = subs.filter(function (s) {
        return s.sessionId === 'primary';
      });
      expect(primarySubs.length).toBeGreaterThanOrEqual(1);
    });

    it('Wire subscription callback routes DIRECTIVE face_prompt to contextManager.receiveSecondaryUpdate', () => {
      const switchboard = createMockSwitchboard();
      const wire = createMockWire();
      const { register } = require('../reverie.cjs');
      const facade = createMockFacade({ switchboard, wire });

      register(facade);

      // Find the subscription for primary
      const subs = wire.getSubscriptions();
      const primarySub = subs.find(function (s) {
        return s.sessionId === 'primary';
      });
      expect(primarySub).toBeTruthy();

      // Simulate a DIRECTIVE face_prompt envelope arriving
      // The callback is the wireTopology's topologyFilter, which checks sender identity
      // against TOPOLOGY_RULES. For primary subscriber, allowed senders are ['secondary'].
      primarySub.callback({
        id: 'test-env-1',
        from: 'secondary',
        to: 'primary',
        type: 'directive',
        urgency: 'directive',
        payload: { role: 'face_prompt', content: 'Secondary composed prompt with referential framing' },
        timestamp: new Date().toISOString(),
      });

      // After the callback processes, contextManager.receiveSecondaryUpdate should have been called.
      // Since contextManager is internal, verify via the switchboard event that receiveSecondaryUpdate emits.
      const facePromptEvents = switchboard.getEvents().filter(function (e) {
        return e.name === 'context:face-prompt-updated';
      });
      expect(facePromptEvents.length).toBe(1);
      expect(facePromptEvents[0].payload.source).toBe('secondary');
      expect(facePromptEvents[0].payload.length).toBe('Secondary composed prompt with referential framing'.length);
    });

    it('Wire subscription callback does NOT route non-face_prompt DIRECTIVE to receiveSecondaryUpdate', () => {
      const switchboard = createMockSwitchboard();
      const wire = createMockWire();
      const { register } = require('../reverie.cjs');
      const facade = createMockFacade({ switchboard, wire });

      register(facade);

      const subs = wire.getSubscriptions();
      const primarySub = subs.find(function (s) {
        return s.sessionId === 'primary';
      });
      expect(primarySub).toBeTruthy();

      // Simulate a DIRECTIVE envelope with behavioral role (not face_prompt)
      primarySub.callback({
        id: 'test-env-2',
        from: 'secondary',
        to: 'primary',
        type: 'directive',
        urgency: 'directive',
        payload: { role: 'behavioral', content: 'Some behavioral directive' },
        timestamp: new Date().toISOString(),
      });

      // receiveSecondaryUpdate should NOT have been called, so no context:face-prompt-updated event
      const facePromptEvents = switchboard.getEvents().filter(function (e) {
        return e.name === 'context:face-prompt-updated';
      });
      expect(facePromptEvents.length).toBe(0);
    });
  });

  describe('Backward compatibility', () => {
    it('register() completes successfully with all new wiring', () => {
      const switchboard = createMockSwitchboard();
      const { register } = require('../reverie.cjs');
      const facade = createMockFacade({ switchboard });

      const result = register(facade);
      expect(result.status).toBe('registered');
      expect(result.name).toBe('reverie');
    });
  });
});
