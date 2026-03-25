'use strict';

const { describe, it, expect, mock, beforeEach } = require('bun:test');

const { createEditorialPass } = require('../../rem/editorial-pass.cjs');

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
  const taxonomyGovernor = {
    applyDomainSplit: mock(() => Promise.resolve({ children_created: 2, fragments_redistributed: 5 })),
    applyDomainRetire: mock(() => Promise.resolve({ domain_id: 'dom-retired', archived: true })),
    writeTaxonomyNarrative: mock(() => Promise.resolve({ ok: true, value: { id: 'narrative-frag' } })),
  };
  const config = {};
  return { wire, switchboard, fragmentWriter, taxonomyGovernor, config };
}

function makeDomainPairs() {
  return [
    {
      domain_a: { id: 'dom-001', name: 'JavaScript' },
      domain_b: { id: 'dom-002', name: 'TypeScript' },
      overlap_score: 0.85,
      shared_entities: ['react', 'node'],
    },
  ];
}

function makeEntityList() {
  return [
    { id: 'ent-001', name: 'JavaScript', occurrence_count: 15 },
  ];
}

function makeAssociationStats() {
  return [
    { id: 'assoc-001', source_id: 'ent-001', target_id: 'ent-003', weight: 0.7, access_count: 10, last_accessed: '2026-03-25T00:00:00Z' },
  ];
}

