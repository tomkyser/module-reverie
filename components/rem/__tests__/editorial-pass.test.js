'use strict';

const { describe, it, expect, mock, beforeEach } = require('bun:test');

const { createEditorialPass } = require('../editorial-pass.cjs');

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockDeps() {
  const wire = {
    queueWrite: mock(() => ({ ok: true, value: undefined })),
  };
  const switchboard = {
    emit: mock(() => {}),
  };
  const fragmentWriter = {
    writeFragment: mock(() => Promise.resolve({ ok: true, value: { id: 'test', path: 'active/test.md' } })),
    generateFragmentId: mock(() => 'frag-2026-03-25-abcd1234'),
  };
  const config = {};
  return { wire, switchboard, fragmentWriter, config };
}

function makeDomainPairs() {
  return [
    {
      domain_a: { id: 'dom-001', name: 'JavaScript' },
      domain_b: { id: 'dom-002', name: 'TypeScript' },
      overlap_score: 0.85,
      shared_entities: ['react', 'node', 'async-await'],
    },
    {
      domain_a: { id: 'dom-003', name: 'Testing' },
      domain_b: { id: 'dom-004', name: 'QA' },
      overlap_score: 0.6,
      shared_entities: ['assertions', 'coverage'],
    },
  ];
}

function makeEntityList() {
  return [
    { id: 'ent-001', name: 'JavaScript', occurrence_count: 15 },
    { id: 'ent-002', name: 'JS', occurrence_count: 8 },
    { id: 'ent-003', name: 'React', occurrence_count: 12 },
    { id: 'ent-004', name: 'ReactJS', occurrence_count: 3 },
    { id: 'ent-005', name: 'TypeScript', occurrence_count: 10 },
  ];
}

