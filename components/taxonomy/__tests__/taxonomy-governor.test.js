'use strict';

const { describe, it, expect, mock, beforeEach } = require('bun:test');

const { createTaxonomyGovernor } = require('../taxonomy-governor.cjs');

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

// ---------------------------------------------------------------------------
// Tests: computeCapPressure
// ---------------------------------------------------------------------------

describe('taxonomy-governor', () => {
  let deps;
  let governor;

  beforeEach(() => {
    deps = createMockDeps();
    governor = createTaxonomyGovernor(deps);
  });

  describe('computeCapPressure', () => {
    it('returns correct percentages for domain/entity/edge counts at 80% threshold', () => {
      const result = governor.computeCapPressure(80, 150, 5000);

      expect(result.domainCount).toBe(80);
      expect(result.maxEntityCount).toBe(150);
      expect(result.edgeCount).toBe(5000);
      expect(result.domainPressure).toBe(0.8);
      expect(result.entityPressure).toBe(0.75);
      expect(result.edgePressure).toBe(0.5);
      expect(result.isUnderPressure).toBe(true);
    });

    it('returns isUnderPressure=false when all counts below threshold', () => {
      const result = governor.computeCapPressure(50, 100, 3000);

      expect(result.isUnderPressure).toBe(false);
      expect(result.domainPressure).toBe(0.5);
      expect(result.entityPressure).toBe(0.5);
      expect(result.edgePressure).toBe(0.3);
    });

    it('returns isUnderPressure=true with all pressures > 0.9 at high counts', () => {
      const result = governor.computeCapPressure(95, 190, 9500);

      expect(result.isUnderPressure).toBe(true);
      expect(result.domainPressure).toBe(0.95);
      expect(result.entityPressure).toBe(0.95);
      expect(result.edgePressure).toBe(0.95);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: identifySplitCandidates
  // ---------------------------------------------------------------------------

  describe('identifySplitCandidates', () => {
    it('returns domains where fragment_count >= 50', () => {
      const domains = [
        { id: 'dom-001', name: 'Dense Domain', fragment_count: 55, archived: false },
        { id: 'dom-002', name: 'Normal Domain', fragment_count: 30, archived: false },
        { id: 'dom-003', name: 'Also Dense', fragment_count: 50, archived: false },
      ];

      const candidates = governor.identifySplitCandidates(domains);

      expect(candidates).toHaveLength(2);
      expect(candidates[0].domain_id).toBe('dom-001');
      expect(candidates[0].fragment_count).toBe(55);
      expect(candidates[1].domain_id).toBe('dom-003');
      expect(candidates[1].fragment_count).toBe(50);
    });

    it('returns empty array when no domains exceed threshold', () => {
      const domains = [
        { id: 'dom-001', name: 'Small', fragment_count: 10, archived: false },
        { id: 'dom-002', name: 'Medium', fragment_count: 49, archived: false },
      ];

      const candidates = governor.identifySplitCandidates(domains);

      expect(candidates).toHaveLength(0);
    });

    it('filters out archived domains', () => {
      const domains = [
        { id: 'dom-001', name: 'Archived Dense', fragment_count: 60, archived: true },
        { id: 'dom-002', name: 'Active Dense', fragment_count: 55, archived: false },
      ];

      const candidates = governor.identifySplitCandidates(domains);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].domain_id).toBe('dom-002');
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: identifyRetireCandidates
  // ---------------------------------------------------------------------------

  describe('identifyRetireCandidates', () => {
    it('returns domains with inactive_cycles >= 3', () => {
      const domains = [
        { id: 'dom-001', name: 'Stale Domain', archived: false },
        { id: 'dom-002', name: 'Active Domain', archived: false },
        { id: 'dom-003', name: 'Very Stale', archived: false },
      ];
      const inactiveCycleMap = new Map([
        ['dom-001', 3],
        ['dom-002', 1],
        ['dom-003', 5],
      ]);

      const candidates = governor.identifyRetireCandidates(domains, inactiveCycleMap);

      expect(candidates).toHaveLength(2);
      expect(candidates[0].domain_id).toBe('dom-001');
      expect(candidates[0].inactive_cycles).toBe(3);
      expect(candidates[1].domain_id).toBe('dom-003');
      expect(candidates[1].inactive_cycles).toBe(5);
    });

    it('returns empty array when all domains have active fragments', () => {
      const domains = [
        { id: 'dom-001', name: 'Active', archived: false },
        { id: 'dom-002', name: 'Also Active', archived: false },
      ];
      const inactiveCycleMap = new Map([
        ['dom-001', 0],
        ['dom-002', 2],
      ]);

      const candidates = governor.identifyRetireCandidates(domains, inactiveCycleMap);

      expect(candidates).toHaveLength(0);
    });

    it('filters out already archived domains', () => {
      const domains = [
        { id: 'dom-001', name: 'Archived Stale', archived: true },
        { id: 'dom-002', name: 'Active Stale', archived: false },
      ];
      const inactiveCycleMap = new Map([
        ['dom-001', 5],
        ['dom-002', 4],
      ]);

      const candidates = governor.identifyRetireCandidates(domains, inactiveCycleMap);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].domain_id).toBe('dom-002');
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: applyDomainSplit
  // ---------------------------------------------------------------------------

  describe('applyDomainSplit', () => {
    it('creates child domains with parent_domain_id set, redistributes fragment_domains', async () => {
      const childDomains = [
        { name: 'Sub A', description: 'First sub-cluster', fragment_ids: ['frag-1', 'frag-2'] },
        { name: 'Sub B', description: 'Second sub-cluster', fragment_ids: ['frag-3'] },
      ];

      const result = await governor.applyDomainSplit('dom-parent', childDomains, 'session-1');

      expect(result.children_created).toBe(2);
      expect(result.fragments_redistributed).toBe(3);
      // Wire.queueWrite should have been called for domain creation, fragment reassignment, and relationships
      expect(deps.wire.queueWrite).toHaveBeenCalled();
    });

    it('creates domain_relationships entries between siblings and parent', async () => {
      const childDomains = [
        { name: 'Sub A', description: 'First', fragment_ids: ['frag-1'] },
        { name: 'Sub B', description: 'Second', fragment_ids: ['frag-2'] },
      ];

      await governor.applyDomainSplit('dom-parent', childDomains, 'session-1');

      // Check that Wire was called with domain_relationships data
      const calls = deps.wire.queueWrite.mock.calls;
      const envelopes = calls.map(c => c[0]);
      const relCalls = envelopes.filter(e => e.payload && e.payload.table === 'domain_relationships');

      expect(relCalls.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: applyDomainRetire
  // ---------------------------------------------------------------------------

  describe('applyDomainRetire', () => {
    it('sets archived=true on retired domains', async () => {
      const result = await governor.applyDomainRetire('dom-stale', 'session-1');

      expect(result.domain_id).toBe('dom-stale');
      expect(result.archived).toBe(true);
      expect(deps.wire.queueWrite).toHaveBeenCalled();

      // Verify the envelope sets archived=true
      const calls = deps.wire.queueWrite.mock.calls;
      const envelopes = calls.map(c => c[0]);
      const domainCalls = envelopes.filter(e => e.payload && e.payload.table === 'domains');
      expect(domainCalls.length).toBeGreaterThan(0);
      expect(domainCalls[0].payload.data[0].archived).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: writeTaxonomyNarrative
  // ---------------------------------------------------------------------------

  describe('writeTaxonomyNarrative', () => {
    it('creates consolidation-type fragment with trigger description', async () => {
      const details = {
        parent: 'dom-parent',
        children: [{ name: 'Sub A' }, { name: 'Sub B' }],
        narrative: 'Split because too many fragments.',
      };

      await governor.writeTaxonomyNarrative('split', details, 'session-1');

      expect(deps.fragmentWriter.writeFragment).toHaveBeenCalled();
      const callArgs = deps.fragmentWriter.writeFragment.mock.calls[0];
      expect(callArgs[0].type).toBe('consolidation');
      expect(callArgs[0].formation.trigger).toContain('split');
    });

    it('for split includes parent and child domain names', async () => {
      const details = {
        parent: 'dom-parent',
        children: [{ name: 'Sub A' }, { name: 'Sub B' }],
        narrative: 'Split because density.',
      };

      await governor.writeTaxonomyNarrative('split', details, 'session-1');

      const callArgs = deps.fragmentWriter.writeFragment.mock.calls[0];
      expect(callArgs[0].formation.trigger).toContain('dom-parent');
      expect(callArgs[0].formation.trigger).toContain('Sub A');
      expect(callArgs[0].formation.trigger).toContain('Sub B');
    });

    it('for retire includes domain name and inactivity cycle count', async () => {
      const details = {
        domain: 'dom-stale',
        name: 'Stale Domain',
        inactive_cycles: 5,
        narrative: 'Retired after 5 inactive cycles.',
      };

      await governor.writeTaxonomyNarrative('retire', details, 'session-1');

      const callArgs = deps.fragmentWriter.writeFragment.mock.calls[0];
      expect(callArgs[0].formation.trigger).toContain('dom-stale');
      expect(callArgs[0].formation.trigger).toContain('5');
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: getPressureGradientText
  // ---------------------------------------------------------------------------

  describe('getPressureGradientText', () => {
    it('returns different urgency text at 80%, 90%, 95% thresholds', () => {
      // 80-89%
      const text80 = governor.getPressureGradientText({
        domainPressure: 0.85,
        entityPressure: 0.5,
        edgePressure: 0.5,
        isUnderPressure: true,
      });
      expect(text80).toContain('Consider merging');

      // 90-94%
      const text90 = governor.getPressureGradientText({
        domainPressure: 0.92,
        entityPressure: 0.5,
        edgePressure: 0.5,
        isUnderPressure: true,
      });
      expect(text90).toContain('Prioritize merging');

      // 95%+
      const text95 = governor.getPressureGradientText({
        domainPressure: 0.97,
        entityPressure: 0.5,
        edgePressure: 0.5,
        isUnderPressure: true,
      });
      expect(text95).toContain('URGENT');
    });

    it('returns empty string below 80%', () => {
      const text = governor.getPressureGradientText({
        domainPressure: 0.5,
        entityPressure: 0.5,
        edgePressure: 0.5,
        isUnderPressure: false,
      });
      expect(text).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: Factory
  // ---------------------------------------------------------------------------

  describe('factory', () => {
    it('returns frozen object with all functions', () => {
      expect(Object.isFrozen(governor)).toBe(true);
      expect(typeof governor.computeCapPressure).toBe('function');
      expect(typeof governor.identifySplitCandidates).toBe('function');
      expect(typeof governor.identifyRetireCandidates).toBe('function');
      expect(typeof governor.applyDomainSplit).toBe('function');
      expect(typeof governor.applyDomainRetire).toBe('function');
      expect(typeof governor.writeTaxonomyNarrative).toBe('function');
      expect(typeof governor.getPressureGradientText).toBe('function');
    });
  });
});
