'use strict';

const { describe, it, expect, mock } = require('bun:test');
const { join } = require('node:path');

const { validateModuleManifest } = require('../../../core/sdk/circuit/module-manifest.cjs');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock Switchboard that tracks both .emit() and .on() registrations.
 */
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

/**
 * Creates a mock Wire service.
 */
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

/**
 * Creates a full mock facade (simulating Circuit API) with registerCommand tracking.
 */
function createMockCircuitApi(overrides) {
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
// Tests: Submodule lifecycle integration
// ---------------------------------------------------------------------------

describe('Submodule lifecycle: manifest -> Circuit register -> hooks wired -> CLI available', () => {

  it('manifest.json validates via validateModuleManifest', () => {
    const manifestPath = join(__dirname, '..', 'manifest.json');
    const raw = require('node:fs').readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    const result = validateModuleManifest(manifest);
    expect(result.ok).toBe(true);
    expect(result.value.name).toBe('reverie');
  });

  it('register function receives circuitApi with registerCommand and returns registered status', () => {
    const circuitApi = createMockCircuitApi();
    const { register } = require('../reverie.cjs');

    const result = register(circuitApi);

    expect(result.name).toBe('reverie');
    expect(result.status).toBe('registered');
  });

  it('register function returns hooks (non-zero) from exciter.registerHooks', () => {
    const circuitApi = createMockCircuitApi();
    const { register } = require('../reverie.cjs');

    const result = register(circuitApi);

    expect(result.hooks).toBeDefined();
    expect(result.hooks).toBeGreaterThan(0);
  });

  it('register function calls registerCommand for CLI commands when registerCommand is available', () => {
    const circuitApi = createMockCircuitApi();
    const { register } = require('../reverie.cjs');

    register(circuitApi);

    const commands = circuitApi.getRegisteredCommands();
    // Expect at least: status, 7 inspect, 3 history, 3 reset = 14
    // Plus backfill = 15
    expect(commands.length).toBeGreaterThanOrEqual(14);

    // Verify specific commands
    const commandNames = commands.map(function (c) { return c.name; });
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('inspect fragment');
    expect(commandNames).toContain('inspect domains');
    expect(commandNames).toContain('history sessions');
    expect(commandNames).toContain('reset all');
  });

  it('register function returns Phase 12 markers (taxonomy, backfill, cli)', () => {
    const circuitApi = createMockCircuitApi();
    const { register } = require('../reverie.cjs');

    const result = register(circuitApi);

    expect(result.taxonomy).toBeDefined();
    expect(result.backfill).toBeDefined();
    expect(result.cli).toBe(true);
  });

  it('Armature lifecycle hooks are wired (hooks object returned)', () => {
    const circuitApi = createMockCircuitApi();
    const { register } = require('../reverie.cjs');

    const result = register(circuitApi);

    // hooks is the count of registered hooks (8 for all Claude Code hook types)
    expect(typeof result.hooks).toBe('number');
    expect(result.hooks).toBe(8);
  });

  it('end-to-end: manifest validates -> register completes -> CLI available', () => {
    // Step 1: Validate manifest
    const manifestPath = join(__dirname, '..', 'manifest.json');
    const raw = require('node:fs').readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);
    const validResult = validateModuleManifest(manifest);
    expect(validResult.ok).toBe(true);

    // Step 2: Register with mock Circuit API
    const circuitApi = createMockCircuitApi();
    const { register } = require('../reverie.cjs');
    const regResult = register(circuitApi);
    expect(regResult.status).toBe('registered');

    // Step 3: Verify CLI commands available
    const commands = circuitApi.getRegisteredCommands();
    expect(commands.length).toBeGreaterThanOrEqual(14);

    // Step 4: Verify hooks wired
    expect(regResult.hooks).toBe(8);
  });
});
