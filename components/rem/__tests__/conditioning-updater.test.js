'use strict';

const { describe, it, expect } = require('bun:test');
const {
  createConditioningUpdater,
  emaUpdate,
  emaUpdateRecord,
} = require('../conditioning-updater.cjs');

// ---------------------------------------------------------------------------
// Pure math: emaUpdate
// ---------------------------------------------------------------------------

describe('emaUpdate', () => {
  it('computes EMA correctly: emaUpdate(0.5, 1.0, 0.15) ~= 0.575', () => {
    const result = emaUpdate(0.5, 1.0, 0.15);
    expect(Math.abs(result - 0.575)).toBeLessThan(0.001);
  });

  it('computes EMA correctly: emaUpdate(0.0, 1.0, 0.3) = 0.3', () => {
    const result = emaUpdate(0.0, 1.0, 0.3);
    expect(Math.abs(result - 0.3)).toBeLessThan(0.001);
  });

  it('returns current when alpha is 0', () => {
    expect(emaUpdate(0.7, 0.2, 0)).toBeCloseTo(0.7, 5);
  });

  it('returns session evidence when alpha is 1', () => {
    expect(emaUpdate(0.7, 0.2, 1)).toBeCloseTo(0.2, 5);
  });
});

// ---------------------------------------------------------------------------
// Pure math: emaUpdateRecord
// ---------------------------------------------------------------------------

