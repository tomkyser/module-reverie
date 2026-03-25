'use strict';

/**
 * Spec Compliance Tests: Fragment Schema, Types, Decay, Association Index, Source Reference
 *
 * Audits spec sections 3.1-3.5, 3.8-3.9, 3.11 against implementing code.
 * Every test maps to a specific spec requirement with hand-computed verification
 * where applicable.
 *
 * @see reverie-spec-v2.md sections 3.1-3.5, 3.8-3.9, 3.11
 * @module reverie/validation/spec-fragments.test
 */

const { describe, it, expect } = require('bun:test');

const {
  baseFragmentSchema,
  temporalSchema,
  decaySchema,
  associationsSchema,
  selfModelRelevanceSchema,
  sourceLocatorSchema,
  pointersSchema,
  formationSchema,
  experientialFragment,
  metaRecallFragment,
  sublimationFragment,
  consolidationFragment,
  sourceReferenceFragment,
  validateFragment,
} = require('../lib/schemas.cjs');

const {
  FRAGMENT_TYPES,
  DECAY_DEFAULTS,
  FRAGMENT_ID_PATTERN,
} = require('../lib/constants.cjs');

const { computeDecay, shouldArchive } = require('../components/fragments/decay.cjs');
const { createAssociationIndex } = require('../components/fragments/association-index.cjs');

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/**
 * Creates a valid fragment frontmatter object matching spec 3.3 example.
 * All fields are populated with spec-compliant values.
 */
function createValidFragment(overrides = {}) {
  return {
    id: 'frag-2026-03-22-a7f3b2c1',
    type: 'experiential',
    created: '2026-03-22T14:30:00Z',
    source_session: 'session-2026-03-22-001',
    self_model_version: 'sm-v47',
    formation_group: 'fg-2026-03-22-a7f3b200',
    formation_frame: 'interpersonal',
    sibling_fragments: ['frag-2026-03-22-a7f3b2c2', 'frag-2026-03-22-a7f3b2c3'],
    temporal: {
      absolute: '2026-03-22T14:30:00Z',
      session_relative: 0.35,
      sequence: 127,
    },
    decay: {
      initial_weight: 0.85,
      current_weight: 0.72,
      last_accessed: '2026-03-22T16:00:00Z',
      access_count: 3,
      consolidation_count: 1,
      pinned: false,
    },
    associations: {
      domains: ['engineering', 'interpersonal'],
      entities: ['project-atlas', 'user-frustration-pattern'],
      self_model_relevance: {
        identity: 0.2,
        relational: 0.7,
        conditioning: 0.4,
      },
      emotional_valence: -0.3,
      attention_tags: ['deadline-pressure', 'communication-breakdown'],
    },
    pointers: {
      causal_antecedents: ['frag-2026-03-20-b1c2d3e4'],
      causal_consequents: [],
      thematic_siblings: ['frag-2026-03-15-c3d4e5f6'],
      contradictions: [],
      meta_recalls: [],
      source_fragments: [],
    },
    formation: {
      trigger: 'user expressed frustration about project timeline',
      attention_pointer: 'deadline management under resource constraints',
      active_domains_at_formation: ['engineering', 'interpersonal', 'project-management'],
      sublimation_that_prompted: null,
    },
    ...overrides,
  };
}

// =========================================================================
// Spec 3.3: Fragment Schema
// =========================================================================

