'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

const {
  BUDGET_PHASES,
  PHASE_THRESHOLDS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  BYTES_PER_TOKEN,
  DEFAULT_POST_COMPACTION_TOKENS,
  calculateBudgetPhase,
  createBudgetTracker,
} = require('../budget-tracker.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Budget Tracker Constants', () => {
  it('BUDGET_PHASES has 4 phases numbered 1-4', () => {
    expect(BUDGET_PHASES.FULL).toBe(1);
    expect(BUDGET_PHASES.COMPRESSED).toBe(2);
    expect(BUDGET_PHASES.REINFORCED).toBe(3);
    expect(BUDGET_PHASES.COMPACTION).toBe(4);
    expect(Object.keys(BUDGET_PHASES)).toHaveLength(4);
  });

  it('BUDGET_PHASES is frozen', () => {
    expect(Object.isFrozen(BUDGET_PHASES)).toBe(true);
  });

  it('PHASE_THRESHOLDS has research-backed values', () => {
    expect(PHASE_THRESHOLDS.COMPRESSED_AT).toBe(0.30);
    expect(PHASE_THRESHOLDS.REINFORCED_AT).toBe(0.60);
    expect(PHASE_THRESHOLDS.COMPACTION_AT).toBe(0.80);
  });

  it('PHASE_THRESHOLDS is frozen', () => {
    expect(Object.isFrozen(PHASE_THRESHOLDS)).toBe(true);
  });

  it('DEFAULT_CONTEXT_WINDOW_TOKENS is 200000', () => {
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(200000);
  });

  it('BYTES_PER_TOKEN is 4', () => {
    expect(BYTES_PER_TOKEN).toBe(4);
  });

  it('DEFAULT_POST_COMPACTION_TOKENS is 33000', () => {
    expect(DEFAULT_POST_COMPACTION_TOKENS).toBe(33000);
  });
});

// ---------------------------------------------------------------------------
// calculateBudgetPhase (pure function)
// ---------------------------------------------------------------------------

describe('calculateBudgetPhase', () => {
  // Using 800000 byte context window (200K tokens * 4 bytes/token)
  const CTX_BYTES = 800000;

  it('returns FULL (1) at 0% utilization', () => {
    expect(calculateBudgetPhase(0, CTX_BYTES)).toBe(BUDGET_PHASES.FULL);
  });

  it('returns FULL (1) just below 30% threshold', () => {
    expect(calculateBudgetPhase(239999, CTX_BYTES)).toBe(BUDGET_PHASES.FULL);
  });

  it('returns COMPRESSED (2) at exactly 30% threshold', () => {
    expect(calculateBudgetPhase(240000, CTX_BYTES)).toBe(BUDGET_PHASES.COMPRESSED);
  });

  it('returns COMPRESSED (2) between 30-60%', () => {
    expect(calculateBudgetPhase(400000, CTX_BYTES)).toBe(BUDGET_PHASES.COMPRESSED);
  });

  it('returns COMPRESSED (2) just below 60% threshold', () => {
    expect(calculateBudgetPhase(479999, CTX_BYTES)).toBe(BUDGET_PHASES.COMPRESSED);
  });

  it('returns REINFORCED (3) at exactly 60% threshold', () => {
    expect(calculateBudgetPhase(480000, CTX_BYTES)).toBe(BUDGET_PHASES.REINFORCED);
  });

  it('returns REINFORCED (3) between 60-80%', () => {
    expect(calculateBudgetPhase(600000, CTX_BYTES)).toBe(BUDGET_PHASES.REINFORCED);
  });

  it('returns REINFORCED (3) just below 80% threshold', () => {
    expect(calculateBudgetPhase(639999, CTX_BYTES)).toBe(BUDGET_PHASES.REINFORCED);
  });

  it('returns COMPACTION (4) at exactly 80% threshold', () => {
    expect(calculateBudgetPhase(640000, CTX_BYTES)).toBe(BUDGET_PHASES.COMPACTION);
  });

  it('returns COMPACTION (4) at 100% utilization', () => {
    expect(calculateBudgetPhase(800000, CTX_BYTES)).toBe(BUDGET_PHASES.COMPACTION);
  });

  it('returns COMPACTION (4) over 100% utilization', () => {
    expect(calculateBudgetPhase(900000, CTX_BYTES)).toBe(BUDGET_PHASES.COMPACTION);
  });

  it('handles different context window sizes', () => {
    // 100K tokens = 400K bytes
    expect(calculateBudgetPhase(120000, 400000)).toBe(BUDGET_PHASES.COMPRESSED); // 30%
    expect(calculateBudgetPhase(240000, 400000)).toBe(BUDGET_PHASES.REINFORCED); // 60%
    expect(calculateBudgetPhase(320000, 400000)).toBe(BUDGET_PHASES.COMPACTION); // 80%
  });
});

