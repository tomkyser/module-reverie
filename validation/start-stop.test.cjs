'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

// ---------------------------------------------------------------------------
// Helpers: mock factories
// ---------------------------------------------------------------------------

function createMockModeManager(overrides) {
  return Object.assign({
    getMode: function () { return 'passive'; },
    requestActive: async function () { return { ok: true, value: { mode: 'active', changed: true } }; },
    requestRem: async function (_reason) { return { ok: true, value: { mode: 'rem' } }; },
    requestDormant: async function () { return { ok: true, value: { mode: 'dormant' } }; },
    getMetrics: function () { return { mode: 'passive', active_sessions_count: 0 }; },
  }, overrides || {});
}

function createMockSessionManager(overrides) {
  return Object.assign({
    getState: function () { return { state: 'passive', triplet_id: 'abc1234' }; },
    start: async function () { return { ok: true, value: { state: 'starting' } }; },
    upgrade: async function () { return { ok: true, value: { state: 'active' } }; },
    degrade: async function () { return { ok: true, value: { state: 'passive' } }; },
    stop: async function () { return { ok: true, value: { state: 'stopped' } }; },
    transitionToRem: async function () { return { ok: true, value: { state: 'rem_processing' } }; },
    completeRem: async function () { return { ok: true, value: { state: 'stopped' } }; },
    initShutdown: async function () { return { ok: true, value: {} }; },
    setRelayUrl: function (_url) {},
  }, overrides || {});
}

function createMockRemConsolidator(overrides) {
  return Object.assign({
    handleTier3: async function (_ctx) { return { ok: true, value: {} }; },
  }, overrides || {});
}

