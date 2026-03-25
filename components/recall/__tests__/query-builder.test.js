'use strict';

const { describe, it, expect } = require('bun:test');
const { createQueryBuilder } = require('../query-builder.cjs');

/**
 * Tests for the query builder module.
 *
 * The query builder constructs Assay-compatible query objects for both
 * passive recall (5 fragment limit, tight filter) and explicit recall
 * (15 fragment limit, broad filter) per Phase 9 D-11 and D-12.
 */

describe('Query Builder', function () {
  describe('createQueryBuilder', function () {
    it('returns an object with buildPassiveQuery, buildExplicitQuery, and extractQueryContext methods', function () {
      const builder = createQueryBuilder();
      expect(typeof builder.buildPassiveQuery).toBe('function');
      expect(typeof builder.buildExplicitQuery).toBe('function');
      expect(typeof builder.extractQueryContext).toBe('function');
    });
  });

  describe('buildPassiveQuery', function () {
    it('returns query with limit: 5 and lifecycle filter (working OR active)', function () {
      const builder = createQueryBuilder();
      const query = builder.buildPassiveQuery({
        domains: ['trust'],
        entities: ['user'],
        attention_tags: ['pattern-shift'],
      });

      expect(query.limit).toBe(5);
      expect(query.criteria.lifecycle).toEqual(['working', 'active']);
    });

    it('includes domain and entity criteria from stimulus', function () {
      const builder = createQueryBuilder();
      const query = builder.buildPassiveQuery({
        domains: ['trust', 'communication'],
        entities: ['user', 'project-alpha'],
        attention_tags: ['emotional-signal'],
      });

      expect(query.criteria.domains).toEqual(['trust', 'communication']);
      expect(query.criteria.entities).toEqual(['user', 'project-alpha']);
    });

    it('produces object with { criteria, options } structure', function () {
      const builder = createQueryBuilder();
      const query = builder.buildPassiveQuery({
        domains: ['trust'],
        entities: [],
        attention_tags: [],
      });

      expect(query).toHaveProperty('criteria');
      expect(query).toHaveProperty('options');
      expect(query).toHaveProperty('limit');
    });

    it('includes SQL with current_weight > 0.3 for passive queries', function () {
      const builder = createQueryBuilder();
      const query = builder.buildPassiveQuery({
        domains: ['trust'],
        entities: [],
        attention_tags: [],
      });

      expect(query.options.sql).toContain('current_weight > 0.3');
      expect(query.options.sql).toContain('LIMIT 20');
    });
  });

  describe('buildExplicitQuery', function () {
    it('returns query with limit: 15', function () {
      const builder = createQueryBuilder();
      const query = builder.buildExplicitQuery({
        domains: ['trust', 'communication'],
        entities: ['user'],
        attention_tags: ['pattern-shift'],
        recentTurns: 5,
      });

      expect(query.limit).toBe(15);
    });

    it('includes broader criteria with attention_tags', function () {
      const builder = createQueryBuilder();
      const query = builder.buildExplicitQuery({
        domains: ['trust'],
        entities: ['user'],
        attention_tags: ['emotional-signal', 'pattern-shift'],
        recentTurns: 3,
      });

      expect(query.criteria.domains).toEqual(['trust']);
      expect(query.criteria.entities).toEqual(['user']);
      expect(query.criteria.attention_tags).toEqual(['emotional-signal', 'pattern-shift']);
    });

    it('includes SQL with current_weight > 0.1 for explicit queries', function () {
      const builder = createQueryBuilder();
      const query = builder.buildExplicitQuery({
        domains: ['trust'],
        entities: [],
        attention_tags: [],
        recentTurns: 5,
      });

      expect(query.options.sql).toContain('current_weight > 0.1');
      expect(query.options.sql).toContain('LIMIT 50');
    });

    it('produces object with { criteria, options, limit } structure', function () {
      const builder = createQueryBuilder();
      const query = builder.buildExplicitQuery({
        domains: [],
        entities: [],
        attention_tags: [],
        recentTurns: 0,
      });

      expect(query).toHaveProperty('criteria');
      expect(query).toHaveProperty('options');
      expect(query).toHaveProperty('limit');
    });
  });

  describe('extractQueryContext', function () {
    it('produces a queryContext object from stimulus and selfModel', function () {
      const builder = createQueryBuilder();
      const stimulus = {
        domains: ['trust', 'learning'],
        entities: ['user', 'project'],
        attention_tags: ['surprise'],
      };
      const selfModel = {
        identity_summary: 'curious and analytical',
        relational_summary: 'developing trust',
      };

      const ctx = builder.extractQueryContext(stimulus, selfModel);
      expect(ctx).toHaveProperty('activeDomains');
      expect(ctx).toHaveProperty('activeEntities');
      expect(ctx).toHaveProperty('attentionTags');
      expect(ctx).toHaveProperty('referenceTime');
      expect(ctx.activeDomains).toEqual(['trust', 'learning']);
      expect(ctx.activeEntities).toEqual(['user', 'project']);
      expect(ctx.attentionTags).toEqual(['surprise']);
      expect(typeof ctx.referenceTime).toBe('number');
    });
  });
});
