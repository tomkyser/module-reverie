'use strict';

const { describe, it, expect } = require('bun:test');

describe('association-population (Research Pitfall 5)', () => {
  let createFormationPipeline;

  function loadModule() {
    if (!createFormationPipeline) {
      ({ createFormationPipeline } = require('../formation-pipeline.cjs'));
    }
  }

  // ---------------------------------------------------------------------------
  // Mock factories
  // ---------------------------------------------------------------------------

  function createMockFragmentWriter() {
    const written = [];
    let idCounter = 0;
    return {
      generateFragmentId() {
        idCounter++;
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');
        return `frag-${y}-${m}-${d}-${String(idCounter).padStart(8, '0')}`;
      },
      async writeFragment(frontmatter, body) {
        written.push({ frontmatter, body });
        return { ok: true, value: { id: frontmatter.id, path: `working/${frontmatter.id}.md` } };
      },
      getWritten() { return written; },
    };
  }

  function createMockSelfModel() {
    return {
      getAspect() { return { body: 'test' }; },
    };
  }

  function createMockLathe() {
    return {
      async writeFile() {},
      async readFile() { return { ok: false }; },
      async stat() { return { ok: true, value: { mtimeMs: Date.now() } }; },
    };
  }

  function createMockWire() {
    const queued = [];
    return {
      queueWrite(envelope) {
        queued.push(envelope);
        return { ok: true, value: undefined };
      },
      getQueued() { return queued; },
    };
  }

  function createMockSwitchboard() {
    return { emit() {} };
  }

  function makePipeline(overrides) {
    loadModule();
    const defaults = {
      fragmentWriter: createMockFragmentWriter(),
      selfModel: createMockSelfModel(),
      lathe: createMockLathe(),
      wire: createMockWire(),
      switchboard: createMockSwitchboard(),
    };
    return createFormationPipeline(Object.assign(defaults, overrides || {}));
  }

  // Helper to make a formation output with specific associations
  function makeOutput(domains, entities, attentionTags) {
    return JSON.stringify({
      should_form: true,
      fragments: [
        {
          formation_frame: 'relational',
          domains: domains,
          entities: entities,
          attention_tags: attentionTags,
          self_model_relevance: { identity: 0.3, relational: 0.5, conditioning: 0.2 },
          emotional_valence: 0.4,
          initial_weight: 0.6,
          body: 'Test fragment body.',
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // Master table population tests
  // ---------------------------------------------------------------------------

  it('queues INSERT OR IGNORE upserts to domains table for new domains', async () => {
    const wire = createMockWire();
    const result = makePipeline({ wire });
    await result.processFormationOutput(
      makeOutput(['trust', 'growth'], ['Tom'], ['patience']),
      { sessionId: 's1' }
    );

    const domainWrites = wire.getQueued().filter(
      e => e.payload && e.payload.table === 'domains'
    );
    expect(domainWrites.length).toBeGreaterThanOrEqual(1);

    // Verify upsert flag
    const domainPayload = domainWrites[0].payload;
    expect(domainPayload.upsert).toBe(true);

    // Verify domain names are present
    const domainNames = domainPayload.data.map(d => d.name);
    expect(domainNames).toContain('trust');
    expect(domainNames).toContain('growth');
  });

  it('queues INSERT OR IGNORE upserts to entities table for new entities', async () => {
    const wire = createMockWire();
    const result = makePipeline({ wire });
    await result.processFormationOutput(
      makeOutput(['trust'], ['Tom', 'Alice'], ['patience']),
      { sessionId: 's1' }
    );

    const entityWrites = wire.getQueued().filter(
      e => e.payload && e.payload.table === 'entities'
    );
    expect(entityWrites.length).toBeGreaterThanOrEqual(1);

    const entityPayload = entityWrites[0].payload;
    expect(entityPayload.upsert).toBe(true);

    const entityNames = entityPayload.data.map(e => e.name);
    expect(entityNames).toContain('Tom');
    expect(entityNames).toContain('Alice');
  });

  it('queues INSERT OR IGNORE upserts to attention_tags table for new tags', async () => {
    const wire = createMockWire();
    const result = makePipeline({ wire });
    await result.processFormationOutput(
      makeOutput(['trust'], ['Tom'], ['patience', 'vulnerability']),
      { sessionId: 's1' }
    );

    const tagWrites = wire.getQueued().filter(
      e => e.payload && e.payload.table === 'attention_tags'
    );
    expect(tagWrites.length).toBeGreaterThanOrEqual(1);

    const tagPayload = tagWrites[0].payload;
    expect(tagPayload.upsert).toBe(true);

    const tagNames = tagPayload.data.map(t => t.tag);
    expect(tagNames).toContain('patience');
    expect(tagNames).toContain('vulnerability');
  });

  it('master table upserts happen BEFORE FragmentWriter.writeFragment call', async () => {
    const callOrder = [];
    const wire = {
      queueWrite(envelope) {
        if (envelope.payload && envelope.payload.upsert) {
          callOrder.push('master_upsert:' + envelope.payload.table);
        }
        return { ok: true, value: undefined };
      },
    };

    const fragmentWriter = {
      generateFragmentId() {
        return 'frag-2026-03-24-00000001';
      },
      async writeFragment(frontmatter, body) {
        callOrder.push('writeFragment');
        return { ok: true, value: { id: frontmatter.id, path: 'working/test.md' } };
      },
    };

    loadModule();
    const pipeline = createFormationPipeline({
      fragmentWriter,
      selfModel: createMockSelfModel(),
      lathe: createMockLathe(),
      wire,
      switchboard: createMockSwitchboard(),
    });

    await pipeline.processFormationOutput(
      makeOutput(['trust'], ['Tom'], ['patience']),
      { sessionId: 's1' }
    );

    // Find the first writeFragment call
    const writeIdx = callOrder.indexOf('writeFragment');
    expect(writeIdx).toBeGreaterThan(0); // Not the first call

    // All master upserts should come before writeFragment
    const upsertIndices = callOrder
      .map((c, i) => c.startsWith('master_upsert') ? i : -1)
      .filter(i => i >= 0);

    for (const idx of upsertIndices) {
      expect(idx).toBeLessThan(writeIdx);
    }
  });
});
