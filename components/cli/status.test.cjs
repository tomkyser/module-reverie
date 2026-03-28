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
});