describe('emaUpdateRecord', () => {
  it('merges current and session evidence records via EMA per key', () => {
    const current = { a: 0.5, b: 0.8 };
    const session = { a: 1.0, b: 0.0 };
    const result = emaUpdateRecord(current, session, 0.15);
    expect(Math.abs(result.a - 0.575)).toBeLessThan(0.001);
    expect(Math.abs(result.b - 0.68)).toBeLessThan(0.001);
  });

  it('handles new keys in session evidence (default current to 0.5)', () => {
    const current = { a: 0.5 };
    const session = { a: 1.0, b: 0.9 };
    const result = emaUpdateRecord(current, session, 0.15);
    expect(result.b).toBeDefined();
    // EMA(0.5, 0.9, 0.15) = 0.5 * 0.85 + 0.9 * 0.15 = 0.425 + 0.135 = 0.56
    expect(Math.abs(result.b - 0.56)).toBeLessThan(0.001);
  });

  it('handles keys only in current (unchanged)', () => {
    const current = { a: 0.5, b: 0.8 };
    const session = { a: 1.0 };
    const result = emaUpdateRecord(current, session, 0.15);
    expect(result.b).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// updateConditioning
// ---------------------------------------------------------------------------

describe('updateConditioning', () => {
  it('applies EMA to attention_biases', () => {
    const current = {
      attention_biases: { coding: 0.5, design: 0.3 },
      sublimation_sensitivity: {},
      recall_strategies: [],
      error_history: [],
    };
    const session = {
      attention_biases: { coding: 1.0 },
    };
    const updater = createConditioningUpdater({ config: { ema_alpha: 0.15 } });
    const result = updater.updateConditioning(current, session);
    // coding: EMA(0.5, 1.0, 0.15) = 0.575
    expect(Math.abs(result.attention_biases.coding - 0.575)).toBeLessThan(0.001);
    // design: not in session, unchanged
    expect(result.attention_biases.design).toBe(0.3);
  });

  it('applies EMA to sublimation_sensitivity', () => {
    const current = {
      attention_biases: {},
      sublimation_sensitivity: { pattern: 0.4 },
      recall_strategies: [],
      error_history: [],
    };
    const session = {
      sublimation_sensitivity: { pattern: 0.8 },
    };
    const updater = createConditioningUpdater({ config: { ema_alpha: 0.2 } });
    const result = updater.updateConditioning(current, session);
    // EMA(0.4, 0.8, 0.2) = 0.4*0.8 + 0.8*0.2 = 0.32 + 0.16 = 0.48
    expect(Math.abs(result.sublimation_sensitivity.pattern - 0.48)).toBeLessThan(0.001);
  });

  it('appends to recall_strategies with EMA on scores, caps at limit', () => {
    const current = {
      attention_biases: {},
      sublimation_sensitivity: {},
      recall_strategies: [
        { id: 'strat-1', score: 0.6, description: 'original' },
      ],
      error_history: [],
    };
    const session = {
      recall_strategies: [
        { id: 'strat-1', score: 0.9 },
        { id: 'strat-2', score: 0.5, description: 'new strategy' },
      ],
    };
    const updater = createConditioningUpdater({ config: { ema_alpha: 0.15, max_recall_strategies: 20 } });
    const result = updater.updateConditioning(current, session);
    // strat-1 score: EMA(0.6, 0.9, 0.15) = 0.6*0.85 + 0.9*0.15 = 0.51 + 0.135 = 0.645
    const strat1 = result.recall_strategies.find(s => s.id === 'strat-1');
    expect(strat1).toBeTruthy();
    expect(Math.abs(strat1.score - 0.645)).toBeLessThan(0.001);
    // strat-2: new entry with session score
    const strat2 = result.recall_strategies.find(s => s.id === 'strat-2');
    expect(strat2).toBeTruthy();
    expect(strat2.score).toBe(0.5);
  });

  it('appends to error_history, caps at max_error_history (50)', () => {
    const existing = Array.from({ length: 48 }, (_, i) => ({ error: `old-${i}`, ts: `t${i}` }));
    const current = {
      attention_biases: {},
      sublimation_sensitivity: {},
      recall_strategies: [],
      error_history: existing,
    };
    const session = {
      error_history: [
        { error: 'new-1', ts: 't100' },
        { error: 'new-2', ts: 't101' },
        { error: 'new-3', ts: 't102' },
      ],
    };
    const updater = createConditioningUpdater({ config: { max_error_history: 50 } });
    const result = updater.updateConditioning(current, session);
    // 48 + 3 = 51 -> trimmed to 50 from front
    expect(result.error_history.length).toBe(50);
    expect(result.error_history[result.error_history.length - 1].error).toBe('new-3');
  });
});

// ---------------------------------------------------------------------------
// enforceIdentityFloors
// ---------------------------------------------------------------------------

describe('enforceIdentityFloors', () => {
  it('clamps values below identity_floor (0.1) to identity_floor', () => {
    const identityCore = {
      personality_traits: { openness: 0.05, agreeableness: 0.8 },
      communication_style: { formality: 0.03, verbosity: 0.7 },
      value_orientations: [
        { name: 'honesty', weight: 0.02 },
        { name: 'creativity', weight: 0.5 },
      ],
    };
    const updater = createConditioningUpdater();
    const result = updater.enforceIdentityFloors(identityCore, 0.1);
    expect(result.personality_traits.openness).toBe(0.1);
    expect(result.personality_traits.agreeableness).toBe(0.8);
    expect(result.communication_style.formality).toBe(0.1);
    expect(result.communication_style.verbosity).toBe(0.7);
    expect(result.value_orientations[0].weight).toBe(0.1);
    expect(result.value_orientations[1].weight).toBe(0.5);
  });

  it('does NOT clamp conditioning fields (attention_biases etc.)', () => {
    // Conditioning fields are NOT identity core -- they should not be touched
    const identityCore = {
      personality_traits: { openness: 0.05 },
      communication_style: {},
      value_orientations: [],
    };
    const updater = createConditioningUpdater();
    const result = updater.enforceIdentityFloors(identityCore, 0.1);
    // Only identity core fields are processed
    expect(result.personality_traits.openness).toBe(0.1);
    // No conditioning keys should appear
    expect(result.attention_biases).toBeUndefined();
  });

  it('leaves values above floor unchanged', () => {
    const identityCore = {
      personality_traits: { openness: 0.9, conscientiousness: 0.5 },
      communication_style: { directness: 0.6 },
      value_orientations: [{ name: 'growth', weight: 0.8 }],
    };
    const updater = createConditioningUpdater();
    const result = updater.enforceIdentityFloors(identityCore, 0.1);
    expect(result.personality_traits.openness).toBe(0.9);
    expect(result.personality_traits.conscientiousness).toBe(0.5);
    expect(result.communication_style.directness).toBe(0.6);
    expect(result.value_orientations[0].weight).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// checkDiversityThreshold
// ---------------------------------------------------------------------------

describe('checkDiversityThreshold', () => {
  it('returns true when trait variance drops below diversity_threshold', () => {
    // All traits very similar -> low variance
    const identityCore = {
      personality_traits: { a: 0.5, b: 0.5, c: 0.5 },
      communication_style: { x: 0.5 },
      value_orientations: [{ name: 'v1', weight: 0.5 }],
    };
    const updater = createConditioningUpdater();
    const result = updater.checkDiversityThreshold(identityCore, 0.05);
    expect(result.belowThreshold).toBe(true);
    expect(result.variance).toBeLessThan(0.05);
  });

  it('returns false when trait variance is above threshold', () => {
    const identityCore = {
      personality_traits: { a: 0.1, b: 0.9 },
      communication_style: { x: 0.5 },
      value_orientations: [{ name: 'v1', weight: 0.3 }],
    };
    const updater = createConditioningUpdater();
    const result = updater.checkDiversityThreshold(identityCore, 0.01);
    expect(result.belowThreshold).toBe(false);
    expect(result.variance).toBeGreaterThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// boostUnderrepresented
// ---------------------------------------------------------------------------

describe('boostUnderrepresented', () => {
  it('increases lowest traits slightly when diversity is low', () => {
    const identityCore = {
      personality_traits: { a: 0.1, b: 0.9, c: 0.5 },
      communication_style: {},
      value_orientations: [],
    };
    const updater = createConditioningUpdater();
    const result = updater.boostUnderrepresented(identityCore, 0.02);
    // 'a' is lowest, should be boosted
    expect(result.personality_traits.a).toBeGreaterThan(0.1);
    // 'b' is highest, should not be boosted
    expect(result.personality_traits.b).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// persistConditioning
// ---------------------------------------------------------------------------

describe('persistConditioning', () => {
  it('calls selfModel.setAspect("conditioning", updatedData) and returns Result', () => {
    const mockSelfModel = {
      setAspect: (name, data) => ({ ok: true, value: data }),
    };
    const updater = createConditioningUpdater({ selfModel: mockSelfModel });
    const data = { attention_biases: { coding: 0.7 } };
    const result = updater.persistConditioning(data);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(data);
  });

  it('returns error result when selfModel is not provided', () => {
    const updater = createConditioningUpdater();
    const result = updater.persistConditioning({ attention_biases: {} });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createConditioningUpdater
// ---------------------------------------------------------------------------

describe('createConditioningUpdater', () => {
  it('returns frozen object', () => {
    const updater = createConditioningUpdater();
    expect(Object.isFrozen(updater)).toBe(true);
  });

  it('exposes expected API surface', () => {
    const updater = createConditioningUpdater();
    expect(typeof updater.updateConditioning).toBe('function');
    expect(typeof updater.enforceIdentityFloors).toBe('function');
    expect(typeof updater.checkDiversityThreshold).toBe('function');
    expect(typeof updater.boostUnderrepresented).toBe('function');
    expect(typeof updater.persistConditioning).toBe('function');
  });
});