describe('Spec 3.3: Fragment Schema', () => {

  describe('Required fields', () => {
    it('accepts valid fragment with all required fields', () => {
      const frag = createValidFragment();
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(true);
    });

    it('requires id field', () => {
      const frag = createValidFragment();
      delete frag.id;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('validates id matches frag-YYYY-MM-DD-hex8 pattern', () => {
      const frag = createValidFragment({ id: 'invalid-id' });
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('accepts valid id format frag-YYYY-MM-DD-hex8', () => {
      const frag = createValidFragment({ id: 'frag-2026-03-22-abcd1234' });
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(true);
    });

    it('requires type field', () => {
      const frag = createValidFragment();
      delete frag.type;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires created field', () => {
      const frag = createValidFragment();
      delete frag.created;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires source_session field', () => {
      const frag = createValidFragment();
      delete frag.source_session;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires self_model_version field', () => {
      const frag = createValidFragment();
      delete frag.self_model_version;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });
  });

  describe('Fan-out fields', () => {
    it('requires formation_group field', () => {
      const frag = createValidFragment();
      delete frag.formation_group;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires formation_frame field', () => {
      const frag = createValidFragment();
      delete frag.formation_frame;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires sibling_fragments array', () => {
      const frag = createValidFragment();
      delete frag.sibling_fragments;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('accepts empty sibling_fragments array', () => {
      const frag = createValidFragment({ sibling_fragments: [] });
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(true);
    });
  });

  describe('Temporal fields', () => {
    it('requires temporal object', () => {
      const frag = createValidFragment();
      delete frag.temporal;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires temporal.absolute', () => {
      const result = temporalSchema.safeParse({
        session_relative: 0.35,
        sequence: 127,
      });
      expect(result.success).toBe(false);
    });

    it('requires session_relative between 0.0 and 1.0', () => {
      const result = temporalSchema.safeParse({
        absolute: '2026-03-22T14:30:00Z',
        session_relative: 1.5,
        sequence: 127,
      });
      expect(result.success).toBe(false);
    });

    it('accepts session_relative at boundaries (0.0 and 1.0)', () => {
      const atZero = temporalSchema.safeParse({
        absolute: '2026-03-22T14:30:00Z',
        session_relative: 0.0,
        sequence: 0,
      });
      expect(atZero.success).toBe(true);

      const atOne = temporalSchema.safeParse({
        absolute: '2026-03-22T14:30:00Z',
        session_relative: 1.0,
        sequence: 100,
      });
      expect(atOne.success).toBe(true);
    });

    it('requires sequence to be a non-negative integer (monotonic)', () => {
      const negative = temporalSchema.safeParse({
        absolute: '2026-03-22T14:30:00Z',
        session_relative: 0.35,
        sequence: -1,
      });
      expect(negative.success).toBe(false);

      const decimal = temporalSchema.safeParse({
        absolute: '2026-03-22T14:30:00Z',
        session_relative: 0.35,
        sequence: 3.5,
      });
      expect(decimal.success).toBe(false);
    });
  });

  describe('Decay fields', () => {
    it('requires decay object', () => {
      const frag = createValidFragment();
      delete frag.decay;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires initial_weight between 0.0 and 1.0', () => {
      const over = decaySchema.safeParse({
        initial_weight: 1.5,
        current_weight: 0.72,
        last_accessed: '2026-03-22T16:00:00Z',
        access_count: 3,
        consolidation_count: 1,
        pinned: false,
      });
      expect(over.success).toBe(false);
    });

    it('requires current_weight between 0.0 and 1.0', () => {
      const under = decaySchema.safeParse({
        initial_weight: 0.85,
        current_weight: -0.1,
        last_accessed: '2026-03-22T16:00:00Z',
        access_count: 3,
        consolidation_count: 1,
        pinned: false,
      });
      expect(under.success).toBe(false);
    });

    it('requires access_count as non-negative integer', () => {
      const result = decaySchema.safeParse({
        initial_weight: 0.85,
        current_weight: 0.72,
        last_accessed: '2026-03-22T16:00:00Z',
        access_count: -1,
        consolidation_count: 1,
        pinned: false,
      });
      expect(result.success).toBe(false);
    });

    it('requires consolidation_count as non-negative integer', () => {
      const result = decaySchema.safeParse({
        initial_weight: 0.85,
        current_weight: 0.72,
        last_accessed: '2026-03-22T16:00:00Z',
        access_count: 3,
        consolidation_count: -2,
        pinned: false,
      });
      expect(result.success).toBe(false);
    });

    it('requires pinned as boolean', () => {
      const result = decaySchema.safeParse({
        initial_weight: 0.85,
        current_weight: 0.72,
        last_accessed: '2026-03-22T16:00:00Z',
        access_count: 3,
        consolidation_count: 1,
        pinned: 'true',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Association fields', () => {
    it('requires associations object', () => {
      const frag = createValidFragment();
      delete frag.associations;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires domains as string array', () => {
      const result = associationsSchema.safeParse({
        domains: [123],
        entities: [],
        self_model_relevance: { identity: 0.2, relational: 0.7, conditioning: 0.4 },
        emotional_valence: 0,
        attention_tags: [],
      });
      expect(result.success).toBe(false);
    });

    it('requires entities as string array', () => {
      const result = associationsSchema.safeParse({
        domains: [],
        entities: 'not-an-array',
        self_model_relevance: { identity: 0.2, relational: 0.7, conditioning: 0.4 },
        emotional_valence: 0,
        attention_tags: [],
      });
      expect(result.success).toBe(false);
    });

    it('requires self_model_relevance with identity, relational, conditioning (all 0.0-1.0)', () => {
      const missing = selfModelRelevanceSchema.safeParse({
        identity: 0.2,
        relational: 0.7,
      });
      expect(missing.success).toBe(false);

      const outOfRange = selfModelRelevanceSchema.safeParse({
        identity: 1.5,
        relational: 0.7,
        conditioning: 0.4,
      });
      expect(outOfRange.success).toBe(false);
    });

    it('requires emotional_valence between -1.0 and 1.0', () => {
      const over = associationsSchema.safeParse({
        domains: [],
        entities: [],
        self_model_relevance: { identity: 0.2, relational: 0.7, conditioning: 0.4 },
        emotional_valence: 1.5,
        attention_tags: [],
      });
      expect(over.success).toBe(false);

      const under = associationsSchema.safeParse({
        domains: [],
        entities: [],
        self_model_relevance: { identity: 0.2, relational: 0.7, conditioning: 0.4 },
        emotional_valence: -1.5,
        attention_tags: [],
      });
      expect(under.success).toBe(false);
    });

    it('accepts emotional_valence at boundaries (-1.0 and 1.0)', () => {
      const neg = associationsSchema.safeParse({
        domains: [],
        entities: [],
        self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        emotional_valence: -1.0,
        attention_tags: [],
      });
      expect(neg.success).toBe(true);

      const pos = associationsSchema.safeParse({
        domains: [],
        entities: [],
        self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        emotional_valence: 1.0,
        attention_tags: [],
      });
      expect(pos.success).toBe(true);
    });

    it('requires attention_tags as string array', () => {
      const result = associationsSchema.safeParse({
        domains: [],
        entities: [],
        self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        emotional_valence: 0,
        attention_tags: [42],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Source locator fields (spec 3.3 / 3.11)', () => {
    it('source_locator is optional on base schema', () => {
      const frag = createValidFragment();
      delete frag.source_locator;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(true);
    });

    it('validates source_locator type enum: file, url, inline', () => {
      const valid = sourceLocatorSchema.safeParse({
        type: 'file',
        path: '/home/user/docs/atlas.md',
        url: null,
        content_hash: null,
        last_verified: '2026-03-22T14:30:00Z',
      });
      expect(valid.success).toBe(true);

      const invalid = sourceLocatorSchema.safeParse({
        type: 'database',
        path: null,
        url: null,
        content_hash: null,
        last_verified: '2026-03-22T14:30:00Z',
      });
      expect(invalid.success).toBe(false);
    });

    it('accepts all three source_locator types', () => {
      for (const locType of ['file', 'url', 'inline']) {
        const result = sourceLocatorSchema.safeParse({
          type: locType,
          path: locType === 'file' ? '/some/path' : null,
          url: locType === 'url' ? 'https://example.com' : null,
          content_hash: locType === 'inline' ? 'abc123' : null,
          last_verified: '2026-03-22T14:30:00Z',
        });
        expect(result.success).toBe(true);
      }
    });

    it('requires last_verified timestamp', () => {
      const result = sourceLocatorSchema.safeParse({
        type: 'file',
        path: '/home/user/docs/atlas.md',
        url: null,
        content_hash: null,
      });
      expect(result.success).toBe(false);
    });

    it('allows nullable path, url, content_hash', () => {
      const result = sourceLocatorSchema.safeParse({
        type: 'file',
        path: null,
        url: null,
        content_hash: null,
        last_verified: '2026-03-22T14:30:00Z',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Pointer fields', () => {
    it('requires pointers object', () => {
      const frag = createValidFragment();
      delete frag.pointers;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires all six pointer arrays', () => {
      const pointerKeys = [
        'causal_antecedents',
        'causal_consequents',
        'thematic_siblings',
        'contradictions',
        'meta_recalls',
        'source_fragments',
      ];
      for (const key of pointerKeys) {
        const partial = { ...createValidFragment().pointers };
        delete partial[key];
        const result = pointersSchema.safeParse(partial);
        expect(result.success).toBe(false);
      }
    });

    it('accepts empty pointer arrays', () => {
      const result = pointersSchema.safeParse({
        causal_antecedents: [],
        causal_consequents: [],
        thematic_siblings: [],
        contradictions: [],
        meta_recalls: [],
        source_fragments: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts populated pointer arrays with string IDs', () => {
      const result = pointersSchema.safeParse({
        causal_antecedents: ['frag-2026-03-20-b1c2d3e4'],
        causal_consequents: ['frag-2026-03-21-e5f6a7b8'],
        thematic_siblings: ['frag-2026-03-15-c3d4e5f6'],
        contradictions: ['frag-2026-03-10-d4e5f6a7'],
        meta_recalls: ['frag-2026-03-22-f6a7b8c9'],
        source_fragments: ['frag-2026-03-18-a8b9c0d1'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Formation fields', () => {
    it('requires formation object', () => {
      const frag = createValidFragment();
      delete frag.formation;
      const result = baseFragmentSchema.safeParse(frag);
      expect(result.success).toBe(false);
    });

    it('requires trigger string', () => {
      const result = formationSchema.safeParse({
        attention_pointer: 'some pointer',
        active_domains_at_formation: ['engineering'],
        sublimation_that_prompted: null,
      });
      expect(result.success).toBe(false);
    });

    it('requires attention_pointer string', () => {
      const result = formationSchema.safeParse({
        trigger: 'some trigger',
        active_domains_at_formation: ['engineering'],
        sublimation_that_prompted: null,
      });
      expect(result.success).toBe(false);
    });

    it('requires active_domains_at_formation array', () => {
      const result = formationSchema.safeParse({
        trigger: 'some trigger',
        attention_pointer: 'some pointer',
        sublimation_that_prompted: null,
      });
      expect(result.success).toBe(false);
    });

    it('accepts sublimation_that_prompted as nullable', () => {
      const withNull = formationSchema.safeParse({
        trigger: 'some trigger',
        attention_pointer: 'some pointer',
        active_domains_at_formation: ['engineering'],
        sublimation_that_prompted: null,
      });
      expect(withNull.success).toBe(true);

      const withValue = formationSchema.safeParse({
        trigger: 'some trigger',
        attention_pointer: 'some pointer',
        active_domains_at_formation: ['engineering'],
        sublimation_that_prompted: 'frag-2026-03-22-a6e2b1c0',
      });
      expect(withValue.success).toBe(true);
    });
  });

  describe('Full schema round-trip (spec 3.3 example)', () => {
    it('validates the exact spec 3.3 example values', () => {
      const specExample = createValidFragment();
      const result = validateFragment(specExample);
      expect(result.ok).toBe(true);
      expect(result.value.id).toBe('frag-2026-03-22-a7f3b2c1');
    });

    it('rejects fragment with extra unknown type', () => {
      const result = validateFragment({ ...createValidFragment(), type: 'dream' });
      expect(result.ok).toBe(false);
    });

    it('rejects null input', () => {
      const result = validateFragment(null);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_INPUT');
    });
  });
});

// =========================================================================
// Spec 3.5: Fragment Types
// =========================================================================

describe('Spec 3.5: Fragment Types', () => {
  it('defines exactly 5 fragment types per spec', () => {
    expect(FRAGMENT_TYPES).toHaveLength(5);
  });

  it('includes experiential type', () => {
    expect(FRAGMENT_TYPES).toContain('experiential');
  });

  it('includes meta-recall type', () => {
    expect(FRAGMENT_TYPES).toContain('meta-recall');
  });

  it('includes sublimation type', () => {
    expect(FRAGMENT_TYPES).toContain('sublimation');
  });

  it('includes consolidation type', () => {
    expect(FRAGMENT_TYPES).toContain('consolidation');
  });

  it('includes source-reference type', () => {
    expect(FRAGMENT_TYPES).toContain('source-reference');
  });

  it('rejects unknown type value', () => {
    const frag = createValidFragment({ type: 'unknown' });
    const result = validateFragment(frag);
    expect(result.ok).toBe(false);
  });

  it('rejects empty string type', () => {
    const frag = createValidFragment({ type: '' });
    const result = validateFragment(frag);
    expect(result.ok).toBe(false);
  });

  describe('Type-specific schemas', () => {
    it('experiential: validates successfully', () => {
      const frag = createValidFragment({ type: 'experiential' });
      const result = experientialFragment.safeParse(frag);
      expect(result.success).toBe(true);
    });

    it('meta-recall: requires source_fragments in pointers', () => {
      const frag = createValidFragment({
        type: 'meta-recall',
        pointers: {
          ...createValidFragment().pointers,
          source_fragments: [],
        },
      });
      const result = validateFragment(frag);
      expect(result.ok).toBe(false);

      const fragWithSources = createValidFragment({
        type: 'meta-recall',
        pointers: {
          ...createValidFragment().pointers,
          source_fragments: ['frag-2026-03-20-b1c2d3e4'],
        },
      });
      const resultOk = validateFragment(fragWithSources);
      expect(resultOk.ok).toBe(true);
    });

    it('sublimation: validates successfully', () => {
      const frag = createValidFragment({ type: 'sublimation' });
      const result = sublimationFragment.safeParse(frag);
      expect(result.success).toBe(true);
    });

    it('consolidation: validates successfully', () => {
      const frag = createValidFragment({ type: 'consolidation' });
      const result = consolidationFragment.safeParse(frag);
      expect(result.success).toBe(true);
    });

    it('source-reference: requires source_locator', () => {
      const fragNoLocator = createValidFragment({
        type: 'source-reference',
      });
      delete fragNoLocator.source_locator;
      const result = validateFragment(fragNoLocator);
      expect(result.ok).toBe(false);

      const fragWithLocator = createValidFragment({
        type: 'source-reference',
        source_locator: {
          type: 'file',
          path: '/home/user/docs/atlas-requirements.md',
          url: null,
          content_hash: null,
          last_verified: '2026-03-22T14:30:00Z',
        },
      });
      const resultOk = validateFragment(fragWithLocator);
      expect(resultOk.ok).toBe(true);
    });
  });
});

// =========================================================================
// Spec 3.9: Decay Function
// =========================================================================

describe('Spec 3.9: Decay Function', () => {
  /**
   * Hand-computes the expected decay weight per spec formula:
   *   current_weight = initial_weight * relevance_factor * time_decay * access_bonus
   *
   * where:
   *   lambda = base_decay_rate / (1 + consolidation_count * consolidation_protection)
   *   time_decay = exp(-lambda * days_since_creation)
   *   access_bonus = 1 + (log(1 + access_count) * access_weight)
   *   relevance_factor = weighted_sum(identity, relational, conditioning)
   */
  function handCompute(params) {
    const {
      initial_weight,
      daysSinceCreation,
      access_count,
      consolidation_count,
      identity,
      relational,
      conditioning,
      base_decay_rate = DECAY_DEFAULTS.base_decay_rate,
      consolidation_protection = DECAY_DEFAULTS.consolidation_protection,
      access_weight = DECAY_DEFAULTS.access_weight,
      relevance_weights = DECAY_DEFAULTS.relevance_weights,
    } = params;

    const lambda = base_decay_rate / (1 + consolidation_count * consolidation_protection);
    const timeDecay = Math.exp(-lambda * daysSinceCreation);
    const accessBonus = 1 + (Math.log(1 + access_count) * access_weight);
    const relevanceFactor = (identity * relevance_weights.identity) +
                            (relational * relevance_weights.relational) +
                            (conditioning * relevance_weights.conditioning);

    return initial_weight * relevanceFactor * timeDecay * accessBonus;
  }

  /**
   * Creates a fragment with `created` set to `daysAgo` days before now.
   */
  function createDecayFragment(daysAgo, overrides = {}) {
    const created = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    return {
      created,
      decay: {
        initial_weight: 0.85,
        current_weight: 0.72,
        last_accessed: created,
        access_count: 0,
        consolidation_count: 0,
        pinned: false,
        ...overrides.decay,
      },
      associations: {
        self_model_relevance: {
          identity: 0.5,
          relational: 0.5,
          conditioning: 0.5,
          ...overrides.relevance,
        },
      },
    };
  }

  it('matches spec formula at t=0 (no time decay)', () => {
    const frag = createDecayFragment(0, {
      decay: { initial_weight: 1.0, access_count: 0, consolidation_count: 0, pinned: false },
      relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
    });

    const result = computeDecay(frag);
    const expected = handCompute({
      initial_weight: 1.0,
      daysSinceCreation: 0,
      access_count: 0,
      consolidation_count: 0,
      identity: 0.5,
      relational: 0.5,
      conditioning: 0.5,
    });

    // At t=0: time_decay=1, access_bonus=1, relevance_factor = 0.5*0.3 + 0.5*0.5 + 0.5*0.2 = 0.5
    // So: 1.0 * 0.5 * 1.0 * 1.0 = 0.5
    expect(expected).toBeCloseTo(0.5, 5);
    expect(result).toBeCloseTo(expected, 3);
  });

  it('applies time_decay correctly at t=7 days', () => {
    const frag = createDecayFragment(7, {
      decay: { initial_weight: 1.0, access_count: 0, consolidation_count: 0, pinned: false },
      relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
    });

    const result = computeDecay(frag);

    // lambda = 0.05 / (1 + 0) = 0.05
    // time_decay = exp(-0.05 * 7) = exp(-0.35) ~ 0.70469
    // relevance_factor = 0.5
    // access_bonus = 1
    // expected = 1.0 * 0.5 * exp(-0.35) * 1.0
    const expected = handCompute({
      initial_weight: 1.0,
      daysSinceCreation: 7,
      access_count: 0,
      consolidation_count: 0,
      identity: 0.5,
      relational: 0.5,
      conditioning: 0.5,
    });

    expect(expected).toBeCloseTo(0.5 * Math.exp(-0.35), 5);
    expect(result).toBeCloseTo(expected, 2);
  });

  it('consolidation_count=2 reduces lambda (slower decay)', () => {
    const fragNoConsolidation = createDecayFragment(7, {
      decay: { initial_weight: 1.0, access_count: 0, consolidation_count: 0, pinned: false },
      relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
    });

    const fragWithConsolidation = createDecayFragment(7, {
      decay: { initial_weight: 1.0, access_count: 0, consolidation_count: 2, pinned: false },
      relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
    });

    const resultNo = computeDecay(fragNoConsolidation);
    const resultWith = computeDecay(fragWithConsolidation);

    // With consolidation: lambda = 0.05 / (1 + 2*0.3) = 0.05/1.6 = 0.03125
    // Without: lambda = 0.05
    // Consolidated fragment should have higher weight (less decay)
    expect(resultWith).toBeGreaterThan(resultNo);

    const expectedWith = handCompute({
      initial_weight: 1.0,
      daysSinceCreation: 7,
      access_count: 0,
      consolidation_count: 2,
      identity: 0.5,
      relational: 0.5,
      conditioning: 0.5,
    });
    expect(resultWith).toBeCloseTo(expectedWith, 2);
  });

  it('access_count=5 increases access_bonus', () => {
    const fragNoAccess = createDecayFragment(0, {
      decay: { initial_weight: 1.0, access_count: 0, consolidation_count: 0, pinned: false },
      relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
    });

    const fragWithAccess = createDecayFragment(0, {
      decay: { initial_weight: 1.0, access_count: 5, consolidation_count: 0, pinned: false },
      relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
    });

    const resultNo = computeDecay(fragNoAccess);
    const resultWith = computeDecay(fragWithAccess);

    // access_bonus for 0: 1 + (log(1)*0.1) = 1
    // access_bonus for 5: 1 + (log(6)*0.1) = 1 + (1.7918*0.1) = 1.17918
    expect(resultWith).toBeGreaterThan(resultNo);

    const expectedWith = handCompute({
      initial_weight: 1.0,
      daysSinceCreation: 0,
      access_count: 5,
      consolidation_count: 0,
      identity: 0.5,
      relational: 0.5,
      conditioning: 0.5,
    });
    expect(resultWith).toBeCloseTo(expectedWith, 3);
  });

  it('pinned fragments are exempt from decay (shouldArchive returns false)', () => {
    const pinnedFrag = createDecayFragment(365, {
      decay: {
        initial_weight: 0.01,
        current_weight: 0.001,
        access_count: 0,
        consolidation_count: 0,
        pinned: true,
      },
      relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 },
    });

    // Even with very low weight and old age, pinned = never archive
    const result = shouldArchive(pinnedFrag);
    expect(result).toBe(false);
  });

  it('non-pinned fragment below threshold is archive-eligible', () => {
    // Create a very old fragment with low relevance
    const oldFrag = createDecayFragment(365, {
      decay: {
        initial_weight: 0.1,
        current_weight: 0.01,
        access_count: 0,
        consolidation_count: 0,
        pinned: false,
      },
      relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 },
    });

    const result = shouldArchive(oldFrag);
    expect(result).toBe(true);
  });

  it('relevance_factor uses weighted_sum of identity, relational, conditioning', () => {
    // High identity relevance
    const fragHigh = createDecayFragment(0, {
      decay: { initial_weight: 1.0, access_count: 0, consolidation_count: 0, pinned: false },
      relevance: { identity: 1.0, relational: 0.0, conditioning: 0.0 },
    });

    // High relational relevance
    const fragRel = createDecayFragment(0, {
      decay: { initial_weight: 1.0, access_count: 0, consolidation_count: 0, pinned: false },
      relevance: { identity: 0.0, relational: 1.0, conditioning: 0.0 },
    });

    const resultIdentity = computeDecay(fragHigh);
    const resultRelational = computeDecay(fragRel);

    // identity weight=0.3, relational weight=0.5
    // So relational-only relevance should produce higher score
    expect(resultRelational).toBeGreaterThan(resultIdentity);

    // identity: 1.0*0.3 = 0.3, relational: 1.0*0.5 = 0.5
    expect(resultIdentity).toBeCloseTo(0.3, 3);
    expect(resultRelational).toBeCloseTo(0.5, 3);
  });

  it('DECAY_DEFAULTS match spec parameters', () => {
    // Verify the constants exist and are reasonable per spec 3.9
    expect(DECAY_DEFAULTS.base_decay_rate).toBe(0.05);
    expect(DECAY_DEFAULTS.consolidation_protection).toBe(0.3);
    expect(DECAY_DEFAULTS.access_weight).toBe(0.1);
    expect(DECAY_DEFAULTS.relevance_weights).toBeDefined();
    expect(DECAY_DEFAULTS.relevance_weights.identity).toBe(0.3);
    expect(DECAY_DEFAULTS.relevance_weights.relational).toBe(0.5);
    expect(DECAY_DEFAULTS.relevance_weights.conditioning).toBe(0.2);
    expect(DECAY_DEFAULTS.archive_threshold).toBe(0.1);
  });
});

// =========================================================================
// Spec 3.8: Association Index
// =========================================================================

describe('Spec 3.8: Association Index', () => {
  it('defines domains table', () => {
    const mockConn = { run: async () => {} };
    const index = createAssociationIndex({ connection: mockConn });
    const tables = index.getTableNames();
    expect(tables).toContain('domains');
  });

  it('defines entities table', () => {
    const mockConn = { run: async () => {} };
    const index = createAssociationIndex({ connection: mockConn });
    const tables = index.getTableNames();
    expect(tables).toContain('entities');
  });

  it('defines associations table', () => {
    const mockConn = { run: async () => {} };
    const index = createAssociationIndex({ connection: mockConn });
    const tables = index.getTableNames();
    expect(tables).toContain('associations');
  });

  it('defines attention_tags table', () => {
    const mockConn = { run: async () => {} };
    const index = createAssociationIndex({ connection: mockConn });
    const tables = index.getTableNames();
    expect(tables).toContain('attention_tags');
  });

  it('has all 4 spec-required table types among its tables', () => {
    const mockConn = { run: async () => {} };
    const index = createAssociationIndex({ connection: mockConn });
    const tables = index.getTableNames();

    const specRequired = ['domains', 'entities', 'associations', 'attention_tags'];
    for (const table of specRequired) {
      expect(tables).toContain(table);
    }
  });

  it('domains table DDL contains expected columns (id, name, description, weight)', () => {
    // Import DDL_STATEMENTS directly from the module
    const mod = require('../components/fragments/association-index.cjs');
    // Access through the createAssociationIndex init path
    const ddlStatements = [];
    const mockConn = {
      run: async (stmt) => { ddlStatements.push(stmt); },
    };
    const index = createAssociationIndex({ connection: mockConn });
    return index.init().then(() => {
      const domainsDDL = ddlStatements.find(s => s.includes('CREATE TABLE IF NOT EXISTS domains'));
      expect(domainsDDL).toBeDefined();
      expect(domainsDDL).toContain('id VARCHAR PRIMARY KEY');
      expect(domainsDDL).toContain('name VARCHAR NOT NULL');
      expect(domainsDDL).toContain('weight DOUBLE');
    });
  });

  it('entities table DDL contains expected columns (id, name, entity_type)', () => {
    const ddlStatements = [];
    const mockConn = {
      run: async (stmt) => { ddlStatements.push(stmt); },
    };
    const index = createAssociationIndex({ connection: mockConn });
    return index.init().then(() => {
      const entitiesDDL = ddlStatements.find(s => s.includes('CREATE TABLE IF NOT EXISTS entities'));
      expect(entitiesDDL).toBeDefined();
      expect(entitiesDDL).toContain('id VARCHAR PRIMARY KEY');
      expect(entitiesDDL).toContain('name VARCHAR NOT NULL');
    });
  });

  it('associations table DDL contains weighted edges (source_id, target_id, weight)', () => {
    const ddlStatements = [];
    const mockConn = {
      run: async (stmt) => { ddlStatements.push(stmt); },
    };
    const index = createAssociationIndex({ connection: mockConn });
    return index.init().then(() => {
      const assocDDL = ddlStatements.find(s => s.includes('CREATE TABLE IF NOT EXISTS associations'));
      expect(assocDDL).toBeDefined();
      expect(assocDDL).toContain('source_id VARCHAR NOT NULL');
      expect(assocDDL).toContain('target_id VARCHAR NOT NULL');
      expect(assocDDL).toContain('weight DOUBLE');
    });
  });

  it('attention_tags table DDL contains co-occurrence data', () => {
    const ddlStatements = [];
    const mockConn = {
      run: async (stmt) => { ddlStatements.push(stmt); },
    };
    const index = createAssociationIndex({ connection: mockConn });
    return index.init().then(() => {
      const tagsDDL = ddlStatements.find(s => s.includes('CREATE TABLE IF NOT EXISTS attention_tags'));
      expect(tagsDDL).toBeDefined();
      expect(tagsDDL).toContain('tag VARCHAR NOT NULL');
      expect(tagsDDL).toContain('co_occurrence_data');
    });
  });

  it('init() calls DDL for all table types', () => {
    const ddlStatements = [];
    const mockConn = {
      run: async (stmt) => { ddlStatements.push(stmt); },
    };
    const index = createAssociationIndex({ connection: mockConn });
    return index.init().then(() => {
      // Should have run 12 DDL statements
      expect(ddlStatements.length).toBe(12);
    });
  });
});

// =========================================================================
// Spec 3.11: Source Reference Model
// =========================================================================

describe('Spec 3.11: Source Reference Model', () => {
  it('source_locator type enum is file | url | inline', () => {
    for (const validType of ['file', 'url', 'inline']) {
      const result = sourceLocatorSchema.safeParse({
        type: validType,
        path: null,
        url: null,
        content_hash: null,
        last_verified: '2026-03-22T14:30:00Z',
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid source_locator type', () => {
    const result = sourceLocatorSchema.safeParse({
      type: 'database',
      path: null,
      url: null,
      content_hash: null,
      last_verified: '2026-03-22T14:30:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('file type has path field', () => {
    const result = sourceLocatorSchema.safeParse({
      type: 'file',
      path: '/home/user/docs/atlas-requirements.md',
      url: null,
      content_hash: null,
      last_verified: '2026-03-22T14:30:00Z',
    });
    expect(result.success).toBe(true);
    expect(result.data.path).toBe('/home/user/docs/atlas-requirements.md');
  });

  it('url type has url field', () => {
    const result = sourceLocatorSchema.safeParse({
      type: 'url',
      path: null,
      url: 'https://example.com/doc',
      content_hash: null,
      last_verified: '2026-03-22T14:30:00Z',
    });
    expect(result.success).toBe(true);
    expect(result.data.url).toBe('https://example.com/doc');
  });

  it('inline type has content_hash field', () => {
    const result = sourceLocatorSchema.safeParse({
      type: 'inline',
      path: null,
      url: null,
      content_hash: 'sha256-abcdef1234567890',
      last_verified: '2026-03-22T14:30:00Z',
    });
    expect(result.success).toBe(true);
    expect(result.data.content_hash).toBe('sha256-abcdef1234567890');
  });

  it('has last_verified timestamp field', () => {
    const result = sourceLocatorSchema.safeParse({
      type: 'file',
      path: '/some/path',
      url: null,
      content_hash: null,
      last_verified: '2026-03-22T14:30:00Z',
    });
    expect(result.success).toBe(true);
    expect(result.data.last_verified).toBe('2026-03-22T14:30:00Z');
  });

  it('source-reference fragments store experiential relationship, NOT source content', () => {
    // Per spec 3.11: "does NOT store or index the source content"
    // The source_locator points to the content location, but the fragment body
    // is an impressionistic account (per spec 3.4), not the source itself.
    // Verify that source-reference schema does NOT have a content or raw_content field.
    const frag = createValidFragment({
      type: 'source-reference',
      source_locator: {
        type: 'file',
        path: '/home/user/docs/atlas-requirements.md',
        url: null,
        content_hash: null,
        last_verified: '2026-03-22T14:30:00Z',
      },
    });

    const result = validateFragment(frag);
    expect(result.ok).toBe(true);

    // The schema should not include a raw content field
    const schemaKeys = Object.keys(result.value);
    expect(schemaKeys).not.toContain('content');
    expect(schemaKeys).not.toContain('raw_content');
    expect(schemaKeys).not.toContain('source_content');
  });

  it('source-reference fragment requires source_locator (not null/undefined)', () => {
    // Fragment without source_locator should fail for source-reference type
    const fragNoLocator = createValidFragment({ type: 'source-reference' });
    delete fragNoLocator.source_locator;
    const result = validateFragment(fragNoLocator);
    expect(result.ok).toBe(false);
  });

  it('source_locator is the terminus of an association chain (pointer-only, not content store)', () => {
    // Verify the source_locator schema only has pointer fields, no content storage
    const locator = sourceLocatorSchema.safeParse({
      type: 'file',
      path: '/home/user/docs/atlas.md',
      url: null,
      content_hash: null,
      last_verified: '2026-03-22T14:30:00Z',
    });
    expect(locator.success).toBe(true);

    const locatorKeys = Object.keys(locator.data);
    // Only location/pointer fields per spec: type, path, url, content_hash, last_verified
    expect(locatorKeys).toEqual(
      expect.arrayContaining(['type', 'path', 'url', 'content_hash', 'last_verified'])
    );
    // No content storage fields
    expect(locatorKeys).not.toContain('content');
    expect(locatorKeys).not.toContain('body');
    expect(locatorKeys).not.toContain('data');
  });

  describe('Known deviation: JSON frontmatter not YAML', () => {
    it('[D] spec 3.3 says YAML frontmatter but implementation uses JSON (intentional per Phase 07)', () => {
      // This is a documented deviation per STATE.md:
      // "[Phase 07]: JSON frontmatter is a clean break from YAML"
      // The fragment data is validated as JSON objects through Zod schemas.
      // The spec example shows YAML frontmatter but the implementation uses JSON.
      // This is intentional and documented.
      const frag = createValidFragment();
      const result = validateFragment(frag);
      expect(result.ok).toBe(true);
      // Data validated as JSON object -- not YAML parsed
    });
  });
});
