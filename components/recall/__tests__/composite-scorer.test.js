'use strict';

const { describe, it, expect } = require('bun:test');
const { createCompositeScorer } = require('../composite-scorer.cjs');

/**
 * Tests for the composite scorer module.
 *
 * The composite scorer implements a deterministic 6-factor weighted scoring
 * function for recall ranking per Phase 9 D-12. All factors produce values
 * in the 0-1 range, and the final score is a weighted sum.
 */

/** Helper: build a minimal fragment for scoring */
function makeFragment(overrides) {
  return {
    id: 'frag-2026-03-24-abcd1234',
    type: 'experiential',
    created: new Date().toISOString(),
    associations: {
      domains: ['trust', 'communication'],
      entities: ['user', 'project-alpha'],
      attention_tags: ['pattern-shift', 'emotional-signal'],
      self_model_relevance: { identity: 0.5, relational: 0.7, conditioning: 0.3 },
    },
    decay: {
      initial_weight: 1.0,
      current_weight: 0.8,
      last_accessed: new Date().toISOString(),
      access_count: 3,
      consolidation_count: 0,
      pinned: false,
    },
    ...overrides,
  };
}

/** Helper: build a minimal query context */
function makeQueryContext(overrides) {
  return {
    activeDomains: ['trust', 'collaboration'],
    activeEntities: ['user', 'project-beta'],
    attentionTags: ['pattern-shift'],
    referenceTime: Date.now(),
    ...overrides,
  };
}

