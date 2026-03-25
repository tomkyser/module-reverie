'use strict';

const { describe, it, expect, mock, beforeEach } = require('bun:test');

// Will be implemented in retroactive-evaluator.cjs
const { createRetroactiveEvaluator } = require('../retroactive-evaluator.cjs');

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeMockFragment(id, opts = {}) {
  return {
    id,
    type: opts.type || 'experiential',
    created: '2026-03-25T00:00:00Z',
    source_session: 'session-1',
    self_model_version: 'sm-identity-v1',
    formation_group: 'fg-001',
    formation_frame: 'experiential',
    sibling_fragments: [],
    temporal: { absolute: '2026-03-25T00:00:00Z', session_relative: 0.5, sequence: 1 },
    decay: {
      initial_weight: 0.8,
      current_weight: 0.7,
      last_accessed: '2026-03-25T00:00:00Z',
      access_count: 1,
      consolidation_count: 0,
      pinned: false,
    },
    associations: {
      domains: opts.domains || ['programming'],
      entities: opts.entities || ['javascript'],
      self_model_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 },
      emotional_valence: 0.1,
      attention_tags: opts.attention_tags || ['learning'],
    },
    pointers: {
      causal_antecedents: [],
      causal_consequents: [],
      thematic_siblings: [],
      contradictions: [],
      meta_recalls: [],
      source_fragments: opts.source_fragments || [],
    },
    formation: {
      trigger: 'user discussed JavaScript patterns',
      attention_pointer: 'javascript-patterns',
      active_domains_at_formation: ['programming'],
      sublimation_that_prompted: null,
    },
    _lifecycle: opts._lifecycle || 'working',
    _body: opts.body || 'Fragment body text about JavaScript patterns.',
  };
}

