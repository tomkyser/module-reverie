'use strict';

const { describe, it, expect } = require('bun:test');

const { baseFragmentSchema } = require('../schemas.cjs');
const { FRAGMENT_ID_PATTERN } = require('../constants.cjs');

/**
 * Creates a minimal valid fragment for testing the origin field.
 */
function createMinimalFragment(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'frag-2026-03-25-a1b2c3d4',
    type: 'experiential',
    created: now,
    source_session: 'session-001',
    self_model_version: 'sm-identity-v1',
    formation_group: 'fg-001',
    formation_frame: 'experiential',
    sibling_fragments: [],
    temporal: {
      absolute: now,
      session_relative: 0.5,
      sequence: 1,
    },
    decay: {
      initial_weight: 0.8,
      current_weight: 0.8,
      last_accessed: now,
      access_count: 0,
      consolidation_count: 0,
      pinned: false,
    },
    associations: {
      domains: ['coding'],
      entities: ['user-1'],
      self_model_relevance: {
        identity: 0.3,
        relational: 0.5,
        conditioning: 0.2,
      },
      emotional_valence: 0.5,
      attention_tags: ['architecture'],
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
      trigger: 'user_prompt',
      attention_pointer: 'architecture',
      active_domains_at_formation: ['coding'],
      sublimation_that_prompted: null,
    },
    ...overrides,
  };
}

describe('baseFragmentSchema origin field', () => {
  it('accepts fragment with origin=backfill', () => {
    const fragment = createMinimalFragment({ origin: 'backfill' });
    const result = baseFragmentSchema.safeParse(fragment);
    expect(result.success).toBe(true);
    expect(result.data.origin).toBe('backfill');
  });

  it('accepts fragment without origin field (backward compat)', () => {
    const fragment = createMinimalFragment();
    // Ensure no origin key exists
    delete fragment.origin;
    const result = baseFragmentSchema.safeParse(fragment);
    expect(result.success).toBe(true);
  });

  it('rejects non-string origin field', () => {
    const fragment = createMinimalFragment({ origin: 42 });
    const result = baseFragmentSchema.safeParse(fragment);
    expect(result.success).toBe(false);
  });

  it('accepts origin=live as a valid string', () => {
    const fragment = createMinimalFragment({ origin: 'live' });
    const result = baseFragmentSchema.safeParse(fragment);
    expect(result.success).toBe(true);
    expect(result.data.origin).toBe('live');
  });
});
