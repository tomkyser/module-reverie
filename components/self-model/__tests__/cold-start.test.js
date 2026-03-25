'use strict';

const { describe, it, expect } = require('bun:test');

// ---------------------------------------------------------------------------
// Entropy Engine Tests
// ---------------------------------------------------------------------------

describe('Entropy Engine', () => {
  it('createEntropyEngine returns object with applyVariance, getState, evolve methods', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine = createEntropyEngine({});
    expect(typeof engine.applyVariance).toBe('function');
    expect(typeof engine.getState).toBe('function');
    expect(typeof engine.evolve).toBe('function');
  });

  it('applyVariance returns modified weights with gaussian noise applied', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine = createEntropyEngine({ seed: 'test-seed-1', sigma: 0.1 });
    const weights = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5 };
    const varied = engine.applyVariance(weights);

    // At least one value should differ from original (with high probability)
    const changed = Object.keys(weights).some(k => varied[k] !== weights[k]);
    expect(changed).toBe(true);
  });

  it('variance magnitude is bounded by sigma (default 0.05)', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine = createEntropyEngine({ seed: 'test-bound', sigma: 0.05 });
    const weights = { a: 0.5, b: 0.5, c: 0.5, d: 0.5, e: 0.5 };

    // Run many times to check bounds -- all values should be in [0, 1]
    for (let i = 0; i < 100; i++) {
      const varied = engine.applyVariance(weights);
      for (const v of Object.values(varied)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('applyVariance preserves trait keys -- no keys added or removed', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine = createEntropyEngine({ seed: 'key-preserve' });
    const weights = { openness: 0.5, conscientiousness: 0.7, extraversion: 0.3 };
    const varied = engine.applyVariance(weights);

    expect(Object.keys(varied).sort()).toEqual(Object.keys(weights).sort());
  });

  it('all variance-adjusted values remain in valid range [0, 1]', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine = createEntropyEngine({ seed: 'edge-clamp', sigma: 0.15 });

    // Test at extremes
    const weights = { low: 0.01, high: 0.99, mid: 0.5 };
    for (let i = 0; i < 50; i++) {
      const varied = engine.applyVariance(weights);
      for (const v of Object.values(varied)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('two calls with same seed produce same variance (deterministic when seeded)', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine1 = createEntropyEngine({ seed: 'deterministic-test' });
    const engine2 = createEntropyEngine({ seed: 'deterministic-test' });
    const weights = { openness: 0.5, conscientiousness: 0.5 };

    const result1 = engine1.applyVariance(weights);
    const result2 = engine2.applyVariance(weights);

    expect(result1).toEqual(result2);
  });

  it('sigma is configurable via config.sigma', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine = createEntropyEngine({ sigma: 0.01, seed: 'sigma-test' });
    const state = engine.getState();
    expect(state.sigma).toBe(0.01);
  });

  it('evolve adjusts sigma based on outcome quality', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine = createEntropyEngine({ sigma: 0.05, seed: 'evolve-test' });

    // Good outcome: quality > 0.7 -> reduce sigma
    engine.evolve({ quality: 0.9 });
    const state1 = engine.getState();
    expect(state1.sigma).toBeLessThan(0.05);

    // Reset
    const engine2 = createEntropyEngine({ sigma: 0.05, seed: 'evolve-test-2' });
    // Bad outcome: quality < 0.3 -> increase sigma
    engine2.evolve({ quality: 0.1 });
    const state2 = engine2.getState();
    expect(state2.sigma).toBeGreaterThan(0.05);
  });

  it('getState returns current sigma and history for persistence', () => {
    const { createEntropyEngine } = require('../entropy-engine.cjs');
    const engine = createEntropyEngine({ sigma: 0.07, seed: 'state-test' });
    engine.evolve({ quality: 0.5 });

    const state = engine.getState();
    expect(state).toHaveProperty('sigma');
    expect(state).toHaveProperty('history');
    expect(state).toHaveProperty('sessionCount');
    expect(state.history).toBeInstanceOf(Array);
    expect(state.history.length).toBe(1);
    expect(state.sessionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cold Start Tests
// ---------------------------------------------------------------------------

describe('Cold Start', () => {
  it('createColdStartSeed returns object with identityCore, relationalModel, conditioning keys', () => {
    const { createColdStartSeed } = require('../cold-start.cjs');
    const seed = createColdStartSeed({});

    expect(seed).toHaveProperty('identityCore');
    expect(seed).toHaveProperty('relationalModel');
    expect(seed).toHaveProperty('conditioning');
  });

  it('identityCore.frontmatter has aspect=identity-core, version=sm-identity-v1', () => {
    const { createColdStartSeed } = require('../cold-start.cjs');
    const seed = createColdStartSeed({});

    expect(seed.identityCore.frontmatter.aspect).toBe('identity-core');
    expect(seed.identityCore.frontmatter.version).toBe('sm-identity-v1');
  });

  it('identityCore.body contains "Identity not yet formed"', () => {
    const { createColdStartSeed } = require('../cold-start.cjs');
    const seed = createColdStartSeed({});

    expect(seed.identityCore.body).toContain('Identity not yet formed');
  });

  it('relationalModel.frontmatter has aspect=relational-model, version=sm-relational-v1', () => {
    const { createColdStartSeed } = require('../cold-start.cjs');
    const seed = createColdStartSeed({});

    expect(seed.relationalModel.frontmatter.aspect).toBe('relational-model');
    expect(seed.relationalModel.frontmatter.version).toBe('sm-relational-v1');
  });

  it('conditioning.frontmatter has aspect=conditioning, version=sm-conditioning-v1', () => {
    const { createColdStartSeed } = require('../cold-start.cjs');
    const seed = createColdStartSeed({});

    expect(seed.conditioning.frontmatter.aspect).toBe('conditioning');
    expect(seed.conditioning.frontmatter.version).toBe('sm-conditioning-v1');
  });

  it('all three aspects validate against their respective zod schemas', () => {
    const { createColdStartSeed } = require('../cold-start.cjs');
    const { identityCoreSchema, relationalModelSchema, conditioningSchema } = require('../../../lib/schemas.cjs');

    const seed = createColdStartSeed({});

    const idResult = identityCoreSchema.safeParse(seed.identityCore.frontmatter);
    expect(idResult.success).toBe(true);

    const relResult = relationalModelSchema.safeParse(seed.relationalModel.frontmatter);
    expect(relResult.success).toBe(true);

    const condResult = conditioningSchema.safeParse(seed.conditioning.frontmatter);
    expect(condResult.success).toBe(true);
  });

  it('generateSeedFromPrompt incorporates prompt text into initial body narrative', () => {
    const { generateSeedFromPrompt } = require('../cold-start.cjs');
    const seed = generateSeedFromPrompt('I am a software engineer who prefers concise communication', {});

    expect(seed.identityCore.body).toContain('Seed prompt:');
    expect(seed.identityCore.body).toContain('software engineer');
  });

  it('cold start with entropy engine applies variance to default trait weights', () => {
    const { createColdStartSeed } = require('../cold-start.cjs');
    const { createEntropyEngine } = require('../entropy-engine.cjs');

    const entropy = createEntropyEngine({ seed: 'cold-start-entropy', sigma: 0.1 });
    const seed = createColdStartSeed({ entropy });

    // With entropy, personality traits should differ from baseline 0.5 values
    const traits = seed.identityCore.frontmatter.personality_traits;
    const changed = Object.values(traits).some(v => v !== 0.5 && v !== 0.3);
    expect(changed).toBe(true);
  });

  it('cold start without entropy engine produces baseline defaults', () => {
    const { createColdStartSeed } = require('../cold-start.cjs');
    const seed = createColdStartSeed({});

    const traits = seed.identityCore.frontmatter.personality_traits;
    // Baseline values per spec
    expect(traits.openness).toBe(0.5);
    expect(traits.conscientiousness).toBe(0.5);
    expect(traits.extraversion).toBe(0.5);
    expect(traits.agreeableness).toBe(0.5);
    expect(traits.neuroticism).toBe(0.3);
  });
});
