'use strict';

const { describe, it, expect } = require('bun:test');

describe('recall-engine', () => {
  let createRecallEngine;

  function loadModule() {
    if (!createRecallEngine) {
      ({ createRecallEngine } = require('../recall-engine.cjs'));
    }
  }

  // ---------------------------------------------------------------------------
  // Mock factories
  // ---------------------------------------------------------------------------

  function createMockAssay(results) {
    return {
      async search() {
        return { ok: true, value: { results: results || [] } };
      },
    };
  }

  function createMockSelfModel() {
    const aspects = {
      'identity-core': { body: 'I am a thoughtful assistant.' },
      'relational-model': { body: 'We work well together.' },
      'conditioning': { body: 'I tend to ask questions.' },
    };
    return {
      getAspect(name) { return aspects[name] || null; },
    };
  }

  function createMockSwitchboard() {
    const events = [];
    return {
      emit(name, data) { events.push({ name, data }); },
      getEvents() { return events; },
    };
  }

  function makeFragment(overrides) {
    const defaults = {
      id: 'frag-2026-03-24-abcd1234',
      type: 'experiential',
      created: new Date().toISOString(),
      body: 'A moment of connection.',
      domain: 'trust',
      associations: {
        domains: ['trust'],
        entities: ['Tom'],
        attention_tags: ['vulnerability'],
        self_model_relevance: { identity: 0.3, relational: 0.7, conditioning: 0.1 },
        emotional_valence: 0.5,
      },
      decay: {
        current_weight: 0.8,
        initial_weight: 0.8,
      },
    };
    return Object.assign({}, defaults, overrides || {});
  }

  function makeEngine(overrides) {
    loadModule();
    const defaults = {
      assay: createMockAssay([]),
      selfModel: createMockSelfModel(),
      switchboard: createMockSwitchboard(),
    };
    return createRecallEngine(Object.assign(defaults, overrides || {}));
  }

  // ---------------------------------------------------------------------------
  // recallPassive
  // ---------------------------------------------------------------------------

  describe('recallPassive', () => {
    it('queries Assay, ranks with composite scorer, returns top 5 fragments + nudge', async () => {
      const frags = [];
      for (let i = 0; i < 8; i++) {
        frags.push(makeFragment({
          id: `frag-2026-03-24-0000000${i}`,
          associations: {
            domains: ['trust'],
            entities: ['Tom'],
            attention_tags: ['vulnerability'],
            self_model_relevance: { identity: 0.3, relational: 0.7, conditioning: 0.1 },
            emotional_valence: 0.5,
          },
          decay: { current_weight: 0.8 - (i * 0.05) },
        }));
      }

      const engine = makeEngine({ assay: createMockAssay(frags) });
      const result = await engine.recallPassive({
        domains: ['trust'],
        entities: ['Tom'],
        attention_tags: ['vulnerability'],
        user_prompt: 'Tell me about trust.',
        turn_number: 5,
      });

      expect(result.ok).toBe(true);
      expect(result.value.fragments.length).toBeLessThanOrEqual(5);
      expect(result.value.nudgePrompt).not.toBeNull();
      expect(result.value.nudgeText).not.toBeNull();
    });

    it('returns null nudge when no fragments found', async () => {
      const engine = makeEngine({ assay: createMockAssay([]) });
      const result = await engine.recallPassive({
        domains: ['trust'],
        entities: [],
        attention_tags: [],
        user_prompt: 'hello',
        turn_number: 1,
      });

      expect(result.ok).toBe(true);
      expect(result.value.fragments).toEqual([]);
      expect(result.value.nudgePrompt).toBeNull();
      expect(result.value.nudgeText).toBeNull();
    });

    it('returns { fragments, nudgePrompt, nudgeText } structure', async () => {
      const frag = makeFragment();
      const engine = makeEngine({ assay: createMockAssay([frag]) });
      const result = await engine.recallPassive({
        domains: ['trust'],
        entities: ['Tom'],
        attention_tags: ['vulnerability'],
        user_prompt: 'What do you think about trust?',
        turn_number: 3,
      });

      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('fragments');
      expect(result.value).toHaveProperty('nudgePrompt');
      expect(result.value).toHaveProperty('nudgeText');
      expect(typeof result.value.nudgeText).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // recallExplicit
  // ---------------------------------------------------------------------------

  describe('recallExplicit', () => {
    it('queries Assay, ranks with composite scorer, returns top 15 fragments + reconstruction', async () => {
      const frags = [];
      for (let i = 0; i < 20; i++) {
        frags.push(makeFragment({
          id: `frag-2026-03-24-e000000${String(i).padStart(1, '0')}`,
          associations: {
            domains: ['growth'],
            entities: ['Tom'],
            attention_tags: ['learning'],
            self_model_relevance: { identity: 0.5, relational: 0.4, conditioning: 0.2 },
            emotional_valence: 0.3,
          },
          decay: { current_weight: 0.9 - (i * 0.03) },
        }));
      }

      const engine = makeEngine({ assay: createMockAssay(frags) });
      const result = await engine.recallExplicit({
        domains: ['growth'],
        entities: ['Tom'],
        attention_tags: ['learning'],
        user_prompt: 'Show me what you remember about our growth journey.',
        turn_number: 10,
        conversation_summary: 'Discussing growth patterns.',
      });

      expect(result.ok).toBe(true);
      expect(result.value.fragments.length).toBeLessThanOrEqual(15);
      expect(result.value.reconstructionPrompt).not.toBeNull();
      expect(typeof result.value.reconstructionPrompt).toBe('string');
    });

    it('returns null reconstruction when no fragments found', async () => {
      const engine = makeEngine({ assay: createMockAssay([]) });
      const result = await engine.recallExplicit({
        domains: ['unknown'],
        entities: [],
        attention_tags: [],
        user_prompt: 'Remember something?',
        turn_number: 1,
      });

      expect(result.ok).toBe(true);
      expect(result.value.fragments).toEqual([]);
      expect(result.value.reconstructionPrompt).toBeNull();
    });

    it('returns { fragments, reconstructionPrompt } structure', async () => {
      const frag = makeFragment();
      const engine = makeEngine({ assay: createMockAssay([frag]) });
      const result = await engine.recallExplicit({
        domains: ['trust'],
        entities: ['Tom'],
        attention_tags: ['vulnerability'],
        user_prompt: 'Remember our work together?',
        turn_number: 5,
      });

      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('fragments');
      expect(result.value).toHaveProperty('reconstructionPrompt');
    });
  });

  // ---------------------------------------------------------------------------
  // Shared scorer per D-12
  // ---------------------------------------------------------------------------

  describe('shared scorer', () => {
    it('both paths use same composite scorer instance per D-12', async () => {
      // Verify both paths produce scored results with the same scoring structure
      const frag = makeFragment();
      const engine = makeEngine({ assay: createMockAssay([frag]) });

      const passive = await engine.recallPassive({
        domains: ['trust'], entities: ['Tom'], attention_tags: ['vulnerability'],
        user_prompt: 'test', turn_number: 1,
      });
      const explicit = await engine.recallExplicit({
        domains: ['trust'], entities: ['Tom'], attention_tags: ['vulnerability'],
        user_prompt: 'test', turn_number: 1,
      });

      // Both return ranked arrays with score property
      expect(passive.value.fragments[0]).toHaveProperty('score');
      expect(explicit.value.fragments[0]).toHaveProperty('score');
      // Scores should be identical for the same fragment
      expect(passive.value.fragments[0].score).toBe(explicit.value.fragments[0].score);
    });
  });

  // ---------------------------------------------------------------------------
  // getRecallStats
  // ---------------------------------------------------------------------------

  describe('getRecallStats', () => {
    it('returns totalRecalls, passiveRecalls, explicitRecalls', async () => {
      const frag = makeFragment();
      const engine = makeEngine({ assay: createMockAssay([frag]) });

      // Before any recalls
      let stats = engine.getRecallStats();
      expect(stats.totalRecalls).toBe(0);
      expect(stats.passiveRecalls).toBe(0);
      expect(stats.explicitRecalls).toBe(0);

      // After passive recall
      await engine.recallPassive({
        domains: ['trust'], entities: [], attention_tags: [],
        user_prompt: 'test', turn_number: 1,
      });
      stats = engine.getRecallStats();
      expect(stats.totalRecalls).toBe(1);
      expect(stats.passiveRecalls).toBe(1);
      expect(stats.explicitRecalls).toBe(0);

      // After explicit recall
      await engine.recallExplicit({
        domains: ['trust'], entities: [], attention_tags: [],
        user_prompt: 'remember', turn_number: 2,
      });
      stats = engine.getRecallStats();
      expect(stats.totalRecalls).toBe(2);
      expect(stats.passiveRecalls).toBe(1);
      expect(stats.explicitRecalls).toBe(1);
    });
  });
});
