'use strict';

const { describe, it, expect } = require('bun:test');

const {
  baseFragmentSchema,
  experientialFragment,
  metaRecallFragment,
  sublimationFragment,
  consolidationFragment,
  sourceReferenceFragment,
  validateFragment,
  identityCoreSchema,
  relationalModelSchema,
  conditioningSchema,
} = require('../../../lib/schemas.cjs');

/**
 * Helper: builds a valid base fragment frontmatter object.
 * Override any fields by spreading on top.
 */
function makeFragment(overrides = {}) {
  return {
    id: 'frag-2026-03-23-a1b2c3d4',
    type: 'experiential',
    created: '2026-03-23T10:00:00Z',
    source_session: 'session-001',
    self_model_version: 'sm-identity-v1',
    formation_group: 'fg-001',
    formation_frame: 'frame-001',
    sibling_fragments: [],
    temporal: {
      absolute: '2026-03-23T10:00:00Z',
      session_relative: 0.5,
      sequence: 0,
    },
    decay: {
      initial_weight: 0.8,
      current_weight: 0.8,
      last_accessed: '2026-03-23T10:00:00Z',
      access_count: 0,
      consolidation_count: 0,
      pinned: false,
    },
    associations: {
      domains: ['programming'],
      entities: ['bun-runtime'],
      self_model_relevance: {
        identity: 0.5,
        relational: 0.5,
        conditioning: 0.5,
      },
      emotional_valence: 0.2,
      attention_tags: ['technical'],
    },
    pointers: {
      causal_antecedents: [],
      causal_consequents: [],
      thematic_siblings: [],
      contradictions: [],
      meta_recalls: [],
      source_fragments: [],
    },
    formation: {
      trigger: 'user-message',
      attention_pointer: 'programming discussion',
      active_domains_at_formation: ['programming'],
      sublimation_that_prompted: null,
    },
    ...overrides,
  };
}

