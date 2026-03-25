'use strict';

const { describe, it, expect, beforeEach, afterEach, mock } = require('bun:test');

const {
  ROLE_COLORS,
  ROLE_LABELS,
  RESET,
  setTerminalTitle,
  formatPrefix,
} = require('./visual-markers.cjs');

describe('visual-markers', () => {
  describe('ROLE_COLORS', () => {
    it('has Face, Mind, Subconscious keys', () => {
      expect(ROLE_COLORS).toHaveProperty('Face');
      expect(ROLE_COLORS).toHaveProperty('Mind');
      expect(ROLE_COLORS).toHaveProperty('Subconscious');
    });

    it('uses ANSI 256-color escape codes', () => {
      // Each should start with \x1b[38;5;
      expect(ROLE_COLORS.Face).toContain('\x1b[38;5;');
      expect(ROLE_COLORS.Mind).toContain('\x1b[38;5;');
      expect(ROLE_COLORS.Subconscious).toContain('\x1b[38;5;');
    });

    it('assigns distinct colors to each role', () => {
      expect(ROLE_COLORS.Face).not.toBe(ROLE_COLORS.Mind);
      expect(ROLE_COLORS.Mind).not.toBe(ROLE_COLORS.Subconscious);
      expect(ROLE_COLORS.Face).not.toBe(ROLE_COLORS.Subconscious);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ROLE_COLORS)).toBe(true);
    });
  });

  describe('ROLE_LABELS', () => {
    it('maps identity strings to display names', () => {
      expect(ROLE_LABELS.primary).toBe('Face');
      expect(ROLE_LABELS.secondary).toBe('Mind');
      expect(ROLE_LABELS.tertiary).toBe('Subconscious');
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ROLE_LABELS)).toBe(true);
    });
  });

  describe('RESET', () => {
    it('is the ANSI reset sequence', () => {
      expect(RESET).toBe('\x1b[0m');
    });
  });

  describe('setTerminalTitle', () => {
    let writtenData;
    let originalWrite;

    beforeEach(() => {
      writtenData = '';
      originalWrite = process.stdout.write;
      process.stdout.write = (data) => {
        writtenData += data;
        return true;
      };
    });

    afterEach(() => {
      process.stdout.write = originalWrite;
    });

    it('writes escape sequence containing Dynamo + role + hash', () => {
      setTerminalTitle('Face', 'a1b2');
      expect(writtenData).toContain('Dynamo Face a1b2');
    });

    it('uses OSC title escape sequence', () => {
      setTerminalTitle('Mind', 'c3d4');
      // OSC sequence: \x1b]0;...\x07
      expect(writtenData).toContain('\x1b]0;');
      expect(writtenData).toContain('\x07');
    });
  });

  describe('formatPrefix', () => {
    it('returns string containing [Face a1b2]', () => {
      const prefix = formatPrefix('Face', 'a1b2');
      expect(prefix).toContain('[Face a1b2]');
    });

    it('returns string containing [Mind a1b2]', () => {
      const prefix = formatPrefix('Mind', 'a1b2');
      expect(prefix).toContain('[Mind a1b2]');
    });

    it('returns string containing [Subconscious a1b2]', () => {
      const prefix = formatPrefix('Subconscious', 'a1b2');
      expect(prefix).toContain('[Subconscious a1b2]');
    });

    it('includes ANSI color code for known roles', () => {
      const prefix = formatPrefix('Face', 'a1b2');
      expect(prefix).toContain(ROLE_COLORS.Face);
    });

    it('includes ANSI reset at end', () => {
      const prefix = formatPrefix('Face', 'a1b2');
      expect(prefix).toContain(RESET);
    });
  });
});