function makeAssociationStats() {
  return [
    { id: 'assoc-001', source_id: 'ent-001', target_id: 'ent-003', weight: 0.7, access_count: 10, last_accessed: '2026-03-25T00:00:00Z' },
    { id: 'assoc-002', source_id: 'ent-002', target_id: 'ent-005', weight: 0.3, access_count: 1, last_accessed: '2026-03-20T00:00:00Z' },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('editorial-pass', () => {
  let deps;
  let editor;

  beforeEach(() => {
    deps = createMockDeps();
    editor = createEditorialPass(deps);
  });

  describe('createEditorialPass', () => {
    it('returns frozen object', () => {
      expect(Object.isFrozen(editor)).toBe(true);
    });

    it('exposes expected API surface', () => {
      expect(typeof editor.run).toBe('function');
      expect(typeof editor.composeEditorialPrompt).toBe('function');
      expect(typeof editor.parseEditorialResponse).toBe('function');
      expect(typeof editor.applyEntityDedup).toBe('function');
      expect(typeof editor.applyWeightUpdates).toBe('function');
      expect(typeof editor.applyDomainMerge).toBe('function');
    });
  });

  describe('composeEditorialPrompt', () => {
    it('creates structured prompt with domain pairs and entity lists', () => {
      const prompt = editor.composeEditorialPrompt(makeDomainPairs(), makeEntityList(), makeAssociationStats());

      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('ENTITY DEDUP');
      expect(prompt).toContain('DOMAIN BOUNDARY REVIEW');
      expect(prompt).toContain('ASSOCIATION WEIGHT UPDATE');
      expect(prompt).toContain('JavaScript');
      expect(prompt).toContain('TypeScript');
      expect(prompt).toContain('dom-001');
      expect(prompt).toContain('dom-002');
    });

    it('includes taxonomy narrative update instructions for domain merge decisions (per D-08)', () => {
      const prompt = editor.composeEditorialPrompt(makeDomainPairs(), makeEntityList(), makeAssociationStats());

      expect(prompt).toContain('TAXONOMY NARRATIVE');
      expect(prompt).toContain('merge_narrative');
      expect(prompt).toContain('consolidation');
    });
  });

  describe('parseEditorialResponse', () => {
    it('extracts merge decisions, entity dedup actions, weight updates, and merge narratives', () => {
      const response = JSON.stringify({
        entity_merges: [
          { keep: 'JavaScript', merge: ['JS'] },
          { keep: 'React', merge: ['ReactJS'] },
        ],
        domain_decisions: [
          {
            domain_a: 'dom-001', domain_b: 'dom-002',
            action: 'merge', reason: 'Highly overlapping',
            merge_narrative: 'JavaScript and TypeScript merged because TypeScript is a superset.',
          },
          {
            domain_a: 'dom-003', domain_b: 'dom-004',
            action: 'keep', reason: 'Different focus areas',
          },
        ],
        weight_updates: [
          { association_id: 'assoc-001', new_weight: 0.85 },
          { association_id: 'assoc-002', new_weight: 0.15 },
        ],
      });

      const parsed = editor.parseEditorialResponse(response);

      expect(parsed.entity_merges).toHaveLength(2);
      expect(parsed.entity_merges[0].keep).toBe('JavaScript');
      expect(parsed.domain_decisions).toHaveLength(2);
      expect(parsed.domain_decisions[0].action).toBe('merge');
      expect(parsed.domain_decisions[0].merge_narrative).toContain('superset');
      expect(parsed.weight_updates).toHaveLength(2);
    });

    it('handles malformed responses gracefully', () => {
      const parsed = editor.parseEditorialResponse('not valid JSON');

      expect(parsed.entity_merges).toHaveLength(0);
      expect(parsed.domain_decisions).toHaveLength(0);
      expect(parsed.weight_updates).toHaveLength(0);
    });
  });

  describe('applyEntityDedup', () => {
    it('creates Wire write-intent envelopes for entity table updates', async () => {
      const entityMerges = [
        { keep: 'JavaScript', merge: ['JS'] },
      ];

      const result = await editor.applyEntityDedup(entityMerges, 'session-1');

      expect(result.entities_deduped).toBe(1);
      // Each merge produces write-intents for entities and fragment_entities tables
      expect(deps.wire.queueWrite).toHaveBeenCalled();
    });
  });

  describe('applyWeightUpdates', () => {
    it('strengthens used associations and weakens unused', async () => {
      const weightUpdates = [
        { association_id: 'assoc-001', new_weight: 0.85 },
        { association_id: 'assoc-002', new_weight: 0.15 },
      ];

      const result = await editor.applyWeightUpdates(weightUpdates, 'session-1');

      expect(result.weights_updated).toBe(2);
      expect(deps.wire.queueWrite).toHaveBeenCalled();
    });
  });

  describe('applyDomainMerge', () => {
    it('updates all fragment_domains rows for merged domain', async () => {
      const domainDecisions = [
        {
          domain_a: 'dom-001', domain_b: 'dom-002',
          action: 'merge', reason: 'overlap',
          merge_narrative: 'Merged JavaScript and TypeScript domains.',
        },
      ];

      const result = await editor.applyDomainMerge(domainDecisions, 'session-1');

      expect(result.domains_merged).toBe(1);
      // Should update fragment_domains and delete merged domain via Wire
      expect(deps.wire.queueWrite).toHaveBeenCalled();
    });

    it('writes taxonomy narrative consolidation fragment to Journal for each merge (per D-08)', async () => {
      const domainDecisions = [
        {
          domain_a: 'dom-001', domain_b: 'dom-002',
          action: 'merge', reason: 'overlap',
          merge_narrative: 'Merged JavaScript and TypeScript domains.',
        },
      ];

      const result = await editor.applyDomainMerge(domainDecisions, 'session-1');

      expect(result.narratives_written).toBe(1);
      // Should call fragmentWriter.writeFragment for the narrative
      expect(deps.fragmentWriter.writeFragment).toHaveBeenCalled();
      // Check fragment type is consolidation
      const callArgs = deps.fragmentWriter.writeFragment.mock.calls[0];
      expect(callArgs[0].type).toBe('consolidation');
    });

    it('skips narrative for non-merge decisions', async () => {
      const domainDecisions = [
        {
          domain_a: 'dom-003', domain_b: 'dom-004',
          action: 'keep', reason: 'different focus',
        },
      ];

      const result = await editor.applyDomainMerge(domainDecisions, 'session-1');

      expect(result.domains_merged).toBe(0);
      expect(result.narratives_written).toBe(0);
      expect(deps.fragmentWriter.writeFragment).not.toHaveBeenCalled();
    });
  });

  describe('run()', () => {
    it('orchestrates: compose prompt -> return apply function', () => {
      const result = editor.run(makeDomainPairs(), makeEntityList(), makeAssociationStats());

      expect(typeof result.prompt).toBe('string');
      expect(typeof result.apply).toBe('function');
    });

    it('returns full stats from apply', async () => {
      const { apply } = editor.run(makeDomainPairs(), makeEntityList(), makeAssociationStats());

      const llmResponse = JSON.stringify({
        entity_merges: [{ keep: 'JavaScript', merge: ['JS'] }],
        domain_decisions: [
          {
            domain_a: 'dom-001', domain_b: 'dom-002',
            action: 'merge', reason: 'overlap',
            merge_narrative: 'Merged domains.',
          },
          {
            domain_a: 'dom-003', domain_b: 'dom-004',
            action: 'keep', reason: 'distinct',
          },
        ],
        weight_updates: [
          { association_id: 'assoc-001', new_weight: 0.9 },
        ],
      });

      const stats = await apply(llmResponse);

      expect(typeof stats.entities_deduped).toBe('number');
      expect(typeof stats.weights_updated).toBe('number');
      expect(typeof stats.domains_merged).toBe('number');
      expect(typeof stats.domains_reviewed).toBe('number');
      expect(typeof stats.narratives_written).toBe('number');

      expect(stats.entities_deduped).toBe(1);
      expect(stats.weights_updated).toBe(1);
      expect(stats.domains_merged).toBe(1);
      expect(stats.domains_reviewed).toBe(2);
      expect(stats.narratives_written).toBe(1);
    });
  });

  describe('Wire write-intent compliance', () => {
    it('all Ledger mutations go through Wire write-intent (never direct Ledger access)', () => {
      // Verify the module does not import or reference Ledger directly
      const fs = require('node:fs');
      const source = fs.readFileSync(require.resolve('../editorial-pass.cjs'), 'utf8');

      // Should NOT contain direct Ledger references
      expect(source).not.toContain('ledger.run(');
      expect(source).not.toContain('ledger.query(');
      expect(source).not.toContain('connection.run(');
      expect(source).not.toContain('connection.query(');

      // Should contain Wire write-intent references
      expect(source).toContain('write-intent');
      expect(source).toContain('WRITE_INTENT');
    });
  });
});