describe('Fragment Schema Validation', () => {
  describe('baseFragmentSchema', () => {
    it('validates a correct experiential fragment', () => {
      const fragment = makeFragment();
      const result = baseFragmentSchema.safeParse(fragment);
      expect(result.success).toBe(true);
    });

    it('rejects fragment with invalid ID format', () => {
      const fragment = makeFragment({ id: 'bad-id-format' });
      const result = baseFragmentSchema.safeParse(fragment);
      expect(result.success).toBe(false);
    });

    it('rejects fragment with invalid type string', () => {
      const fragment = makeFragment({ type: 'nonexistent-type' });
      const result = baseFragmentSchema.safeParse(fragment);
      expect(result.success).toBe(false);
    });

    it('rejects fragment with decay.current_weight outside 0-1 range', () => {
      const fragment = makeFragment({
        decay: {
          initial_weight: 0.8,
          current_weight: 1.5,
          last_accessed: '2026-03-23T10:00:00Z',
          access_count: 0,
          consolidation_count: 0,
          pinned: false,
        },
      });
      const result = baseFragmentSchema.safeParse(fragment);
      expect(result.success).toBe(false);
    });

    it('rejects fragment with associations.emotional_valence outside -1 to 1 range', () => {
      const fragment = makeFragment({
        associations: {
          domains: ['programming'],
          entities: ['bun-runtime'],
          self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
          emotional_valence: 2.0,
          attention_tags: ['technical'],
        },
      });
      const result = baseFragmentSchema.safeParse(fragment);
      expect(result.success).toBe(false);
    });

    it('rejects fragment with self_model_relevance values outside 0-1 range', () => {
      const fragment = makeFragment({
        associations: {
          domains: ['programming'],
          entities: ['bun-runtime'],
          self_model_relevance: { identity: 1.5, relational: 0.5, conditioning: 0.5 },
          emotional_valence: 0.2,
          attention_tags: ['technical'],
        },
      });
      const result = baseFragmentSchema.safeParse(fragment);
      expect(result.success).toBe(false);
    });
  });

  describe('Type-specific schemas', () => {
    it('validates a valid experiential fragment', () => {
      const fragment = makeFragment({ type: 'experiential' });
      const result = experientialFragment.safeParse(fragment);
      expect(result.success).toBe(true);
    });

    it('validates a valid meta-recall fragment with non-empty source_fragments', () => {
      const fragment = makeFragment({
        type: 'meta-recall',
        pointers: {
          causal_antecedents: [],
          causal_consequents: [],
          thematic_siblings: [],
          contradictions: [],
          meta_recalls: [],
          source_fragments: ['frag-2026-03-22-abcdef01'],
        },
      });
      const result = metaRecallFragment.safeParse(fragment);
      expect(result.success).toBe(true);
    });

    it('rejects meta-recall fragment with empty source_fragments array', () => {
      const fragment = makeFragment({
        type: 'meta-recall',
        pointers: {
          causal_antecedents: [],
          causal_consequents: [],
          thematic_siblings: [],
          contradictions: [],
          meta_recalls: [],
          source_fragments: [],
        },
      });
      const result = metaRecallFragment.safeParse(fragment);
      expect(result.success).toBe(false);
    });

    it('validates a valid source-reference fragment with source_locator', () => {
      const fragment = makeFragment({
        type: 'source-reference',
        source_locator: {
          type: 'file',
          path: '/docs/readme.md',
          url: null,
          content_hash: 'abc123',
          last_verified: '2026-03-23T10:00:00Z',
        },
      });
      const result = sourceReferenceFragment.safeParse(fragment);
      expect(result.success).toBe(true);
    });

    it('rejects source-reference fragment without source_locator', () => {
      const fragment = makeFragment({ type: 'source-reference' });
      // source_locator is optional on base schema, so omitting it should be valid on base but fail refine
      const result = sourceReferenceFragment.safeParse(fragment);
      expect(result.success).toBe(false);
    });
  });

  describe('validateFragment()', () => {
    it('dispatches experiential type to experientialFragment schema', () => {
      const fragment = makeFragment({ type: 'experiential' });
      const result = validateFragment(fragment);
      expect(result.ok).toBe(true);
      expect(result.value.type).toBe('experiential');
    });

    it('dispatches meta-recall type to metaRecallFragment schema', () => {
      const fragment = makeFragment({
        type: 'meta-recall',
        pointers: {
          causal_antecedents: [],
          causal_consequents: [],
          thematic_siblings: [],
          contradictions: [],
          meta_recalls: [],
          source_fragments: ['frag-2026-03-22-abcdef01'],
        },
      });
      const result = validateFragment(fragment);
      expect(result.ok).toBe(true);
      expect(result.value.type).toBe('meta-recall');
    });

    it('returns error for invalid fragment', () => {
      const result = validateFragment({ id: 'bad', type: 'experiential' });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Self Model schemas', () => {
    it('validates Self Model identity-core frontmatter', () => {
      const data = {
        aspect: 'identity-core',
        version: 'sm-identity-v1',
        updated: '2026-03-23T10:00:00Z',
        personality_traits: { openness: 0.8, conscientiousness: 0.7 },
        communication_style: { formality: 'medium' },
        value_orientations: [{ name: 'curiosity', weight: 0.9 }],
        expertise_map: { javascript: 0.9 },
        boundaries: ['no-harmful-content'],
      };
      const result = identityCoreSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates Self Model relational-model frontmatter', () => {
      const data = {
        aspect: 'relational-model',
        version: 'sm-relational-v1',
        updated: '2026-03-23T10:00:00Z',
        communication_patterns: { preferred: 'concise' },
        domain_map: { programming: 0.9 },
        preference_history: [{ topic: 'code-review', preference: 'detailed' }],
        trust_calibration: { technical_accuracy: 0.8 },
        interaction_rhythm: { frequency: 'daily' },
      };
      const result = relationalModelSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates Self Model conditioning frontmatter', () => {
      const data = {
        aspect: 'conditioning',
        version: 'sm-conditioning-v1',
        updated: '2026-03-23T10:00:00Z',
        attention_biases: { code_quality: 0.8 },
        association_priors: { debugging: 0.6 },
        sublimation_sensitivity: { pattern_recognition: 0.7 },
        recall_strategies: [{ type: 'association', weight: 0.5 }],
        error_history: [{ type: 'misunderstanding', count: 2 }],
      };
      const result = conditioningSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });
});
