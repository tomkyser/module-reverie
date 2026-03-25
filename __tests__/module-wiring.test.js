'use strict';

const { describe, it, expect, mock } = require('bun:test');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockSwitchboard() {
  const _events = [];
  const _listeners = {};
  return {
    emit(name, payload) {
      _events.push({ name, payload });
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

function createMockWire() {
  const _subscriptions = [];
  return {
    register() {},
    unregister() {},
    subscribe(sessionId, callback) {
      _subscriptions.push({ sessionId, callback });
      return function unsubscribe() {};
    },
    async send() { return { ok: true, value: { delivered: true } }; },
    createEnvelope(opts) { return { ok: true, value: { id: 'env-test', ...opts } }; },
    queueWrite() { return { ok: true }; },
    getSubscriptions() { return _subscriptions; },
  };
}

function createMockFacade(overrides) {
  const opts = overrides || {};
  const switchboard = opts.switchboard || createMockSwitchboard();
  const wire = opts.wire || createMockWire();
  const _registeredCommands = [];

  const services = {
    switchboard: switchboard,
    lathe: {
      async readFile() { return { ok: false, error: { code: 'FILE_NOT_FOUND' } }; },
      async writeFile(p, c) { return { ok: true, value: { path: p } }; },
      readFileSync() { return null; },
    },
    magnet: { get() { return null; }, set() {} },
    wire: wire,
    assay: { search() { return { ok: true, value: [] }; } },
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
    registerCommand(name, handler, meta) {
      _registeredCommands.push({ name, handler, meta });
    },
    ok(v) { return { ok: true, value: v }; },
    err(code, msg) { return { ok: false, error: { code, message: msg } }; },
    isOk(r) { return r && r.ok === true; },
    isErr(r) { return r && r.ok === false; },
    validate() { return { ok: true, value: {} }; },
    createContract() { return {}; },
    getRegisteredCommands() { return _registeredCommands; },
  };
}

// ---------------------------------------------------------------------------
// Tests: Phase 12 module wiring
// ---------------------------------------------------------------------------

describe('Phase 12: Module wiring integration', () => {
  const { register } = require('../reverie.cjs');

  describe('Taxonomy governor wiring', () => {
    it('reverie.cjs creates taxonomy governor and returns it in result', () => {
      const facade = createMockFacade();
      const result = register(facade);

      expect(result.taxonomy).toBeDefined();
      expect(typeof result.taxonomy.computeCapPressure).toBe('function');
      expect(typeof result.taxonomy.identifySplitCandidates).toBe('function');
      expect(typeof result.taxonomy.identifyRetireCandidates).toBe('function');
    });

    it('taxonomy governor is frozen', () => {
      const facade = createMockFacade();
      const result = register(facade);

      expect(Object.isFrozen(result.taxonomy)).toBe(true);
    });
  });

  describe('Backfill pipeline wiring', () => {
    it('reverie.cjs creates backfill pipeline and returns it in result', () => {
      const facade = createMockFacade();
      const result = register(facade);

      expect(result.backfill).toBeDefined();
      expect(typeof result.backfill.dryRun).toBe('function');
      expect(typeof result.backfill.processConversation).toBe('function');
      expect(typeof result.backfill.runBatch).toBe('function');
    });

    it('backfill pipeline is frozen', () => {
      const facade = createMockFacade();
      const result = register(facade);

      expect(Object.isFrozen(result.backfill)).toBe(true);
    });
  });

  describe('CLI command registration', () => {
    it('registers all 14 base commands + backfill = 15 commands', () => {
      const facade = createMockFacade();
      register(facade);

      const commands = facade.getRegisteredCommands();
      expect(commands.length).toBe(15);
    });

    it('registers status command', () => {
      const facade = createMockFacade();
      register(facade);

      const commands = facade.getRegisteredCommands();
      const names = commands.map(function (c) { return c.name; });
      expect(names).toContain('status');
    });

    it('registers all 7 inspect commands', () => {
      const facade = createMockFacade();
      register(facade);

      const commands = facade.getRegisteredCommands();
      const names = commands.map(function (c) { return c.name; });
      expect(names).toContain('inspect fragment');
      expect(names).toContain('inspect domains');
      expect(names).toContain('inspect associations');
      expect(names).toContain('inspect self-model');
      expect(names).toContain('inspect identity');
      expect(names).toContain('inspect relational');
      expect(names).toContain('inspect conditioning');
    });

    it('registers all 3 history commands', () => {
      const facade = createMockFacade();
      register(facade);

      const commands = facade.getRegisteredCommands();
      const names = commands.map(function (c) { return c.name; });
      expect(names).toContain('history sessions');
      expect(names).toContain('history fragments');
      expect(names).toContain('history consolidations');
    });

    it('registers all 3 reset commands', () => {
      const facade = createMockFacade();
      register(facade);

      const commands = facade.getRegisteredCommands();
      const names = commands.map(function (c) { return c.name; });
      expect(names).toContain('reset fragments');
      expect(names).toContain('reset self-model');
      expect(names).toContain('reset all');
    });

    it('registers backfill command', () => {
      const facade = createMockFacade();
      register(facade);

      const commands = facade.getRegisteredCommands();
      const names = commands.map(function (c) { return c.name; });
      expect(names).toContain('backfill');
    });

    it('backfill command has description metadata', () => {
      const facade = createMockFacade();
      register(facade);

      const commands = facade.getRegisteredCommands();
      const backfill = commands.find(function (c) { return c.name === 'backfill'; });
      expect(backfill).toBeDefined();
      expect(backfill.meta.description).toBe('Import historical conversation data');
    });

    it('sets cli marker to true in return value', () => {
      const facade = createMockFacade();
      const result = register(facade);

      expect(result.cli).toBe(true);
    });
  });

  describe('Return value completeness', () => {
    it('includes all expected fields', () => {
      const facade = createMockFacade();
      const result = register(facade);

      expect(result.name).toBe('reverie');
      expect(result.status).toBe('registered');
      expect(typeof result.hooks).toBe('number');
      expect(result.formation).toBe(true);
      expect(result.recall).toBe(true);
      expect(result.sessions).toBe(true);
      expect(result.modes).toBe(true);
      expect(result.rem).toBeDefined();
      expect(result.taxonomy).toBeDefined();
      expect(result.backfill).toBeDefined();
      expect(result.cli).toBe(true);
    });
  });
});