// ---------------------------------------------------------------------------
// createBudgetTracker (stateful factory)
// ---------------------------------------------------------------------------

describe('createBudgetTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = createBudgetTracker({ contextWindowTokens: 200000 });
  });

  it('starts at Phase 1 (FULL)', () => {
    expect(tracker.getPhase()).toBe(1);
  });

  it('starts with zero utilization', () => {
    expect(tracker.getUtilization()).toBe(0);
  });

  it('tracks bytes and returns transition info when phase changes', () => {
    // Push to 30% of 800000 = 240000 bytes
    const result = tracker.trackBytes(240000, 'user_prompt');
    expect(result.changed).toBe(true);
    expect(result.from).toBe(1);
    expect(result.to).toBe(2);
    expect(tracker.getPhase()).toBe(2);
  });

  it('returns no change when phase does not transition', () => {
    // 100 bytes is well within Phase 1
    const result = tracker.trackBytes(100, 'user_prompt');
    expect(result.changed).toBe(false);
    expect(result.from).toBe(1);
    expect(result.to).toBe(1);
  });

  it('accumulates bytes across multiple trackBytes calls', () => {
    tracker.trackBytes(120000, 'user_prompt'); // 15% - Phase 1
    expect(tracker.getPhase()).toBe(1);

    tracker.trackBytes(120000, 'tool_output'); // 30% - Phase 2
    expect(tracker.getPhase()).toBe(2);

    tracker.trackBytes(240000, 'user_prompt'); // 60% - Phase 3
    expect(tracker.getPhase()).toBe(3);
  });

  it('tracks through all phases sequentially', () => {
    // Phase 1 -> 2
    let result = tracker.trackBytes(250000, 'user_prompt');
    expect(result).toEqual({ changed: true, from: 1, to: 2 });

    // Phase 2 -> 3
    result = tracker.trackBytes(250000, 'tool_output');
    expect(result).toEqual({ changed: true, from: 2, to: 3 });

    // Phase 3 -> 4
    result = tracker.trackBytes(200000, 'user_prompt');
    expect(result).toEqual({ changed: true, from: 3, to: 4 });
  });

  it('reset sets bytes and recalculates phase', () => {
    // Push to Phase 3
    tracker.trackBytes(500000, 'user_prompt');
    expect(tracker.getPhase()).toBe(3);

    // Reset with post-compaction bytes
    tracker.reset(132000);
    // 132000 / 800000 = 16.5% -> Phase 1
    expect(tracker.getPhase()).toBe(1);
    expect(tracker.getUtilization()).toBeCloseTo(132000 / 800000);
  });

  it('reset with no argument uses DEFAULT_POST_COMPACTION_TOKENS', () => {
    tracker.trackBytes(500000, 'user_prompt');
    tracker.reset();
    const expectedBytes = DEFAULT_POST_COMPACTION_TOKENS * BYTES_PER_TOKEN;
    expect(tracker.getUtilization()).toBeCloseTo(expectedBytes / 800000);
  });

  it('reset resets turn count to 0', () => {
    tracker.incrementTurn();
    tracker.incrementTurn();
    expect(tracker.getStats().turnCount).toBe(2);

    tracker.reset(0);
    expect(tracker.getStats().turnCount).toBe(0);
  });

  it('getUtilization returns correct ratio', () => {
    tracker.trackBytes(200000, 'user_prompt');
    expect(tracker.getUtilization()).toBeCloseTo(200000 / 800000);
  });

  it('incrementTurn increases turn count', () => {
    tracker.incrementTurn();
    tracker.incrementTurn();
    tracker.incrementTurn();
    expect(tracker.getStats().turnCount).toBe(3);
  });

  it('getStats returns full state snapshot', () => {
    tracker.trackBytes(100000, 'user_prompt');
    tracker.incrementTurn();

    const stats = tracker.getStats();
    expect(stats.cumulativeBytes).toBe(100000);
    expect(stats.contextWindowBytes).toBe(800000);
    expect(stats.phase).toBe(1);
    expect(stats.utilization).toBeCloseTo(100000 / 800000);
    expect(stats.turnCount).toBe(1);
  });

  it('uses default context window tokens when none provided', () => {
    const defaultTracker = createBudgetTracker();
    expect(defaultTracker.getStats().contextWindowBytes).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS * BYTES_PER_TOKEN);
  });

  it('can skip phases if bytes jump crosses multiple thresholds', () => {
    // Jump from 0% to 65% in one call (skipping Phase 2)
    const result = tracker.trackBytes(520000, 'user_prompt');
    expect(result.changed).toBe(true);
    expect(result.from).toBe(1);
    expect(result.to).toBe(3);
    expect(tracker.getPhase()).toBe(3);
  });
});
