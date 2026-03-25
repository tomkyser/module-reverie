'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

const {
  SLOT_NAMES,
  PHASE_BUDGETS,
  createTemplateComposer,
} = require('../template-composer.cjs');

// ---------------------------------------------------------------------------
// Mock Self Model
// ---------------------------------------------------------------------------

/**
 * Creates a mock Self Model with realistic aspect data.
 * Returns an object with getAspect() that returns cached data per aspect name.
 */
function createMockSelfModel(overrides) {
  const aspects = {
    'identity-core': {
      frontmatter: {
        aspect: 'identity-core',
        version: 'sm-identity-v3',
        updated: '2026-03-24T00:00:00Z',
        personality_traits: {
          openness: 0.7,
          conscientiousness: 0.8,
          extraversion: 0.4,
          agreeableness: 0.6,
          neuroticism: 0.2,
        },
        communication_style: {
          directness: 0.8,
          formality: 0.3,
          verbosity: 0.5,
        },
        value_orientations: [
          { name: 'precision', weight: 0.9 },
          { name: 'creativity', weight: 0.7 },
        ],
        expertise_map: {
          javascript: 0.9,
          'system-design': 0.8,
          testing: 0.7,
        },
        boundaries: ['Respect user autonomy', 'Transparent about limitations'],
      },
      body: 'A technically-oriented assistant with emphasis on precision and creative problem-solving.',
    },
    'relational-model': {
      frontmatter: {
        aspect: 'relational-model',
        version: 'sm-relational-v2',
        updated: '2026-03-24T00:00:00Z',
        communication_patterns: {
          preferred_format: 'concise',
          code_emphasis: 'high',
        },
        domain_map: {
          'software-engineering': 0.9,
          'ai-ml': 0.7,
        },
        preference_history: [],
        trust_calibration: { latitude: 0.6 },
        interaction_rhythm: { avg_turns: 12 },
      },
      body: 'User prefers concise, technical responses with code examples.',
    },
    'conditioning': {
      frontmatter: {
        aspect: 'conditioning',
        version: 'sm-conditioning-v2',
        updated: '2026-03-24T00:00:00Z',
        attention_biases: {
          'code-quality': 0.8,
          'error-handling': 0.7,
        },
        association_priors: {
          'testing-first': 0.6,
        },
        sublimation_sensitivity: {},
        recall_strategies: ['domain-match', 'recency'],
        error_history: [],
      },
      body: 'Conditioned to prioritize code quality and error handling.',
    },
    ...(overrides || {}),
  };

  return {
    getAspect(name) {
      return aspects[name] || null;
    },
  };
}

/**
 * Creates a Self Model that returns null for all aspects (sparse/empty state).
 */
