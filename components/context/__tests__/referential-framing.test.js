'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

const {
  FRAMING_TEMPLATES,
  getFramingPrompt,
  createReferentialFraming,
} = require('../referential-framing.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Referential Framing Constants', () => {
  it('FRAMING_TEMPLATES is a frozen object', () => {
    expect(Object.isFrozen(FRAMING_TEMPLATES)).toBe(true);
  });

  it('FRAMING_TEMPLATES has exactly three keys: full, dual, soft', () => {
    const keys = Object.keys(FRAMING_TEMPLATES).sort();
    expect(keys).toEqual(['dual', 'full', 'soft']);
  });

  it('FRAMING_TEMPLATES.full contains "operating frame" and "Self Model directives"', () => {
    expect(FRAMING_TEMPLATES.full).toContain('operating frame');
    expect(FRAMING_TEMPLATES.full).toContain('Self Model directives');
  });

  it('FRAMING_TEMPLATES.dual contains "relational, attentional, and behavioral" and "technical decisions"', () => {
    expect(FRAMING_TEMPLATES.dual).toContain('relational, attentional, and behavioral');
    expect(FRAMING_TEMPLATES.dual).toContain('technical decisions');
  });

  it('FRAMING_TEMPLATES.soft contains "suggestions" or "suggestion"', () => {
    const hasSuggestion = FRAMING_TEMPLATES.soft.includes('suggestion');
    expect(hasSuggestion).toBe(true);
  });

  it('every template fits within 200 tokens (< 800 characters as rough proxy)', () => {
    for (const [mode, template] of Object.entries(FRAMING_TEMPLATES)) {
      expect(template.length).toBeLessThan(800);
    }
  });
});

// ---------------------------------------------------------------------------
// getFramingPrompt
// ---------------------------------------------------------------------------

describe('getFramingPrompt', () => {
  it('getFramingPrompt("full") returns the full template wrapped in referential_frame tags', () => {
    const result = getFramingPrompt('full');
    expect(result.ok).toBe(true);
    expect(result.value).toContain('<referential_frame>');
    expect(result.value).toContain('</referential_frame>');
    expect(result.value).toContain('operating frame');
  });

  it('getFramingPrompt("dual") returns the dual template wrapped in referential_frame tags', () => {
    const result = getFramingPrompt('dual');
    expect(result.ok).toBe(true);
    expect(result.value).toContain('<referential_frame>');
    expect(result.value).toContain('</referential_frame>');
    expect(result.value).toContain('technical decisions');
  });

  it('getFramingPrompt("soft") returns the soft template wrapped in referential_frame tags', () => {
    const result = getFramingPrompt('soft');
    expect(result.ok).toBe(true);
    expect(result.value).toContain('<referential_frame>');
    expect(result.value).toContain('</referential_frame>');
    expect(result.value).toContain('suggestion');
  });

  it('getFramingPrompt("invalid") returns err with INVALID_FRAMING_MODE', () => {
    const result = getFramingPrompt('invalid');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_FRAMING_MODE');
  });

  it('getFramingPrompt with invalid mode includes valid modes in error context', () => {
    const result = getFramingPrompt('invalid');
    expect(result.ok).toBe(false);
    expect(result.error.context).toBeDefined();
    expect(result.error.context.validModes).toEqual(['full', 'dual', 'soft']);
  });
});

// ---------------------------------------------------------------------------
// createReferentialFraming
// ---------------------------------------------------------------------------

describe('createReferentialFraming', () => {
  let framing;

  beforeEach(() => {
    framing = createReferentialFraming({ mode: 'dual' });
  });

  it('returns an instance with getPrompt, getMode, setMode methods', () => {
    expect(typeof framing.getPrompt).toBe('function');
    expect(typeof framing.getMode).toBe('function');
    expect(typeof framing.setMode).toBe('function');
  });

  it('defaults to dual mode', () => {
    const defaultFraming = createReferentialFraming();
    expect(defaultFraming.getMode()).toBe('dual');
  });

  it('getMode returns the current mode', () => {
    expect(framing.getMode()).toBe('dual');
  });

  it('getPrompt returns the current mode template string', () => {
    const prompt = framing.getPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('technical decisions');
  });

  it('setMode("full") changes the active mode and getPrompt returns full template', () => {
    const result = framing.setMode('full');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('full');
    expect(framing.getMode()).toBe('full');
    expect(framing.getPrompt()).toContain('operating frame');
  });

  it('setMode("soft") changes to soft mode', () => {
    const result = framing.setMode('soft');
    expect(result.ok).toBe(true);
    expect(framing.getMode()).toBe('soft');
    expect(framing.getPrompt()).toContain('suggestion');
  });

  it('setMode("invalid") returns err and does not change mode', () => {
    const result = framing.setMode('invalid');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_FRAMING_MODE');
    expect(framing.getMode()).toBe('dual');
  });

  it('rejects invalid initial mode in constructor', () => {
    expect(() => createReferentialFraming({ mode: 'nonexistent' })).toThrow();
  });
});
