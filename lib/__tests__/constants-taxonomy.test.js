'use strict';

const { describe, it, expect } = require('bun:test');

const {
  TAXONOMY_DEFAULTS,
  BACKFILL_DEFAULTS,
} = require('../constants.cjs');

describe('TAXONOMY_DEFAULTS', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(TAXONOMY_DEFAULTS)).toBe(true);
  });

  it('has max_domains of 100 (D-06)', () => {
    expect(TAXONOMY_DEFAULTS.max_domains).toBe(100);
  });

  it('has max_entities_per_domain of 200 (D-06)', () => {
    expect(TAXONOMY_DEFAULTS.max_entities_per_domain).toBe(200);
  });

  it('has max_association_edges of 10000 (D-06)', () => {
    expect(TAXONOMY_DEFAULTS.max_association_edges).toBe(10000);
  });

  it('has pressure_threshold of 0.8 (D-06)', () => {
    expect(TAXONOMY_DEFAULTS.pressure_threshold).toBe(0.8);
  });

  it('has split_fragment_threshold of 50 (D-07)', () => {
    expect(TAXONOMY_DEFAULTS.split_fragment_threshold).toBe(50);
  });

  it('has retire_inactive_cycles of 3 (D-08)', () => {
    expect(TAXONOMY_DEFAULTS.retire_inactive_cycles).toBe(3);
  });

  it('has exactly 6 fields', () => {
    expect(Object.keys(TAXONOMY_DEFAULTS)).toHaveLength(6);
  });
});

describe('BACKFILL_DEFAULTS', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(BACKFILL_DEFAULTS)).toBe(true);
  });

  it('has default_batch_size of 10', () => {
    expect(BACKFILL_DEFAULTS.default_batch_size).toBe(10);
  });

  it('has max_fragments_per_conversation of 50', () => {
    expect(BACKFILL_DEFAULTS.max_fragments_per_conversation).toBe(50);
  });

  it('has origin_marker of backfill', () => {
    expect(BACKFILL_DEFAULTS.origin_marker).toBe('backfill');
  });

  it('has exactly 3 fields', () => {
    expect(Object.keys(BACKFILL_DEFAULTS)).toHaveLength(3);
  });
});