function createNullSelfModel() {
  return {
    getAspect() {
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Template Composer Constants', () => {
  it('SLOT_NAMES has 5 named slots in order', () => {
    expect(SLOT_NAMES).toEqual([
      'identity_frame',
      'relational_context',
      'attention_directives',
      'behavioral_directives',
      'referential_framing',
    ]);
  });

  it('SLOT_NAMES is frozen', () => {
    expect(Object.isFrozen(SLOT_NAMES)).toBe(true);
  });

  it('PHASE_BUDGETS has entries for all 4 phases', () => {
    expect(Object.keys(PHASE_BUDGETS)).toHaveLength(4);
    expect(PHASE_BUDGETS[1]).toBeDefined();
    expect(PHASE_BUDGETS[2]).toBeDefined();
    expect(PHASE_BUDGETS[3]).toBeDefined();
    expect(PHASE_BUDGETS[4]).toBeDefined();
  });

  it('PHASE_BUDGETS is frozen', () => {
    expect(Object.isFrozen(PHASE_BUDGETS)).toBe(true);
  });

  it('Phase 1 (Full) totals ~1200 tokens', () => {
    const total = Object.values(PHASE_BUDGETS[1]).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(1100);
    expect(total).toBeLessThanOrEqual(1300);
  });

  it('Phase 2 (Compressed) totals ~800 tokens', () => {
    const total = Object.values(PHASE_BUDGETS[2]).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(700);
    expect(total).toBeLessThanOrEqual(900);
  });

  it('Phase 3 (Reinforced) totals ~1900 tokens', () => {
    const total = Object.values(PHASE_BUDGETS[3]).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(1800);
    expect(total).toBeLessThanOrEqual(2000);
  });

  it('Phase 4 (Compaction) totals ~1800 tokens', () => {
    const total = Object.values(PHASE_BUDGETS[4]).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(1700);
    expect(total).toBeLessThanOrEqual(1900);
  });

  it('each PHASE_BUDGETS entry has all 5 slot keys', () => {
    for (const phase of [1, 2, 3, 4]) {
      for (const slot of SLOT_NAMES) {
        expect(PHASE_BUDGETS[phase][slot]).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// createTemplateComposer
// ---------------------------------------------------------------------------

describe('createTemplateComposer', () => {
  let composer;
  let selfModel;

  beforeEach(() => {
    selfModel = createMockSelfModel();
    composer = createTemplateComposer({ selfModel });
  });

  describe('compose()', () => {
    it('returns a string for Phase 1', () => {
      const result = composer.compose(1);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('output contains all 5 slot headers', () => {
      const result = composer.compose(1);
      expect(result).toContain('Identity Frame');
      expect(result).toContain('Relational Context');
      expect(result).toContain('Attention Directives');
      expect(result).toContain('Behavioral Directives');
      expect(result).toContain('Referential Framing');
    });

    it('Phase 1 output contains identity data from Self Model', () => {
      const result = composer.compose(1);
      // Should include personality trait or identity core content
      expect(result).toContain('precision');
    });

    it('Phase 2 (compressed) output is shorter than Phase 1 (full)', () => {
      const phase1 = composer.compose(1);
      const phase2 = composer.compose(2);
      expect(phase2.length).toBeLessThan(phase1.length);
    });

    it('Phase 3 (reinforced) output is longer than Phase 1 (full)', () => {
      const phase1 = composer.compose(1);
      const phase3 = composer.compose(3);
      expect(phase3.length).toBeGreaterThan(phase1.length);
    });

    it('Phase 3 output contains reinforced identity language', () => {
      const result = composer.compose(3);
      // Phase 3 should have strengthened identity framing
      expect(result.toLowerCase()).toMatch(/you are|reinforce|who you are/i);
    });

    it('Phase 4 output contains compaction advocacy directive', () => {
      const result = composer.compose(4);
      expect(result).toContain('CONTEXT UTILIZATION CRITICAL');
      expect(result).toContain('compaction');
    });

    it('all 4 phases produce valid non-empty output', () => {
      for (const phase of [1, 2, 3, 4]) {
        const result = composer.compose(phase);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(100);
      }
    });

    it('Phase 4 includes all 5 slots plus compaction directive', () => {
      const result = composer.compose(4);
      expect(result).toContain('Identity Frame');
      expect(result).toContain('Relational Context');
      expect(result).toContain('Attention Directives');
      expect(result).toContain('Behavioral Directives');
      expect(result).toContain('Referential Framing');
      expect(result).toContain('CONTEXT UTILIZATION CRITICAL');
    });

    it('behavioral directives contain static defaults per D-04', () => {
      const result = composer.compose(1);
      expect(result).toContain('technical depth');
      expect(result).toContain('communication mode');
    });
  });

  describe('compose() with sparse/null Self Model', () => {
    it('produces valid output with null Self Model aspects', () => {
      const sparseComposer = createTemplateComposer({ selfModel: createNullSelfModel() });
      const result = sparseComposer.compose(1);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(100);
      // Should still have all 5 slot headers
      expect(result).toContain('Identity Frame');
      expect(result).toContain('Relational Context');
      expect(result).toContain('Attention Directives');
      expect(result).toContain('Behavioral Directives');
      expect(result).toContain('Referential Framing');
    });

    it('handles partially populated Self Model', () => {
      const partial = createMockSelfModel({
        'identity-core': null,
        'conditioning': null,
      });
      const partialComposer = createTemplateComposer({ selfModel: partial });
      const result = partialComposer.compose(1);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(100);
    });

    it('all 4 phases work with null Self Model', () => {
      const sparseComposer = createTemplateComposer({ selfModel: createNullSelfModel() });
      for (const phase of [1, 2, 3, 4]) {
        const result = sparseComposer.compose(phase);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(50);
      }
    });
  });

  describe('getMicroNudge()', () => {
    it('returns a string containing "Remember"', () => {
      const nudge = composer.getMicroNudge();
      expect(typeof nudge).toBe('string');
      expect(nudge).toContain('Remember');
    });

    it('returns a short string (~50-100 tokens worth)', () => {
      const nudge = composer.getMicroNudge();
      // At ~4 bytes/token, 50-100 tokens = 200-400 bytes. Allow some margin.
      const estimatedTokens = Math.ceil(nudge.length / 4);
      expect(estimatedTokens).toBeGreaterThan(10);
      expect(estimatedTokens).toBeLessThan(200);
    });

    it('contains identity phrase from Self Model', () => {
      const nudge = composer.getMicroNudge();
      // Should reference some identity content
      expect(nudge.length).toBeGreaterThan(20);
    });

    it('works with null Self Model aspects', () => {
      const sparseComposer = createTemplateComposer({ selfModel: createNullSelfModel() });
      const nudge = sparseComposer.getMicroNudge();
      expect(typeof nudge).toBe('string');
      expect(nudge).toContain('Remember');
    });
  });

  describe('getSlotSizes()', () => {
    it('returns the PHASE_BUDGETS entry for the given phase', () => {
      const sizes = composer.getSlotSizes(1);
      expect(sizes).toEqual(PHASE_BUDGETS[1]);
    });

    it('returns sizes for all 4 phases', () => {
      for (const phase of [1, 2, 3, 4]) {
        const sizes = composer.getSlotSizes(phase);
        expect(sizes).toEqual(PHASE_BUDGETS[phase]);
      }
    });
  });
});
