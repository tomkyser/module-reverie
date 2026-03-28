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
});