function createMockContextManager(overrides) {
  return Object.assign({
    persistWarmStart: async function () { return { ok: true, value: {} }; },
    getSessionSnapshot: function () { return {}; },
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// Tests: createStartHandler
// ---------------------------------------------------------------------------

describe('createStartHandler', function () {
  const { createStartHandler } = require('../components/cli/start.cjs');

  it('returns a frozen object with a handle function', function () {
    const handler = createStartHandler({});
    expect(Object.isFrozen(handler)).toBe(true);
    expect(typeof handler.handle).toBe('function');
  });

  it('returns err NOT_INITIALIZED when modeManager is null', async function () {
    const handler = createStartHandler({ modeManager: null, sessionManager: null });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NOT_INITIALIZED');
    expect(result.error.message).toContain('bun bin/dynamo.cjs');
  });

  it('returns ok with changed=false when already active', async function () {
    const mm = createMockModeManager({ getMode: function () { return 'active'; } });
    const sm = createMockSessionManager({ getState: function () { return { state: 'active', triplet_id: 'abc1234' }; } });
    const handler = createStartHandler({ modeManager: mm, sessionManager: sm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(result.value.json.changed).toBe(false);
    expect(result.value.json.mode).toBe('active');
    expect(result.value.human).toContain('already');
    expect(typeof result.value.raw).toBe('string');
  });

  it('calls requestActive when mode is passive and returns ok with changed=true', async function () {
    let requestActiveCalled = false;
    const mm = createMockModeManager({
      getMode: function () { return 'passive'; },
      requestActive: async function () { requestActiveCalled = true; return { ok: true, value: { mode: 'active', changed: true } }; },
    });
    const sm = createMockSessionManager({ getState: function () { return { state: 'passive', triplet_id: 'def5678' }; } });
    const handler = createStartHandler({ modeManager: mm, sessionManager: sm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(requestActiveCalled).toBe(true);
    expect(result.value.json.changed).toBe(true);
    expect(result.value.json.mode).toBe('active');
    expect(typeof result.value.raw).toBe('string');
  });

  it('calls sessionManager.start() then requestActive when mode is dormant', async function () {
    let startCalled = false;
    let requestActiveCalled = false;
    const mm = createMockModeManager({
      getMode: function () { return 'dormant'; },
      requestActive: async function () { requestActiveCalled = true; return { ok: true, value: { mode: 'active', changed: true } }; },
    });
    const sm = createMockSessionManager({
      getState: function () { return { state: 'dormant', triplet_id: 'ghi9012' }; },
      start: async function () { startCalled = true; return { ok: true, value: { state: 'starting' } }; },
    });
    const handler = createStartHandler({ modeManager: mm, sessionManager: sm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(startCalled).toBe(true);
    expect(requestActiveCalled).toBe(true);
    expect(result.value.json.changed).toBe(true);
  });

  it('calls sessionManager.start() first when mode is passive but session is uninitialized (cold start)', async function () {
    let startCalled = false;
    let requestActiveCalled = false;
    const mm = createMockModeManager({
      getMode: function () { return 'passive'; },
      requestActive: async function () { requestActiveCalled = true; return { ok: true, value: { mode: 'active', changed: true } }; },
    });
    const sm = createMockSessionManager({
      getState: function () { return { state: 'uninitialized', triplet_id: null }; },
      start: async function () { startCalled = true; return { ok: true, value: { state: 'starting' } }; },
    });
    const handler = createStartHandler({ modeManager: mm, sessionManager: sm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(startCalled).toBe(true);
    expect(requestActiveCalled).toBe(true);
    expect(result.value.json.changed).toBe(true);
  });

  it('returns ok with changed=false when mode is rem', async function () {
    const mm = createMockModeManager({ getMode: function () { return 'rem'; } });
    const sm = createMockSessionManager();
    const handler = createStartHandler({ modeManager: mm, sessionManager: sm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(result.value.json.changed).toBe(false);
    expect(result.value.json.mode).toBe('rem');
    expect(result.value.human).toContain('consolidating');
    expect(result.value.human).toContain('bun bin/dynamo.cjs');
  });

  it('returns err UPGRADE_FAILED when requestActive fails', async function () {
    const mm = createMockModeManager({
      getMode: function () { return 'passive'; },
      requestActive: async function () { return { ok: false, error: { code: 'MODE_ERR', message: 'test failure' } }; },
    });
    const sm = createMockSessionManager();
    const handler = createStartHandler({ modeManager: mm, sessionManager: sm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('UPGRADE_FAILED');
    expect(result.error.message).toContain('bun bin/dynamo.cjs');
  });

  it('includes human/json/raw triple on all ok results', async function () {
    const mm = createMockModeManager({ getMode: function () { return 'active'; } });
    const sm = createMockSessionManager({ getState: function () { return { state: 'active', triplet_id: 'xyz' }; } });
    const handler = createStartHandler({ modeManager: mm, sessionManager: sm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(typeof result.value.human).toBe('string');
    expect(typeof result.value.json).toBe('object');
    expect(typeof result.value.raw).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Tests: createStopHandler
// ---------------------------------------------------------------------------

describe('createStopHandler', function () {
  const { createStopHandler } = require('../components/cli/stop.cjs');

  it('returns a frozen object with a handle function', function () {
    const handler = createStopHandler({});
    expect(Object.isFrozen(handler)).toBe(true);
    expect(typeof handler.handle).toBe('function');
  });

  it('returns err NOT_INITIALIZED when modeManager is null', async function () {
    const handler = createStopHandler({ modeManager: null, sessionManager: null });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NOT_INITIALIZED');
    expect(result.error.message).toContain('bun bin/dynamo.cjs');
  });

  it('returns ok with stopped=false when mode is dormant', async function () {
    const mm = createMockModeManager({ getMode: function () { return 'dormant'; } });
    const handler = createStopHandler({ modeManager: mm, sessionManager: createMockSessionManager() });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(result.value.json.stopped).toBe(false);
    expect(result.value.json.mode).toBe('dormant');
    expect(result.value.human).toContain('dormant');
  });

  it('returns ok with stopped=false when mode is rem', async function () {
    const mm = createMockModeManager({ getMode: function () { return 'rem'; } });
    const handler = createStopHandler({ modeManager: mm, sessionManager: createMockSessionManager() });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(result.value.json.stopped).toBe(false);
    expect(result.value.json.mode).toBe('rem');
    expect(result.value.human).toContain('consolidating');
  });

  it('calls requestRem and transitionToRem when mode is active', async function () {
    let requestRemCalled = false;
    let transitionToRemCalled = false;
    const mm = createMockModeManager({
      getMode: function () { return 'active'; },
      requestRem: async function (reason) { requestRemCalled = reason; return { ok: true, value: { mode: 'rem' } }; },
    });
    const sm = createMockSessionManager({
      transitionToRem: async function () { transitionToRemCalled = true; return { ok: true, value: { state: 'rem_processing' } }; },
    });
    const rc = createMockRemConsolidator();
    const cm = createMockContextManager();
    const handler = createStopHandler({ modeManager: mm, sessionManager: sm, remConsolidator: rc, contextManager: cm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(requestRemCalled).toBe('user_stop_command');
    expect(transitionToRemCalled).toBe(true);
    expect(result.value.json.rem_initiated).toBe(true);
  });

  it('calls requestRem and transitionToRem when mode is passive', async function () {
    let requestRemReason = null;
    const mm = createMockModeManager({
      getMode: function () { return 'passive'; },
      requestRem: async function (reason) { requestRemReason = reason; return { ok: true, value: { mode: 'rem' } }; },
    });
    const sm = createMockSessionManager();
    const rc = createMockRemConsolidator();
    const cm = createMockContextManager();
    const handler = createStopHandler({ modeManager: mm, sessionManager: sm, remConsolidator: rc, contextManager: cm });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(requestRemReason).toBe('user_stop_command');
    expect(result.value.json.rem_initiated).toBe(true);
  });

  it('stop resolves before remConsolidator.handleTier3 resolves (fire-and-forget)', async function () {
    let tier3Started = false;
    let tier3Resolved = false;
    const mm = createMockModeManager({ getMode: function () { return 'active'; } });
    const sm = createMockSessionManager();
    const rc = createMockRemConsolidator({
      handleTier3: function (_ctx) {
        tier3Started = true;
        return new Promise(function (resolve) {
          setTimeout(function () {
            tier3Resolved = true;
            resolve({ ok: true, value: {} });
          }, 100);
        });
      },
    });
    const cm = createMockContextManager();
    const handler = createStopHandler({ modeManager: mm, sessionManager: sm, remConsolidator: rc, contextManager: cm });
    const result = await handler.handle([], {});
    // handle() should have returned before tier3 completes
    expect(result.ok).toBe(true);
    expect(result.value.json.rem_initiated).toBe(true);
    // tier3 may have started but should NOT have resolved yet
    expect(tier3Resolved).toBe(false);
  });

  it('includes human/json/raw triple on all ok results', async function () {
    const mm = createMockModeManager({ getMode: function () { return 'dormant'; } });
    const handler = createStopHandler({ modeManager: mm, sessionManager: createMockSessionManager() });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(typeof result.value.human).toBe('string');
    expect(typeof result.value.json).toBe('object');
    expect(typeof result.value.raw).toBe('string');
  });

  it('error messages contain recovery suggestions', async function () {
    const handler = createStopHandler({ modeManager: null });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('bun bin/dynamo.cjs');
  });
});
