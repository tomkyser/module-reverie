'use strict';

const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const { createAssociationIndex } = require('../association-index.cjs');

/**
 * Expected table names for the full 12-table association index.
 */
const EXPECTED_TABLES = [
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
];

let duckdb;
let instance;
let connection;

beforeEach(async () => {
  duckdb = require('@duckdb/node-api');
  instance = await duckdb.DuckDBInstance.create(':memory:');
  connection = await instance.connect();
});

afterEach(async () => {
  if (connection) {
    connection.closeSync();
    connection = null;
  }
  if (instance) {
    instance.closeSync();
    instance = null;
  }
});

describe('Association Index', () => {
  it('creates all 12 tables in DuckDB via init()', async () => {
    const index = createAssociationIndex({ connection });
    await index.init();

    const result = await connection.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
    );
    const tableNames = result.getRowObjects().map(r => r.table_name);

    for (const expected of EXPECTED_TABLES) {
      expect(tableNames).toContain(expected);
    }
    expect(tableNames.length).toBe(12);
  });

  it('getTableNames() returns all 12 table name strings', () => {
    const index = createAssociationIndex({ connection });
    const names = index.getTableNames();
    expect(names.length).toBe(12);
    for (const expected of EXPECTED_TABLES) {
      expect(names).toContain(expected);
    }
  });

  it('each table has correct columns (spot check domains table)', async () => {
    const index = createAssociationIndex({ connection });
    await index.init();

    const result = await connection.runAndReadAll(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'domains' ORDER BY ordinal_position"
    );
    const columns = result.getRowObjects();
    const colNames = columns.map(c => c.column_name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('description');
    expect(colNames).toContain('parent_domain_id');
    expect(colNames).toContain('fragment_count');
    expect(colNames).toContain('weight');
    expect(colNames).toContain('narrative_version');
    expect(colNames).toContain('archived');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  it('tables are idempotent -- calling init() twice does not error', async () => {
    const index = createAssociationIndex({ connection });
    await index.init();
    // Second call should not throw
    await index.init();

    const result = await connection.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    );
    const tableNames = result.getRowObjects().map(r => r.table_name);
    expect(tableNames.length).toBe(12);
  });

  it('uses INTEGER for count columns (not BIGINT)', async () => {
    const index = createAssociationIndex({ connection });
    await index.init();

    // Check fragment_count in domains is INTEGER
    const result = await connection.runAndReadAll(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'domains' AND column_name = 'fragment_count'"
    );
    const rows = result.getRowObjects();
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('INTEGER');
  });

  it('uses DOUBLE for weight/score columns', async () => {
    const index = createAssociationIndex({ connection });
    await index.init();

    const result = await connection.runAndReadAll(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'domains' AND column_name = 'weight'"
    );
    const rows = result.getRowObjects();
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('DOUBLE');
  });

  it('uses VARCHAR for ID columns', async () => {
    const index = createAssociationIndex({ connection });
    await index.init();

    const result = await connection.runAndReadAll(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'domains' AND column_name = 'id'"
    );
    const rows = result.getRowObjects();
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('VARCHAR');
  });
});
