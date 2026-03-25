'use strict';

const { describe, it, expect } = require('bun:test');

const {
  generateTripletId,
  makeTripletSessionId,
  extractTripletId,
  extractIdentity,
  extractShortHash,
} = require('./triplet.cjs');

describe('triplet', () => {
  describe('generateTripletId', () => {
    it('returns a string matching triplet-{4-hex-char}', () => {
      const id = generateTripletId();
      expect(id).toMatch(/^triplet-[0-9a-f]{4}$/);
    });

    it('generates unique IDs on successive calls', () => {
      const ids = new Set();
      for (let i = 0; i < 50; i++) {
        ids.add(generateTripletId());
      }
      // With 2 bytes of randomness (65536 possibilities), 50 calls should be unique
      expect(ids.size).toBe(50);
    });
  });

  describe('makeTripletSessionId', () => {
    it('joins triplet ID and identity with colon', () => {
      expect(makeTripletSessionId('triplet-a1b2', 'primary')).toBe('triplet-a1b2:primary');
    });

    it('works for all identity values', () => {
      expect(makeTripletSessionId('triplet-a1b2', 'secondary')).toBe('triplet-a1b2:secondary');
      expect(makeTripletSessionId('triplet-a1b2', 'tertiary')).toBe('triplet-a1b2:tertiary');
    });
  });

  describe('extractTripletId', () => {
    it('extracts triplet ID from session ID', () => {
      expect(extractTripletId('triplet-a1b2:primary')).toBe('triplet-a1b2');
    });

    it('returns null when no colon present', () => {
      expect(extractTripletId('no-colon')).toBeNull();
    });

    it('handles multiple colons by taking before first', () => {
      expect(extractTripletId('triplet-a1b2:primary:extra')).toBe('triplet-a1b2');
    });
  });

  describe('extractIdentity', () => {
    it('extracts identity from session ID', () => {
      expect(extractIdentity('triplet-a1b2:secondary')).toBe('secondary');
    });

    it('returns null when no colon present', () => {
      expect(extractIdentity('no-colon')).toBeNull();
    });
  });

  describe('extractShortHash', () => {
    it('extracts hash from triplet ID', () => {
      expect(extractShortHash('triplet-a1b2')).toBe('a1b2');
    });

    it('extracts hash from full session ID', () => {
      expect(extractShortHash('triplet-a1b2:primary')).toBe('a1b2');
    });
  });
});
