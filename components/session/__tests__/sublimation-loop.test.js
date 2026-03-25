'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

const {
  SUBLIMATION_DEFAULTS,
  createSublimationLoop,
} = require('../sublimation-loop.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Sublimation Loop Constants', () => {
  it('SUBLIMATION_DEFAULTS is a frozen object', () => {
    expect(Object.isFrozen(SUBLIMATION_DEFAULTS)).toBe(true);
  });

  it('SUBLIMATION_DEFAULTS has correct default values', () => {
    expect(SUBLIMATION_DEFAULTS.cycle_ms).toBe(15000);
    expect(SUBLIMATION_DEFAULTS.max_candidates_per_cycle).toBe(5);
    expect(SUBLIMATION_DEFAULTS.sensitivity_threshold).toBe(0.3);
    expect(SUBLIMATION_DEFAULTS.batch_messages).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createSublimationLoop
// ---------------------------------------------------------------------------

describe('createSublimationLoop', () => {
  let loop;

  beforeEach(() => {
    loop = createSublimationLoop();
  });

  it('returns an instance with getSystemPrompt, getCycleConfig, updateSensitivity, getState methods', () => {
    expect(typeof loop.getSystemPrompt).toBe('function');
    expect(typeof loop.getCycleConfig).toBe('function');
    expect(typeof loop.updateSensitivity).toBe('function');
    expect(typeof loop.getState).toBe('function');
  });

  it('returns an instance with recordCycle, pause, resume methods', () => {
    expect(typeof loop.recordCycle).toBe('function');
    expect(typeof loop.pause).toBe('function');
    expect(typeof loop.resume).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// getSystemPrompt
// ---------------------------------------------------------------------------

describe('getSystemPrompt', () => {
  let loop;

  beforeEach(() => {
    loop = createSublimationLoop();
  });

  it('returns a string', () => {
    const prompt = loop.getSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('includes instructions for scanning fragment index headers', () => {
    const prompt = loop.getSystemPrompt();
    expect(prompt.toLowerCase()).toContain('scan fragment index headers');
  });

  it('includes instructions for resonance scoring', () => {
    const prompt = loop.getSystemPrompt();
    expect(prompt).toContain('resonance scoring');
  });

  it('includes instructions for emitting results via Wire', () => {
    const prompt = loop.getSystemPrompt();
    expect(prompt).toContain('Wire');
  });

  it('includes instructions for triggering next cycle', () => {
    const prompt = loop.getSystemPrompt();
    expect(prompt).toContain('trigger next cycle');
  });

  it('includes the current sensitivity threshold', () => {
    const prompt = loop.getSystemPrompt();
    expect(prompt).toContain('0.3');
  });

  it('includes sublimation reference', () => {
    const prompt = loop.getSystemPrompt();
    expect(prompt).toContain('sublimation');
  });
});

// ---------------------------------------------------------------------------
// getCycleConfig
// ---------------------------------------------------------------------------

describe('getCycleConfig', () => {
  it('returns config with default values', () => {
    const loop = createSublimationLoop();
    const config = loop.getCycleConfig();
    expect(config.cycle_ms).toBe(15000);
    expect(config.max_candidates_per_cycle).toBe(5);
    expect(config.sensitivity_threshold).toBe(0.3);
    expect(config.batch_messages).toBe(true);
  });

  it('returns config with custom overrides', () => {
    const loop = createSublimationLoop({ config: { cycle_ms: 30000, sensitivity_threshold: 0.5 } });
    const config = loop.getCycleConfig();
    expect(config.cycle_ms).toBe(30000);
    expect(config.sensitivity_threshold).toBe(0.5);
    expect(config.max_candidates_per_cycle).toBe(5);
  });

  it('returns a frozen copy', () => {
    const loop = createSublimationLoop();
    const config = loop.getCycleConfig();
    expect(Object.isFrozen(config)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateSensitivity
// ---------------------------------------------------------------------------

describe('updateSensitivity', () => {
  let loop;

  beforeEach(() => {
    loop = createSublimationLoop();
  });

  it('updateSensitivity(0.7) changes threshold', () => {
    const result = loop.updateSensitivity(0.7);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0.7);
    expect(loop.getState().sensitivity_threshold).toBe(0.7);
  });

  it('updateSensitivity(-1) returns err INVALID_SENSITIVITY', () => {
    const result = loop.updateSensitivity(-1);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_SENSITIVITY');
  });

  it('updateSensitivity(1.5) returns err INVALID_SENSITIVITY', () => {
    const result = loop.updateSensitivity(1.5);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_SENSITIVITY');
  });

  it('updateSensitivity(0) is valid (minimum)', () => {
    const result = loop.updateSensitivity(0);
    expect(result.ok).toBe(true);
    expect(loop.getState().sensitivity_threshold).toBe(0);
  });

  it('updateSensitivity(1) is valid (maximum)', () => {
    const result = loop.updateSensitivity(1);
    expect(result.ok).toBe(true);
    expect(loop.getState().sensitivity_threshold).toBe(1);
  });

  it('updates the system prompt with new threshold', () => {
    loop.updateSensitivity(0.8);
    const prompt = loop.getSystemPrompt();
    expect(prompt).toContain('0.8');
  });
});

// ---------------------------------------------------------------------------
// getState
// ---------------------------------------------------------------------------

describe('getState', () => {
  it('returns initial state', () => {
    const loop = createSublimationLoop();
    const state = loop.getState();
    expect(state.cycles_completed).toBe(0);
    expect(state.last_cycle_at).toBeNull();
    expect(state.sensitivity_threshold).toBe(0.3);
    expect(state.paused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordCycle
// ---------------------------------------------------------------------------

describe('recordCycle', () => {
  it('increments cycles_completed', () => {
    const loop = createSublimationLoop();
    const result = loop.recordCycle();
    expect(result.ok).toBe(true);
    expect(result.value.cycles_completed).toBe(1);
    expect(loop.getState().cycles_completed).toBe(1);
  });

  it('sets last_cycle_at', () => {
    const loop = createSublimationLoop();
    const before = Date.now();
    loop.recordCycle();
    const after = Date.now();
    const state = loop.getState();
    expect(state.last_cycle_at).toBeGreaterThanOrEqual(before);
    expect(state.last_cycle_at).toBeLessThanOrEqual(after);
  });

  it('increments on multiple calls', () => {
    const loop = createSublimationLoop();
    loop.recordCycle();
    loop.recordCycle();
    loop.recordCycle();
    expect(loop.getState().cycles_completed).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// pause / resume
// ---------------------------------------------------------------------------

describe('pause and resume', () => {
  let loop;

  beforeEach(() => {
    loop = createSublimationLoop();
  });

  it('pause sets paused to true', () => {
    const result = loop.pause();
    expect(result.ok).toBe(true);
    expect(loop.getState().paused).toBe(true);
  });

  it('resume sets paused to false', () => {
    loop.pause();
    const result = loop.resume();
    expect(result.ok).toBe(true);
    expect(loop.getState().paused).toBe(false);
  });
});
