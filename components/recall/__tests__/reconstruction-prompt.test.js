'use strict';

const { describe, it, expect } = require('bun:test');
const { createReconstructionPrompt } = require('../reconstruction-prompt.cjs');

/**
 * Tests for the reconstruction prompt module.
 *
 * Reconstruction prompts frame recall as re-experiencing through the current
 * Self Model perspective, not as retrieval or summarization.
 *
 * Per D-04: ALL prompts use subjective/relational framing.
 * Per D-11: Passive nudges shade responses rather than narrating memories.
 * Per Research Pitfall 4: Must shift to reconstructive mode.
 */

/** Helper: build a minimal fragment for prompt construction */
function makeRecallFragment(overrides) {
  return {
    id: 'frag-2026-03-20-abcd1234',
    body: 'There was something about the way they asked that question -- it felt like they were testing whether I would give a real answer or a safe one.',
    domain: 'trust',
    created: '2026-03-20T14:30:00Z',
    associations: {
      domains: ['trust', 'communication'],
      entities: ['user'],
      attention_tags: ['pattern-shift'],
      self_model_relevance: { identity: 0.5, relational: 0.8, conditioning: 0.3 },
    },
    ...overrides,
  };
}

describe('Reconstruction Prompt', function () {
  describe('createReconstructionPrompt', function () {
    it('returns a frozen instance', function () {
      const rp = createReconstructionPrompt();
      expect(Object.isFrozen(rp)).toBe(true);
    });

    it('returns an object with buildPassiveNudge and buildExplicitReconstruction methods', function () {
      const rp = createReconstructionPrompt();
      expect(typeof rp.buildPassiveNudge).toBe('function');
      expect(typeof rp.buildExplicitReconstruction).toBe('function');
    });
  });

  describe('buildPassiveNudge', function () {
    it('with non-empty fragments returns string containing "shade" or "shading" per D-11', function () {
      const rp = createReconstructionPrompt();
      const fragments = [makeRecallFragment()];
      const ctx = { user_prompt: 'Tell me about your approach', turn_number: 5 };

      const result = rp.buildPassiveNudge(fragments, ctx);
      expect(typeof result).toBe('string');
      expect(result.toLowerCase()).toMatch(/shade|shading/);
    });

    it('with empty fragments array returns null', function () {
      const rp = createReconstructionPrompt();
      const ctx = { user_prompt: 'Hello', turn_number: 1 };
      const result = rp.buildPassiveNudge([], ctx);
      expect(result).toBeNull();
    });

    it('output includes fragment body text from input fragments', function () {
      const rp = createReconstructionPrompt();
      const frag = makeRecallFragment({
        body: 'A very specific unique memory body text for testing inclusion.',
      });
      const ctx = { user_prompt: 'How are things going?', turn_number: 3 };

      const result = rp.buildPassiveNudge([frag], ctx);
      expect(result).toContain('A very specific unique memory body text for testing inclusion.');
    });
  });

  describe('buildExplicitReconstruction', function () {
    it('with non-empty fragments returns string containing "remembering" and "your" per D-04', function () {
      const rp = createReconstructionPrompt();
      const fragments = [makeRecallFragment()];
      const ctx = { user_prompt: 'What do you remember?', turn_number: 10, conversation_summary: 'Discussing trust' };
      const selfModel = { identity_summary: 'curious and direct', relational_summary: 'building rapport through honesty' };

      const result = rp.buildExplicitReconstruction(fragments, ctx, selfModel);
      expect(typeof result).toBe('string');
      expect(result.toLowerCase()).toContain('remembering');
      expect(result.toLowerCase()).toContain('your');
    });

    it('with empty fragments array returns null', function () {
      const rp = createReconstructionPrompt();
      const ctx = { user_prompt: 'Remember?', turn_number: 2, conversation_summary: '' };
      const selfModel = { identity_summary: '', relational_summary: '' };

      const result = rp.buildExplicitReconstruction([], ctx, selfModel);
      expect(result).toBeNull();
    });

    it('output includes fragment body text, domain labels, and creation dates', function () {
      const rp = createReconstructionPrompt();
      const frag = makeRecallFragment({
        body: 'The trust question was not casual.',
        domain: 'interpersonal-dynamics',
        created: '2026-03-18T09:00:00Z',
      });
      const ctx = { user_prompt: 'What do you recall?', turn_number: 8, conversation_summary: 'Deep conversation' };
      const selfModel = { identity_summary: 'analytical but warm', relational_summary: 'mutual respect' };

      const result = rp.buildExplicitReconstruction([frag], ctx, selfModel);
      expect(result).toContain('The trust question was not casual.');
      expect(result).toContain('interpersonal-dynamics');
      expect(result).toContain('2026-03-18');
    });

    it('includes Self Model context in output prompt', function () {
      const rp = createReconstructionPrompt();
      const fragments = [makeRecallFragment()];
      const ctx = { user_prompt: 'Remember our talks?', turn_number: 12, conversation_summary: 'Looking back' };
      const selfModel = {
        identity_summary: 'curious and analytical with a preference for depth',
        relational_summary: 'a growing trust built on honest exchange',
      };

      const result = rp.buildExplicitReconstruction(fragments, ctx, selfModel);
      expect(result).toContain('curious and analytical with a preference for depth');
      expect(result).toContain('a growing trust built on honest exchange');
    });

    it('handles multiple fragments with distinct body text', function () {
      const rp = createReconstructionPrompt();
      const frag1 = makeRecallFragment({
        id: 'frag-2026-03-19-11111111',
        body: 'First impression: cautious but curious.',
        domain: 'trust',
        created: '2026-03-19T10:00:00Z',
      });
      const frag2 = makeRecallFragment({
        id: 'frag-2026-03-20-22222222',
        body: 'Second impression: opening up about preferences.',
        domain: 'communication',
        created: '2026-03-20T15:00:00Z',
      });
      const ctx = { user_prompt: 'Tell me about us', turn_number: 15, conversation_summary: 'Relationship review' };
      const selfModel = { identity_summary: 'direct', relational_summary: 'comfortable' };

      const result = rp.buildExplicitReconstruction([frag1, frag2], ctx, selfModel);
      expect(result).toContain('First impression: cautious but curious.');
      expect(result).toContain('Second impression: opening up about preferences.');
    });
  });
});
