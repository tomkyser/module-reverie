'use strict';
const { describe, it, expect } = require('bun:test');
const { createStatusHandler } = require('./status.cjs');

describe('status command handler', function () {
  it('exports createStatusHandler factory', function () {
    expect(typeof createStatusHandler).toBe('function');
  });

  it('returns a handler with handle method', function () {
    const handler = createStatusHandler({});
    expect(typeof handler.handle).toBe('function');
  });

  it('returns result with human-readable output', async function () {
    const handler = createStatusHandler({});
    const result = await handler.handle([], {});
    // Status should still work even without dependencies (returns defaults)
    expect(result.ok).toBe(true);
    expect(result.value).toHaveProperty('human');
  });

  it('reads mode from Magnet when available', async function () {
    const mockMagnet = {
      get: function (scope, ns, key) {
        if (scope === 'module' && ns === 'reverie' && key === 'mode') return 'active';
        return null;
      },
    };
    const handler = createStatusHandler({ magnet: mockMagnet });
    const result = await handler.handle([], {});
    expect(result.ok).toBe(true);
    expect(result.value.json.mode).toBe('active');
  });
});