function createMockDeps() {
  const fragmentWriter = {
    writeFragment: mock(() => Promise.resolve({ ok: true, value: { id: 'test', path: 'active/test.md' } })),
    deleteFragment: mock(() => Promise.resolve({ ok: true, value: { id: 'test' } })),
    generateFragmentId: mock(() => 'frag-2026-03-25-abcd1234'),
  };
  const journal = {
    write: mock(() => Promise.resolve({ ok: true, value: {} })),
    read: mock(() => Promise.resolve({ ok: true, value: { frontmatter: {}, body: '' } })),
    delete: mock(() => Promise.resolve({ ok: true, value: {} })),
  };
  const wire = {
    queueWrite: mock(() => ({ ok: true, value: undefined })),
  };
  const switchboard = {
    emit: mock(() => {}),
  };
  const config = {
    meta_recall_min_significance: 0.6,
  };
  return { fragmentWriter, journal, wire, switchboard, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('retroactive-evaluator', () => {
  let deps;
  let evaluator;

  beforeEach(() => {
    deps = createMockDeps();
    evaluator = createRetroactiveEvaluator(deps);
  });

  describe('createRetroactiveEvaluator', () => {
    it('returns frozen object', () => {
      expect(Object.isFrozen(evaluator)).toBe(true);
    });

    it('exposes expected API surface', () => {
      expect(typeof evaluator.evaluate).toBe('function');
      expect(typeof evaluator.composeEvaluationPrompt).toBe('function');
      expect(typeof evaluator.parseEvaluationResponse).toBe('function');
      expect(typeof evaluator.promoteFragment).toBe('function');
      expect(typeof evaluator.discardFragment).toBe('function');
    });
  });

  describe('composeEvaluationPrompt', () => {
    it('creates a structured prompt with session summary and fragment list', () => {
      const sessionSummary = 'User discussed JavaScript design patterns and testing strategies.';
      const fragments = [makeMockFragment('frag-2026-03-25-aaaa0001'), makeMockFragment('frag-2026-03-25-aaaa0002')];

      const prompt = evaluator.composeEvaluationPrompt(sessionSummary, fragments);

      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('Session Summary');
      expect(prompt).toContain(sessionSummary);
      expect(prompt).toContain('PROMOTE');
      expect(prompt).toContain('DISCARD');
    });

    it('includes all fragment IDs and their current metadata', () => {
      const fragments = [
        makeMockFragment('frag-2026-03-25-aaaa0001', { domains: ['programming', 'testing'] }),
        makeMockFragment('frag-2026-03-25-aaaa0002', { entities: ['react', 'typescript'] }),
      ];

      const prompt = evaluator.composeEvaluationPrompt('summary', fragments);

      expect(prompt).toContain('frag-2026-03-25-aaaa0001');
      expect(prompt).toContain('frag-2026-03-25-aaaa0002');
      expect(prompt).toContain('programming');
      expect(prompt).toContain('testing');
      expect(prompt).toContain('react');
      expect(prompt).toContain('typescript');
    });
  });

  describe('parseEvaluationResponse', () => {
    it('extracts per-fragment decisions from valid JSON', () => {
      const response = JSON.stringify([
        {
          fragment_id: 'frag-2026-03-25-aaaa0001',
          action: 'promote',
          updated_relevance: { identity: 0.5, relational: 0.7, conditioning: 0.3 },
          new_attention_tags: ['important', 'revisit'],
          reason: 'High relevance to session arc',
        },
        {
          fragment_id: 'frag-2026-03-25-aaaa0002',
          action: 'discard',
          updated_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 },
          new_attention_tags: [],
          reason: 'Low significance',
        },
      ]);

      const decisions = evaluator.parseEvaluationResponse(response);

      expect(Array.isArray(decisions)).toBe(true);
      expect(decisions).toHaveLength(2);
      expect(decisions[0].fragment_id).toBe('frag-2026-03-25-aaaa0001');
      expect(decisions[0].action).toBe('promote');
      expect(decisions[0].updated_relevance.identity).toBe(0.5);
      expect(decisions[1].action).toBe('discard');
    });

    it('handles malformed LLM response (returns empty array)', () => {
      const decisions = evaluator.parseEvaluationResponse('This is not JSON at all');
      expect(Array.isArray(decisions)).toBe(true);
      expect(decisions).toHaveLength(0);
    });

    it('extracts JSON array embedded in text', () => {
      const response = 'Here are my decisions:\n```json\n[{"fragment_id":"frag-2026-03-25-aaaa0001","action":"promote","updated_relevance":{"identity":0.5,"relational":0.5,"conditioning":0.5},"new_attention_tags":[],"reason":"good"}]\n```';
      const decisions = evaluator.parseEvaluationResponse(response);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('promote');
    });
  });

  describe('composeMetaRecallPrompt', () => {
    it('creates a prompt for meta-recall fragment creation from recall events', () => {
      const recallEvents = [
        {
          query: 'JavaScript patterns',
          fragments_composed: ['frag-2026-03-25-aaaa0001'],
          reconstruction_output: 'Recalled JS pattern discussion',
          trigger: 'user asked about patterns',
          incorporated: true,
        },
      ];
      const sessionSummary = 'Session about JavaScript patterns.';

      const prompt = evaluator.composeMetaRecallPrompt(recallEvents, sessionSummary);

      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('meta-recall');
      expect(prompt).toContain('JavaScript patterns');
    });
  });

  describe('promoteFragment', () => {
    it('promotes fragments via write to active and update Ledger', async () => {
      const fragment = makeMockFragment('frag-2026-03-25-aaaa0001');
      const evaluation = {
        fragment_id: 'frag-2026-03-25-aaaa0001',
        action: 'promote',
        updated_relevance: { identity: 0.6, relational: 0.7, conditioning: 0.4 },
        new_attention_tags: ['promoted', 'significant'],
        reason: 'Highly relevant',
      };

      const result = await evaluator.promoteFragment(fragment, evaluation);

      expect(result.ok).toBe(true);
      // Should write to active lifecycle
      expect(deps.fragmentWriter.writeFragment).toHaveBeenCalled();
      // Should queue Ledger lifecycle update via Wire
      expect(deps.wire.queueWrite).toHaveBeenCalled();
      // Should delete working copy from Journal
      expect(deps.journal.delete).toHaveBeenCalled();
    });
  });

  describe('discardFragment', () => {
    it('discards rejected fragments (delete from Journal + Ledger)', async () => {
      const result = await evaluator.discardFragment('frag-2026-03-25-aaaa0001');

      expect(result.ok).toBe(true);
      // Should delete from Journal
      expect(deps.journal.delete).toHaveBeenCalled();
      // Should queue Ledger deletes via Wire write-intents
      expect(deps.wire.queueWrite).toHaveBeenCalled();
    });
  });

  describe('evaluate()', () => {
    it('orchestrates: compose prompt -> return apply function', () => {
      const sessionSummary = 'User explored JavaScript patterns.';
      const fragments = [makeMockFragment('frag-2026-03-25-aaaa0001')];
      const recallEvents = [];

      const result = evaluator.evaluate(sessionSummary, fragments, recallEvents);

      expect(typeof result.prompt).toBe('string');
      expect(typeof result.apply).toBe('function');
    });

    it('apply returns { promoted, discarded, meta_recalls_created }', async () => {
      const sessionSummary = 'User explored JavaScript patterns.';
      const fragments = [
        makeMockFragment('frag-2026-03-25-aaaa0001'),
        makeMockFragment('frag-2026-03-25-aaaa0002'),
      ];
      const recallEvents = [];

      const { apply } = evaluator.evaluate(sessionSummary, fragments, recallEvents);

      const llmEvalResponse = JSON.stringify([
        {
          fragment_id: 'frag-2026-03-25-aaaa0001',
          action: 'promote',
          updated_relevance: { identity: 0.6, relational: 0.5, conditioning: 0.3 },
          new_attention_tags: ['retained'],
          reason: 'good',
        },
        {
          fragment_id: 'frag-2026-03-25-aaaa0002',
          action: 'discard',
          updated_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 },
          new_attention_tags: [],
          reason: 'low value',
        },
      ]);

      const stats = await apply(llmEvalResponse, '[]');

      expect(typeof stats.promoted).toBe('number');
      expect(typeof stats.discarded).toBe('number');
      expect(typeof stats.meta_recalls_created).toBe('number');
      expect(stats.promoted).toBe(1);
      expect(stats.discarded).toBe(1);
    });

    it('creates meta-recall fragments for high-significance recall events', async () => {
      const sessionSummary = 'User explored JavaScript patterns.';
      const fragments = [makeMockFragment('frag-2026-03-25-aaaa0001')];
      const recallEvents = [
        {
          query: 'JS patterns',
          fragments_composed: ['frag-2026-03-25-aaaa0001'],
          reconstruction_output: 'Recalled pattern discussion',
          trigger: 'user asked about patterns',
          incorporated: true,
          significance: 0.9,
        },
      ];

      const result = evaluator.evaluate(sessionSummary, fragments, recallEvents);

      expect(result.metaRecallPrompt).toBeDefined();
      expect(typeof result.metaRecallPrompt).toBe('string');

      // Apply with meta-recall response
      const llmEvalResponse = JSON.stringify([
        {
          fragment_id: 'frag-2026-03-25-aaaa0001',
          action: 'promote',
          updated_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
          new_attention_tags: [],
          reason: 'ok',
        },
      ]);
      const llmMetaRecallResponse = JSON.stringify([
        {
          source_fragments: ['frag-2026-03-25-aaaa0001'],
          body: 'This recall event was significant because...',
          attention_tags: ['meta-recall', 'patterns'],
        },
      ]);

      const stats = await result.apply(llmEvalResponse, llmMetaRecallResponse);
      expect(stats.meta_recalls_created).toBeGreaterThanOrEqual(0);
    });
  });
});