function makeCapPressure(options = {}) {
  return {
    domainCount: options.domainCount || 85,
    maxEntityCount: options.maxEntityCount || 150,
    edgeCount: options.edgeCount || 5000,
    domainPressure: options.domainPressure || 0.85,
    entityPressure: options.entityPressure || 0.75,
    edgePressure: options.edgePressure || 0.5,
    isUnderPressure: options.isUnderPressure !== undefined ? options.isUnderPressure : true,
    pressureText: options.pressureText || 'Consider merging near-synonym domains and retiring inactive domains.',
    splitCandidates: options.splitCandidates || [],
    retireCandidates: options.retireCandidates || [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('editorial-governance', () => {
  let deps;
  let editor;

  beforeEach(() => {
    deps = createMockDeps();
    editor = createEditorialPass(deps);
  });

  // -------------------------------------------------------------------------
  // Prompt Extension Tests
  // -------------------------------------------------------------------------

  describe('composeEditorialPrompt with capPressure', () => {
    it('includes DOMAIN SPLIT REVIEW section when splitCandidates not empty', () => {
      const capPressure = makeCapPressure({
        splitCandidates: [
          { domain_id: 'dom-dense', domain_name: 'Dense Domain', fragment_count: 55 },
        ],
      });

      const prompt = editor.composeEditorialPrompt(makeDomainPairs(), makeEntityList(), makeAssociationStats(), capPressure);

      expect(prompt).toContain('DOMAIN SPLIT REVIEW');
      expect(prompt).toContain('Dense Domain');
      expect(prompt).toContain('dom-dense');
      expect(prompt).toContain('55 fragments');
    });

    it('includes DOMAIN RETIREMENT REVIEW section when retireCandidates not empty', () => {
      const capPressure = makeCapPressure({
        retireCandidates: [
          { domain_id: 'dom-stale', domain_name: 'Stale Domain', inactive_cycles: 5 },
        ],
      });

      const prompt = editor.composeEditorialPrompt(makeDomainPairs(), makeEntityList(), makeAssociationStats(), capPressure);

      expect(prompt).toContain('DOMAIN RETIREMENT REVIEW');
      expect(prompt).toContain('Stale Domain');
      expect(prompt).toContain('dom-stale');
      expect(prompt).toContain('5 REM cycles');
    });

    it('includes CAP PRESSURE section when isUnderPressure=true', () => {
      const capPressure = makeCapPressure({ isUnderPressure: true });

      const prompt = editor.composeEditorialPrompt(makeDomainPairs(), makeEntityList(), makeAssociationStats(), capPressure);

      expect(prompt).toContain('CAP PRESSURE');
      expect(prompt).toContain('85%');
    });

    it('without capPressure (backward compat) still produces original 4-section prompt', () => {
      const prompt = editor.composeEditorialPrompt(makeDomainPairs(), makeEntityList(), makeAssociationStats());

      expect(prompt).toContain('ENTITY DEDUP');
      expect(prompt).toContain('DOMAIN BOUNDARY REVIEW');
      expect(prompt).toContain('ASSOCIATION WEIGHT UPDATE');
      expect(prompt).toContain('TAXONOMY NARRATIVE');
      expect(prompt).not.toContain('DOMAIN SPLIT REVIEW');
      expect(prompt).not.toContain('DOMAIN RETIREMENT REVIEW');
      expect(prompt).not.toContain('CAP PRESSURE');
    });
  });

  // -------------------------------------------------------------------------
  // Parse Extension Tests
  // -------------------------------------------------------------------------

  describe('parseEditorialResponse with split/retire', () => {
    it('parses domain_splits and domain_retirements from LLM response', () => {
      const response = JSON.stringify({
        entity_merges: [],
        domain_decisions: [],
        weight_updates: [],
        domain_splits: [
          {
            parent_domain: 'dom-dense',
            children: [
              { name: 'Sub A', description: 'First cluster', fragment_ids: ['frag-1', 'frag-2'] },
              { name: 'Sub B', description: 'Second cluster', fragment_ids: ['frag-3'] },
            ],
            split_narrative: 'Split due to high density.',
          },
        ],
        domain_retirements: [
          { domain_id: 'dom-stale', domain_name: 'Stale Domain', retire_narrative: 'Retired after 5 cycles.' },
        ],
      });

      const parsed = editor.parseEditorialResponse(response);

      expect(parsed.domain_splits).toHaveLength(1);
      expect(parsed.domain_splits[0].parent_domain).toBe('dom-dense');
      expect(parsed.domain_splits[0].children).toHaveLength(2);
      expect(parsed.domain_retirements).toHaveLength(1);
      expect(parsed.domain_retirements[0].domain_id).toBe('dom-stale');
    });

    it('returns empty arrays for missing split/retire fields (backward compat)', () => {
      const response = JSON.stringify({
        entity_merges: [],
        domain_decisions: [],
        weight_updates: [],
      });

      const parsed = editor.parseEditorialResponse(response);

      expect(parsed.domain_splits).toHaveLength(0);
      expect(parsed.domain_retirements).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Run + Apply Extension Tests
  // -------------------------------------------------------------------------

  describe('run() with capPressure', () => {
    it('passes pressure to prompt and apply processes split/retire decisions', async () => {
      const capPressure = makeCapPressure({
        splitCandidates: [{ domain_id: 'dom-dense', domain_name: 'Dense', fragment_count: 55 }],
        retireCandidates: [{ domain_id: 'dom-stale', domain_name: 'Stale', inactive_cycles: 4 }],
      });

      const { prompt, apply } = editor.run(makeDomainPairs(), makeEntityList(), makeAssociationStats(), capPressure);

      expect(prompt).toContain('DOMAIN SPLIT REVIEW');
      expect(prompt).toContain('DOMAIN RETIREMENT REVIEW');

      const llmResponse = JSON.stringify({
        entity_merges: [],
        domain_decisions: [],
        weight_updates: [],
        domain_splits: [
          {
            parent_domain: 'dom-dense',
            children: [{ name: 'Sub A', description: 'A', fragment_ids: ['frag-1'] }],
            split_narrative: 'Split.',
          },
        ],
        domain_retirements: [
          { domain_id: 'dom-stale', domain_name: 'Stale', retire_narrative: 'Retired.' },
        ],
      });

      const stats = await apply(llmResponse);

      expect(stats.splits_applied).toBe(1);
      expect(stats.retirements_applied).toBe(1);
    });
  });

  describe('apply delegates to taxonomyGovernor', () => {
    it('processes domain_splits by calling taxonomyGovernor.applyDomainSplit', async () => {
      const { apply } = editor.run(makeDomainPairs(), makeEntityList(), makeAssociationStats());

      const llmResponse = JSON.stringify({
        entity_merges: [],
        domain_decisions: [],
        weight_updates: [],
        domain_splits: [
          {
            parent_domain: 'dom-dense',
            children: [{ name: 'Sub A', description: 'A', fragment_ids: ['frag-1'] }],
            split_narrative: 'Split it.',
          },
        ],
        domain_retirements: [],
      });

      await apply(llmResponse);

      expect(deps.taxonomyGovernor.applyDomainSplit).toHaveBeenCalled();
      const splitCall = deps.taxonomyGovernor.applyDomainSplit.mock.calls[0];
      expect(splitCall[0]).toBe('dom-dense');
    });

    it('processes domain_retirements by calling taxonomyGovernor.applyDomainRetire', async () => {
      const { apply } = editor.run(makeDomainPairs(), makeEntityList(), makeAssociationStats());

      const llmResponse = JSON.stringify({
        entity_merges: [],
        domain_decisions: [],
        weight_updates: [],
        domain_splits: [],
        domain_retirements: [
          { domain_id: 'dom-stale', domain_name: 'Stale', retire_narrative: 'Retired it.' },
        ],
      });

      await apply(llmResponse);

      expect(deps.taxonomyGovernor.applyDomainRetire).toHaveBeenCalled();
      const retireCall = deps.taxonomyGovernor.applyDomainRetire.mock.calls[0];
      expect(retireCall[0]).toBe('dom-stale');
    });

    it('writes narratives for splits and retirements via taxonomyGovernor', async () => {
      const { apply } = editor.run(makeDomainPairs(), makeEntityList(), makeAssociationStats());

      const llmResponse = JSON.stringify({
        entity_merges: [],
        domain_decisions: [],
        weight_updates: [],
        domain_splits: [
          {
            parent_domain: 'dom-dense',
            children: [{ name: 'Sub A', description: 'A', fragment_ids: [] }],
            split_narrative: 'Split narrative.',
          },
        ],
        domain_retirements: [
          { domain_id: 'dom-stale', domain_name: 'Stale Domain', retire_narrative: 'Retire narrative.' },
        ],
      });

      await apply(llmResponse);

      // Should call writeTaxonomyNarrative twice (once for split, once for retire)
      expect(deps.taxonomyGovernor.writeTaxonomyNarrative).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Extended API Surface
  // -------------------------------------------------------------------------

  describe('extended factory', () => {
    it('createEditorialPass accepts options.taxonomyGovernor', () => {
      const ep = createEditorialPass(deps);
      // Should not throw and should still work
      expect(typeof ep.run).toBe('function');
    });

    it('run() accepts 4th parameter capPressure', () => {
      const capPressure = makeCapPressure();
      // Should not throw
      const result = editor.run(makeDomainPairs(), makeEntityList(), makeAssociationStats(), capPressure);
      expect(typeof result.prompt).toBe('string');
      expect(typeof result.apply).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Response Format Extension
  // -------------------------------------------------------------------------

  describe('response format includes split/retire', () => {
    it('prompt response format mentions domain_splits and domain_retirements', () => {
      const capPressure = makeCapPressure({
        splitCandidates: [{ domain_id: 'dom-1', domain_name: 'D1', fragment_count: 55 }],
      });
      const prompt = editor.composeEditorialPrompt(makeDomainPairs(), makeEntityList(), makeAssociationStats(), capPressure);

      expect(prompt).toContain('domain_splits');
      expect(prompt).toContain('domain_retirements');
    });
  });
});