describe('Composite Scorer', function () {
  describe('createCompositeScorer', function () {
    it('returns an object with compositeScore and rankFragments methods', function () {
      const scorer = createCompositeScorer();
      expect(typeof scorer.compositeScore).toBe('function');
      expect(typeof scorer.rankFragments).toBe('function');
    });
  });

  describe('compositeScore', function () {
    it('returns a number between 0 and 1', function () {
      const scorer = createCompositeScorer();
      const fragment = makeFragment();
      const ctx = makeQueryContext();
      const score = scorer.compositeScore(fragment, ctx);
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('scores fragment with 100% domain overlap higher than 0% overlap', function () {
      const scorer = createCompositeScorer();
      const ctx = makeQueryContext({ activeDomains: ['trust', 'communication'] });

      const fullOverlap = makeFragment({
        associations: {
          domains: ['trust', 'communication'],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        },
      });

      const noOverlap = makeFragment({
        associations: {
          domains: ['mathematics', 'physics'],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        },
      });

      const scoreHigh = scorer.compositeScore(fullOverlap, ctx);
      const scoreLow = scorer.compositeScore(noOverlap, ctx);
      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });

    it('scores fragment with high decay weight higher than low decay weight', function () {
      const scorer = createCompositeScorer();
      const ctx = makeQueryContext({ activeDomains: [], activeEntities: [], attentionTags: [] });

      const highDecay = makeFragment({
        associations: {
          domains: [],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        },
        decay: { current_weight: 0.9, initial_weight: 1.0, last_accessed: new Date().toISOString(), access_count: 0, consolidation_count: 0, pinned: false },
      });

      const lowDecay = makeFragment({
        associations: {
          domains: [],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        },
        decay: { current_weight: 0.1, initial_weight: 1.0, last_accessed: new Date().toISOString(), access_count: 0, consolidation_count: 0, pinned: false },
      });

      const scoreHigh = scorer.compositeScore(highDecay, ctx);
      const scoreLow = scorer.compositeScore(lowDecay, ctx);
      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });

    it('accepts custom weight config that overrides SCORING_DEFAULTS', function () {
      const customWeights = {
        domain_overlap: 1.0,
        entity_cooccurrence: 0.0,
        attention_tag_match: 0.0,
        decay_weight: 0.0,
        self_model_relevance: 0.0,
        temporal_proximity: 0.0,
      };
      const scorer = createCompositeScorer({ weights: customWeights });
      const ctx = makeQueryContext({ activeDomains: ['trust'], activeEntities: [], attentionTags: [] });

      const withDomain = makeFragment({
        associations: {
          domains: ['trust'],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        },
      });

      const withoutDomain = makeFragment({
        associations: {
          domains: ['physics'],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0, relational: 0, conditioning: 0 },
        },
      });

      const score1 = scorer.compositeScore(withDomain, ctx);
      const score2 = scorer.compositeScore(withoutDomain, ctx);

      // With domain_overlap weight = 1.0, the domain-matching fragment should score ~1.0
      expect(score1).toBeGreaterThan(0.9);
      // And the non-matching should score ~0.0
      expect(score2).toBeLessThan(0.1);
    });

    it('computes Self Model relevance using weighted average (identity: 0.3, relational: 0.5, conditioning: 0.2)', function () {
      const customWeights = {
        domain_overlap: 0.0,
        entity_cooccurrence: 0.0,
        attention_tag_match: 0.0,
        decay_weight: 0.0,
        self_model_relevance: 1.0,
        temporal_proximity: 0.0,
      };
      const scorer = createCompositeScorer({ weights: customWeights });
      const ctx = makeQueryContext({ activeDomains: [], activeEntities: [], attentionTags: [] });

      // identity: 1.0 * 0.3 + relational: 0.0 * 0.5 + conditioning: 0.0 * 0.2 = 0.3
      const identityOnly = makeFragment({
        associations: {
          domains: [],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 1.0, relational: 0.0, conditioning: 0.0 },
        },
      });

      // identity: 0.0 * 0.3 + relational: 1.0 * 0.5 + conditioning: 0.0 * 0.2 = 0.5
      const relationalOnly = makeFragment({
        associations: {
          domains: [],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0.0, relational: 1.0, conditioning: 0.0 },
        },
      });

      const scoreId = scorer.compositeScore(identityOnly, ctx);
      const scoreRel = scorer.compositeScore(relationalOnly, ctx);

      // Relational weight (0.5) > identity weight (0.3)
      expect(scoreRel).toBeGreaterThan(scoreId);
      expect(scoreId).toBeCloseTo(0.3, 2);
      expect(scoreRel).toBeCloseTo(0.5, 2);
    });

    it('returns 0 for Self Model relevance when field is not present', function () {
      const customWeights = {
        domain_overlap: 0.0,
        entity_cooccurrence: 0.0,
        attention_tag_match: 0.0,
        decay_weight: 0.0,
        self_model_relevance: 1.0,
        temporal_proximity: 0.0,
      };
      const scorer = createCompositeScorer({ weights: customWeights });
      const ctx = makeQueryContext({ activeDomains: [], activeEntities: [], attentionTags: [] });

      const noSMR = makeFragment({
        associations: {
          domains: [],
          entities: [],
          attention_tags: [],
          // self_model_relevance deliberately omitted
        },
      });
      // Remove the self_model_relevance field
      delete noSMR.associations.self_model_relevance;

      const score = scorer.compositeScore(noSMR, ctx);
      expect(score).toBe(0);
    });

    it('computes temporal proximity as exponential decay by days', function () {
      const customWeights = {
        domain_overlap: 0.0,
        entity_cooccurrence: 0.0,
        attention_tag_match: 0.0,
        decay_weight: 0.0,
        self_model_relevance: 0.0,
        temporal_proximity: 1.0,
      };
      const scorer = createCompositeScorer({ weights: customWeights });

      const now = Date.now();
      const ctx = makeQueryContext({ activeDomains: [], activeEntities: [], attentionTags: [], referenceTime: now });

      const today = makeFragment({ created: new Date(now).toISOString() });
      const weekAgo = makeFragment({ created: new Date(now - 7 * 86400000).toISOString() });

      const scoreToday = scorer.compositeScore(today, ctx);
      const scoreWeek = scorer.compositeScore(weekAgo, ctx);

      // Same-day should be ~1.0
      expect(scoreToday).toBeCloseTo(1.0, 1);
      // Week ago should be exp(-0.1 * 7) ~= 0.497
      expect(scoreWeek).toBeCloseTo(Math.exp(-0.1 * 7), 1);
      expect(scoreToday).toBeGreaterThan(scoreWeek);
    });
  });

  describe('rankFragments', function () {
    it('returns top N fragments sorted by score descending', function () {
      const scorer = createCompositeScorer();
      const ctx = makeQueryContext();

      const fragments = [
        makeFragment({ id: 'frag-2026-03-24-aaaaaaaa', associations: { domains: ['trust'], entities: ['user'], attention_tags: ['pattern-shift'], self_model_relevance: { identity: 0.9, relational: 0.9, conditioning: 0.9 } } }),
        makeFragment({ id: 'frag-2026-03-24-bbbbbbbb', associations: { domains: [], entities: [], attention_tags: [], self_model_relevance: { identity: 0, relational: 0, conditioning: 0 } } }),
        makeFragment({ id: 'frag-2026-03-24-cccccccc', associations: { domains: ['trust', 'collaboration'], entities: ['user', 'project-beta'], attention_tags: ['pattern-shift'], self_model_relevance: { identity: 0.5, relational: 0.7, conditioning: 0.3 } } }),
      ];

      const ranked = scorer.rankFragments(fragments, ctx, 2);
      expect(ranked.length).toBe(2);
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
      expect(ranked[0]).toHaveProperty('fragment');
      expect(ranked[0]).toHaveProperty('score');
    });

    it('handles empty fragment array', function () {
      const scorer = createCompositeScorer();
      const ctx = makeQueryContext();
      const ranked = scorer.rankFragments([], ctx, 5);
      expect(ranked).toEqual([]);
    });

    it('returns all fragments when limit exceeds array length', function () {
      const scorer = createCompositeScorer();
      const ctx = makeQueryContext();
      const fragments = [makeFragment()];
      const ranked = scorer.rankFragments(fragments, ctx, 10);
      expect(ranked.length).toBe(1);
    });
  });
});
