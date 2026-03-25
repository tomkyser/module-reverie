'use strict';

const { describe, it, expect } = require('bun:test');

describe('attention-gate', () => {
  // Lazy require so RED phase can verify test structure before implementation exists
  let createAttentionGate;

  function loadModule() {
    if (!createAttentionGate) {
      ({ createAttentionGate } = require('../attention-gate.cjs'));
    }
  }

  describe('createAttentionGate', () => {
    it('rejects empty prompt', () => {
      loadModule();
      const gate = createAttentionGate({});
      const result = gate.evaluate({ user_prompt: '' });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('empty_prompt');
    });

    it('rejects null prompt', () => {
      loadModule();
      const gate = createAttentionGate({});
      const result = gate.evaluate({ user_prompt: null });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('empty_prompt');
    });

    it('rejects prompt shorter than 20 chars', () => {
      loadModule();
      const gate = createAttentionGate({});
      const result = gate.evaluate({ user_prompt: 'hi' });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('too_short');
    });

    it('rejects pure tool turn (null prompt + tools used)', () => {
      loadModule();
      const gate = createAttentionGate({});
      const result = gate.evaluate({ user_prompt: null, tools_used: ['Read', 'Edit'] });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('pure_tool_turn');
    });

    it('passes significant user prompt', () => {
      loadModule();
      const gate = createAttentionGate({});
      const result = gate.evaluate({ user_prompt: 'I have been thinking about how we handle deadlines' });
      expect(result.pass).toBe(true);
      expect(result.reason).toBe('passed');
    });

    it('allows configurable minPromptLength via options', () => {
      loadModule();
      const gate = createAttentionGate({ minPromptLength: 5 });
      // 'hello' is 5 chars -- should pass with custom threshold
      const result = gate.evaluate({ user_prompt: 'hello' });
      expect(result.pass).toBe(true);
      expect(result.reason).toBe('passed');
    });

    it('uses default minPromptLength of 20 when not configured', () => {
      loadModule();
      const gate = createAttentionGate({});
      // 'short but over five' is 19 chars -- should fail with default 20
      const result = gate.evaluate({ user_prompt: 'short but over five' });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('too_short');
    });

    it('rejects undefined prompt', () => {
      loadModule();
      const gate = createAttentionGate({});
      const result = gate.evaluate({ user_prompt: undefined });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('empty_prompt');
    });
  });
});
