'use strict';

/**
 * Association Index — DuckDB DDL for the 12-table fragment association schema.
 *
 * Per D-12: Design all ~12 tables upfront. Tables can remain empty until their
 * phase, but the schema must be defined now to avoid migration pain later.
 *
 * Per Pitfall 4: Uses INTEGER (not BIGINT) for counts, VARCHAR for IDs,
 * DOUBLE for weights/scores. This avoids BigInt serialization issues.
 *
 * @module reverie/components/fragments/association-index
 */

/**
 * The 12 association index table names in creation order.
 * @type {ReadonlyArray<string>}
 */
const TABLE_NAMES = Object.freeze([
  'domains',
  'entities',
  'associations',
  'attention_tags',
  'formation_groups',
  'fragment_decay',
  'source_locators',
  'fragment_domains',
  'fragment_entities',
  'fragment_attention_tags',
  'entity_domains',
  'domain_relationships',
]);

/**
 * DDL statements for all 12 association index tables.
 * Each statement uses CREATE TABLE IF NOT EXISTS for idempotency.
 * @type {ReadonlyArray<string>}
 */
const DDL_STATEMENTS = Object.freeze([
  // 1. Core domain taxonomy
  `CREATE TABLE IF NOT EXISTS domains (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT,
  parent_domain_id VARCHAR,
  fragment_count INTEGER DEFAULT 0,
  weight DOUBLE DEFAULT 1.0,
  narrative_version VARCHAR,
  archived BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT current_timestamp,
  updated_at TIMESTAMP DEFAULT current_timestamp
)`,

  // 2. Named entities (concepts, people, projects, patterns)
  `CREATE TABLE IF NOT EXISTS entities (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  entity_type VARCHAR,
  description TEXT,
  first_seen TIMESTAMP DEFAULT current_timestamp,
  last_seen TIMESTAMP DEFAULT current_timestamp,
  occurrence_count INTEGER DEFAULT 1,
  archived BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT current_timestamp,
  updated_at TIMESTAMP DEFAULT current_timestamp
)`,

  // 3. Weighted edges between entities and/or domains
  `CREATE TABLE IF NOT EXISTS associations (
  id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL,
  source_type VARCHAR NOT NULL,
  target_id VARCHAR NOT NULL,
  target_type VARCHAR NOT NULL,
  weight DOUBLE DEFAULT 0.5,
  co_occurrence_count INTEGER DEFAULT 1,
  last_reinforced TIMESTAMP DEFAULT current_timestamp,
  created_at TIMESTAMP DEFAULT current_timestamp,
  updated_at TIMESTAMP DEFAULT current_timestamp
)`,

  // 4. Experiential descriptors from fragment formation
  `CREATE TABLE IF NOT EXISTS attention_tags (
  id VARCHAR PRIMARY KEY,
  tag VARCHAR NOT NULL UNIQUE,
  occurrence_count INTEGER DEFAULT 1,
  co_occurrence_data VARCHAR,
  first_seen TIMESTAMP DEFAULT current_timestamp,
  last_seen TIMESTAMP DEFAULT current_timestamp,
  created_at TIMESTAMP DEFAULT current_timestamp
)`,

  // 5. Groups fragments formed from same stimulus
  `CREATE TABLE IF NOT EXISTS formation_groups (
  id VARCHAR PRIMARY KEY,
  stimulus_summary TEXT,
  fragment_count INTEGER DEFAULT 0,
  surviving_count INTEGER DEFAULT 0,
  source_session VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT current_timestamp
)`,

  // 6. Fragment decay tracking (one row per fragment)
  `CREATE TABLE IF NOT EXISTS fragment_decay (
  fragment_id VARCHAR PRIMARY KEY,
  fragment_type VARCHAR NOT NULL,
  initial_weight DOUBLE NOT NULL,
  current_weight DOUBLE NOT NULL,
  last_accessed TIMESTAMP,
  access_count INTEGER DEFAULT 0,
  consolidation_count INTEGER DEFAULT 0,
  pinned BOOLEAN DEFAULT false,
  lifecycle VARCHAR DEFAULT 'working',
  created_at TIMESTAMP DEFAULT current_timestamp,
  updated_at TIMESTAMP DEFAULT current_timestamp
)`,

  // 7. Source locators for source-reference fragments
  `CREATE TABLE IF NOT EXISTS source_locators (
  id VARCHAR PRIMARY KEY,
  fragment_id VARCHAR NOT NULL,
  locator_type VARCHAR NOT NULL,
  path VARCHAR,
  url VARCHAR,
  content_hash VARCHAR,
  last_verified TIMESTAMP,
  created_at TIMESTAMP DEFAULT current_timestamp
)`,

  // 8. Join: fragment <-> domain
  `CREATE TABLE IF NOT EXISTS fragment_domains (
  fragment_id VARCHAR NOT NULL,
  domain_id VARCHAR NOT NULL,
  relevance_score DOUBLE DEFAULT 0.5,
  PRIMARY KEY (fragment_id, domain_id)
)`,

  // 9. Join: fragment <-> entity
  `CREATE TABLE IF NOT EXISTS fragment_entities (
  fragment_id VARCHAR NOT NULL,
  entity_id VARCHAR NOT NULL,
  relationship_type VARCHAR,
  PRIMARY KEY (fragment_id, entity_id)
)`,

  // 10. Join: fragment <-> attention_tag
  `CREATE TABLE IF NOT EXISTS fragment_attention_tags (
  fragment_id VARCHAR NOT NULL,
  tag_id VARCHAR NOT NULL,
  PRIMARY KEY (fragment_id, tag_id)
)`,

  // 11. Join: entity <-> domain
  `CREATE TABLE IF NOT EXISTS entity_domains (
  entity_id VARCHAR NOT NULL,
  domain_id VARCHAR NOT NULL,
  strength DOUBLE DEFAULT 0.5,
  PRIMARY KEY (entity_id, domain_id)
)`,

  // 12. Domain hierarchy (parent-child + sibling + bridge relationships)
  `CREATE TABLE IF NOT EXISTS domain_relationships (
  source_domain_id VARCHAR NOT NULL,
  target_domain_id VARCHAR NOT NULL,
  relationship_type VARCHAR NOT NULL,
  strength DOUBLE DEFAULT 0.5,
  PRIMARY KEY (source_domain_id, target_domain_id, relationship_type)
)`,
]);

/**
 * Creates an association index manager for a DuckDB connection.
 *
 * Options-based DI pattern: pass `{ connection }` where `connection` is
 * an open DuckDB connection object from the ledger backend.
 *
 * @param {Object} options
 * @param {Object} options.connection - Open DuckDB connection
 * @returns {{ init: Function, getTableNames: Function }}
 */
function createAssociationIndex(options) {
  const { connection } = options;

  /**
   * Creates all 12 association index tables.
   * Idempotent: uses CREATE TABLE IF NOT EXISTS.
   *
   * @returns {Promise<void>}
   */
  async function init() {
    for (const ddl of DDL_STATEMENTS) {
      await connection.run(ddl);
    }
  }

  /**
   * Returns the list of all 12 table names.
   *
   * @returns {Array<string>}
   */
  function getTableNames() {
    return [...TABLE_NAMES];
  }

  return { init, getTableNames };
}

module.exports = { createAssociationIndex };
