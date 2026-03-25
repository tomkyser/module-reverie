'use strict';

const { describe, it, expect } = require('bun:test');

const { computeDecay, shouldArchive, DECAY_DEFAULTS } = require('../decay.cjs');

/**
 * Helper: builds a minimal fragment object with decay and associations fields.
 * Override any fields by spreading on top.
 */
function makeFragment(overrides = {}) {
  const now = new Date();
  return {
    created: now.toISOString(),
    decay: {
      initial_weight: 0.8,
      current_weight: 0.8,
      last_accessed: now.toISOString(),
      access_count: 0,
      consolidation_count: 0,
      pinned: false,
      ...overrides.decay,
    },
    associations: {
      domains: ['programming'],
      entities: [],
      self_model_relevance: {
        identity: 0.5,
        relational: 0.5,
        conditioning: 0.5,
        ...((overrides.associations || {}).self_model_relevance || {}),
      },
      emotional_valence: 0.0,
      attention_tags: [],
      ...overrides.associations,
      // Re-apply self_model_relevance after spread to avoid being overwritten by parent spread
      ...(overrides.associations ? {
        self_model_relevance: {
          identity: 0.5,
          relational: 0.5,
          conditioning: 0.5,
          ...((overrides.associations || {}).self_model_relevance || {}),
        },
      } : {}),
    },
    ...overrides,
    // Re-apply nested overrides
    decay: {
      initial_weight: 0.8,
      current_weight: 0.8,
      last_accessed: now.toISOString(),
      access_count: 0,
      consolidation_count: 0,
      pinned: false,
      ...overrides.decay,
    },
    associations: {
      domains: ['programming'],
      entities: [],
      self_model_relevance: {
        identity: 0.5,
        relational: 0.5,
        conditioning: 0.5,
        ...((overrides.associations || {}).self_model_relevance || {}),
      },
      emotional_valence: 0.0,
      attention_tags: [],
      ...overrides.associations,
      self_model_relevance: {
        identity: 0.5,
        relational: 0.5,
        conditioning: 0.5,
        ...((overrides.associations || {}).self_model_relevance || {}),
      },
    },
  };
}

describe('Decay Function', () => {
  it('fresh fragment (0 days old) returns weight close to initial', () => {
    const fragment = makeFragment();
    const weight = computeDecay(fragment);
    // relevanceFactor = 0.5*0.3 + 0.5*0.5 + 0.5*0.2 = 0.5
    // timeDecay ~ 1.0 (0 days)
    // accessBonus = 1.0 (0 access)
    // result ~ 0.8 * 0.5 * 1.0 * 1.0 = 0.4
    expect(weight).toBeCloseTo(0.4, 1);
  });

  it('old fragment (30 days) returns significantly lower weight', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fragment = makeFragment({ created: thirtyDaysAgo.toISOString() });
    const freshWeight = computeDecay(makeFragment());
    const oldWeight = computeDecay(fragment);
    expect(oldWeight).toBeLessThan(freshWeight);
    expect(oldWeight).toBeLessThan(0.3); // Should be noticeably decayed
  });

  it('fragment with high access count decays slower', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const baseFragment = makeFragment({
      created: tenDaysAgo.toISOString(),
      decay: {
        initial_weight: 0.8,
        current_weight: 0.8,
        last_accessed: new Date().toISOString(),
        access_count: 0,
        consolidation_count: 0,
        pinned: false,
      },
    });
    const accessedFragment = makeFragment({
      created: tenDaysAgo.toISOString(),
      decay: {
        initial_weight: 0.8,
        current_weight: 0.8,
        last_accessed: new Date().toISOString(),
        access_count: 50,
        consolidation_count: 0,
        pinned: false,
      },
    });

    const baseWeight = computeDecay(baseFragment);
    const accessedWeight = computeDecay(accessedFragment);
    expect(accessedWeight).toBeGreaterThan(baseWeight);
  });

  it('fragment with high consolidation count decays slower', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const baseFragment = makeFragment({
      created: tenDaysAgo.toISOString(),
      decay: {
        initial_weight: 0.8,
        current_weight: 0.8,
        last_accessed: new Date().toISOString(),
        access_count: 0,
        consolidation_count: 0,
        pinned: false,
      },
    });
    const consolidatedFragment = makeFragment({
      created: tenDaysAgo.toISOString(),
      decay: {
        initial_weight: 0.8,
        current_weight: 0.8,
        last_accessed: new Date().toISOString(),
        access_count: 0,
        consolidation_count: 5,
        pinned: false,
      },
    });

    const baseWeight = computeDecay(baseFragment);
    const consolidatedWeight = computeDecay(consolidatedFragment);
    expect(consolidatedWeight).toBeGreaterThan(baseWeight);
  });

  it('fragment with high identity relevance decays slower than low', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const lowRelevance = makeFragment({
      created: tenDaysAgo.toISOString(),
      associations: {
        self_model_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 },
      },
    });
    const highRelevance = makeFragment({
      created: tenDaysAgo.toISOString(),
      associations: {
        self_model_relevance: { identity: 1.0, relational: 0.1, conditioning: 0.1 },
      },
    });

    const lowWeight = computeDecay(lowRelevance);
    const highWeight = computeDecay(highRelevance);
    expect(highWeight).toBeGreaterThan(lowWeight);
  });

  it('decay is deterministic -- same inputs produce identical output', () => {
    const fixedDate = '2026-01-01T00:00:00Z';
    const fragment = makeFragment({
      created: fixedDate,
      decay: {
        initial_weight: 0.7,
        current_weight: 0.7,
        last_accessed: fixedDate,
        access_count: 3,
        consolidation_count: 1,
        pinned: false,
      },
      associations: {
        self_model_relevance: { identity: 0.6, relational: 0.4, conditioning: 0.3 },
      },
    });

    const result1 = computeDecay(fragment);
    const result2 = computeDecay(fragment);
    const result3 = computeDecay(fragment);
    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  it('custom config overrides default decay parameters', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const fragment = makeFragment({ created: tenDaysAgo.toISOString() });

    const defaultWeight = computeDecay(fragment);
    const slowDecayWeight = computeDecay(fragment, { base_decay_rate: 0.001 });
    expect(slowDecayWeight).toBeGreaterThan(defaultWeight);
  });

  it('re-exports DECAY_DEFAULTS from constants', () => {
    expect(DECAY_DEFAULTS).toBeDefined();
    expect(DECAY_DEFAULTS.base_decay_rate).toBe(0.05);
    expect(DECAY_DEFAULTS.archive_threshold).toBe(0.1);
  });
});

describe('shouldArchive', () => {
  it('returns true when computed weight is below archive threshold', () => {
    // Create a very old, unrelevant fragment
    const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const fragment = makeFragment({
      created: veryOld.toISOString(),
      decay: {
        initial_weight: 0.3,
        current_weight: 0.3,
        last_accessed: veryOld.toISOString(),
        access_count: 0,
        consolidation_count: 0,
        pinned: false,
      },
      associations: {
        self_model_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 },
      },
    });

    expect(shouldArchive(fragment)).toBe(true);
  });

  it('returns false for pinned fragments regardless of weight', () => {
    const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const fragment = makeFragment({
      created: veryOld.toISOString(),
      decay: {
        initial_weight: 0.3,
        current_weight: 0.3,
        last_accessed: veryOld.toISOString(),
        access_count: 0,
        consolidation_count: 0,
        pinned: true,
      },
      associations: {
        self_model_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 },
      },
    });

    expect(shouldArchive(fragment)).toBe(false);
  });
});
