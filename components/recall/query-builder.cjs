'use strict';

/**
 * Query builder for Assay-compatible recall queries.
 *
 * Constructs query objects for both passive recall (5 fragment limit, tight filter)
 * and explicit recall (15 fragment limit, broad filter) per Phase 9 D-11 and D-12.
 *
 * Both query types produce objects compatible with Assay.search({ criteria, providers?, options? }).
 * The SQL in options targets the Ledger's fragment_decay table for candidate ID retrieval;
 * the criteria object is for Journal frontmatter matching.
 *
 * @module reverie/components/recall/query-builder
 */

/**
 * Creates a query builder instance.
 *
 * @param {Object} [options] - Configuration options (reserved for future use)
 * @returns {Readonly<{ buildPassiveQuery: Function, buildExplicitQuery: Function, extractQueryContext: Function }>}
 */
function createQueryBuilder(options) {

  /**
   * Builds an Assay-compatible query for passive recall.
   *
   * Passive recall is automatic -- triggered by the formation subagent during
   * each turn-scoped processing cycle. Uses tight filtering (higher decay threshold,
   * fewer candidates) to keep the nudge token budget low (~100-200 tokens).
   *
   * @param {Object} stimulus - Stimulus context from current formation
   * @param {string[]} stimulus.domains - Active domain labels
   * @param {string[]} stimulus.entities - Active entity references
   * @param {string[]} stimulus.attention_tags - Active attention tags
   * @returns {{ criteria: Object, options: Object, limit: number }}
   */
  function buildPassiveQuery(stimulus) {
    const domains = (stimulus && stimulus.domains) || [];
    const entities = (stimulus && stimulus.entities) || [];

    return {
      criteria: {
        domains: domains,
        entities: entities,
        lifecycle: ['working', 'active'],
      },
      options: {
        sql: "SELECT fragment_id, fragment_type, current_weight, lifecycle FROM fragment_decay WHERE current_weight > 0.3 AND (lifecycle = 'working' OR lifecycle = 'active') ORDER BY current_weight DESC LIMIT 20",
      },
      limit: 5,
    };
  }

  /**
   * Builds an Assay-compatible query for explicit recall.
   *
   * Explicit recall is user-triggered -- via CLI command or hook keyword.
   * Uses broader filtering (lower decay threshold, more candidates) for
   * richer reconstruction with higher token budget (~500-1000 tokens).
   *
   * @param {Object} conversationContext - Broader conversation context
   * @param {string[]} conversationContext.domains - Active domain labels
   * @param {string[]} conversationContext.entities - Active entity references
   * @param {string[]} conversationContext.attention_tags - Active attention tags
   * @param {number} conversationContext.recentTurns - Number of recent turns to consider
   * @returns {{ criteria: Object, options: Object, limit: number }}
   */
  function buildExplicitQuery(conversationContext) {
    const domains = (conversationContext && conversationContext.domains) || [];
    const entities = (conversationContext && conversationContext.entities) || [];
    const attentionTags = (conversationContext && conversationContext.attention_tags) || [];

    return {
      criteria: {
        domains: domains,
        entities: entities,
        attention_tags: attentionTags,
        lifecycle: ['working', 'active'],
      },
      options: {
        sql: "SELECT fragment_id, fragment_type, current_weight, lifecycle FROM fragment_decay WHERE current_weight > 0.1 AND (lifecycle = 'working' OR lifecycle = 'active') ORDER BY current_weight DESC LIMIT 50",
      },
      limit: 15,
    };
  }

  /**
   * Extracts a queryContext object suitable for the composite scorer
   * from raw stimulus data and Self Model state.
   *
   * @param {Object} stimulus - Raw stimulus with domains, entities, attention_tags
   * @param {Object} selfModel - Self Model state (identity_summary, relational_summary)
   * @returns {{ activeDomains: string[], activeEntities: string[], attentionTags: string[], referenceTime: number }}
   */
  function extractQueryContext(stimulus, selfModel) {
    return {
      activeDomains: (stimulus && stimulus.domains) || [],
      activeEntities: (stimulus && stimulus.entities) || [],
      attentionTags: (stimulus && stimulus.attention_tags) || [],
      referenceTime: Date.now(),
    };
  }

  return Object.freeze({
    buildPassiveQuery,
    buildExplicitQuery,
    extractQueryContext,
  });
}

module.exports = { createQueryBuilder };
