'use strict';
const { describe, it, expect } = require('bun:test');
const { createStartHandler } = require('./start.cjs');

describe('start command handler', function () {
  it('exports createStartHandler factory', function () {
    expect(typeof createStartHandler).toBe('function');
  });

  it('returns a handler with handle method', function () {
    const handler = createStartHandler({});
    expect(typeof handler.handle).toBe('function');
  });

  it('returns err when no modeManager provided and handle is called', async function () {
    const handler = createStartHandler({});
    const result = await handler.handle([], {});
    expect(result.ok).toBe(false);
  });

  it('clean-start accepts magnet in context and creates handler', function () {
    const mockMagnet = {
      get: function (scope, key) {
        if (key === 'secondary_pid') return 12345;
        if (key === 'tertiary_pid') return 12346;
        if (key === 'relay_pid') return 12347;
        return null;
      },
      set: async function () {},
    };
    const mockModeManager = {
      getMode: function () { return 'passive'; },
      requestActive: async function () { return { ok: true, value: { mode: 'active', changed: true } }; },
    };
    const mockSessionManager = {
      getState: function () { return { state: 'passive', triplet_id: 'test-123', secondary: 's1', tertiary: null }; },
      start: async function () { return { ok: true, value: {} }; },
    };
    const handler = createStartHandler({ magnet: mockMagnet, modeManager: mockModeManager, sessionManager: mockSessionManager });
    expect(typeof handler.handle).toBe('function');
  });
});
