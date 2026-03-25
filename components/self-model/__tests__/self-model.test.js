'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');
const { SM_ASPECTS } = require('../../../lib/constants.cjs');
const { identityCoreSchema, relationalModelSchema, conditioningSchema } = require('../../../lib/schemas.cjs');

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockJournal() {
  const store = {};
  return {
    _store: store,
    async write(id, data) {
      store[id] = data;
      return { ok: true, value: undefined };
    },
    async read(id) {
      if (!store[id]) {
        return { ok: false, error: { code: 'NOT_FOUND', message: `Not found: ${id}` } };
      }
      const entry = store[id];
      // Normalize: accept both { frontmatter, body } and plain frontmatter
      if (entry.frontmatter) {
        return { ok: true, value: { id, data: entry.frontmatter, body: entry.body || '' } };
      }
      return { ok: true, value: { id, data: entry, body: '' } };
    },
  };
}

function createMockMagnet() {
  const store = {};
  return {
    _store: store,
    get(scope, ...args) {
      if (scope === 'module') {
        const [moduleName, key] = args;
        return store[moduleName + '.' + key];
      }
      return undefined;
    },
    async set(scope, ...args) {
      if (scope === 'module') {
        const [moduleName, key, value] = args;
        store[moduleName + '.' + key] = value;
      }
      return { ok: true, value: undefined };
    },
  };
}

function createMockWire() {
  const calls = [];
  return {
    _calls: calls,
    queueWrite(envelope) {
      calls.push(envelope);
      return { ok: true, value: undefined };
    },
  };
}

function createMockSwitchboard() {
  const events = [];
  return {
    _events: events,
    emit(name, payload) {
      events.push({ name, payload });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Self Model Manager', () => {
  let selfModel;
  let journal;
  let magnet;
  let wire;
  let switchboard;

  beforeEach(async () => {
    const { createSelfModel } = require('../self-model.cjs');
    journal = createMockJournal();
    magnet = createMockMagnet();
    wire = createMockWire();
    switchboard = createMockSwitchboard();

    const result = createSelfModel({ journal, magnet, wire, switchboard });
    expect(result.ok).toBe(true);
    selfModel = result.value;
  });

  it('createSelfModel returns contract with required methods', () => {
    expect(typeof selfModel.save).toBe('function');
    expect(typeof selfModel.load).toBe('function');
    expect(typeof selfModel.getAspect).toBe('function');
    expect(typeof selfModel.setAspect).toBe('function');
    expect(typeof selfModel.getVersion).toBe('function');
  });

  it('save writes identity-core to Journal with frontmatter and body', async () => {
    const frontmatter = {
      aspect: 'identity-core',
      version: 'sm-identity-v1',
      updated: new Date().toISOString(),
      personality_traits: { openness: 0.7 },
    };
    const body = 'Identity narrative text';

    const result = await selfModel.save('identity-core', { frontmatter, body });
    expect(result.ok).toBe(true);
    expect(journal._store['identity-core']).toBeDefined();
    expect(journal._store['identity-core'].frontmatter.aspect).toBe('identity-core');
  });

  it('save validates frontmatter against identityCoreSchema and rejects invalid data', async () => {
    const frontmatter = {
      aspect: 'wrong-aspect', // Invalid: literal must be 'identity-core'
      version: 'sm-identity-v1',
      updated: new Date().toISOString(),
    };

    const result = await selfModel.save('identity-core', { frontmatter, body: '' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_SELF_MODEL');
  });

  it('load reads identity-core from Journal and returns parsed data', async () => {
    // Pre-populate journal
    const frontmatter = {
      aspect: 'identity-core',
      version: 'sm-identity-v1',
      updated: new Date().toISOString(),
    };
    journal._store['identity-core'] = { frontmatter, body: 'Test body' };

    const result = await selfModel.load('identity-core');
    expect(result.ok).toBe(true);
    expect(result.value.frontmatter.aspect).toBe('identity-core');
    expect(result.value.body).toBe('Test body');
  });

  it('load validates loaded frontmatter and returns err for corrupted files', async () => {
    // Store invalid data in journal
    journal._store['identity-core'] = {
      frontmatter: { aspect: 'identity-core', version: 'corrupt' },
      body: 'corrupt data',
    };

    const result = await selfModel.load('identity-core');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('CORRUPTED_SELF_MODEL');
  });

  it('setAspect caches in Magnet with correct key pattern', async () => {
    const data = { frontmatter: { aspect: 'identity-core' }, body: 'cached' };
    selfModel.setAspect('identity-core', data);

    expect(magnet._store['reverie.self-model.identity-core']).toEqual(data);
  });

  it('getAspect retrieves from Magnet cache first, falls back to Journal load', async () => {
    // Place data in Magnet cache
    const cached = { frontmatter: { aspect: 'identity-core', version: 'sm-identity-v5' }, body: 'from cache' };
    magnet._store['reverie.self-model.identity-core'] = cached;

    const fromCache = selfModel.getAspect('identity-core');
    expect(fromCache).toEqual(cached);

    // Without cache, returns null
    delete magnet._store['reverie.self-model.identity-core'];
    const noCache = selfModel.getAspect('identity-core');
    expect(noCache).toBeNull();
  });

  it('save increments version string (sm-identity-v1 -> sm-identity-v2)', async () => {
    const frontmatter1 = {
      aspect: 'identity-core',
      version: 'sm-identity-v1',
      updated: new Date().toISOString(),
    };

    const result1 = await selfModel.save('identity-core', { frontmatter: frontmatter1, body: 'v1' });
    expect(result1.ok).toBe(true);
    expect(result1.value.version).toBe('sm-identity-v1');

    const frontmatter2 = {
      aspect: 'identity-core',
      version: 'sm-identity-v1', // The user passes v1; save should auto-increment
      updated: new Date().toISOString(),
    };

    const result2 = await selfModel.save('identity-core', { frontmatter: frontmatter2, body: 'v2' });
    expect(result2.ok).toBe(true);
    expect(result2.value.version).toBe('sm-identity-v2');
  });

  it('all three aspects can be saved and loaded independently', async () => {
    const aspects = [
      {
        name: 'identity-core',
        frontmatter: { aspect: 'identity-core', version: 'sm-identity-v1', updated: new Date().toISOString() },
      },
      {
        name: 'relational-model',
        frontmatter: { aspect: 'relational-model', version: 'sm-relational-v1', updated: new Date().toISOString() },
      },
      {
        name: 'conditioning',
        frontmatter: { aspect: 'conditioning', version: 'sm-conditioning-v1', updated: new Date().toISOString() },
      },
    ];

    for (const aspect of aspects) {
      const saveResult = await selfModel.save(aspect.name, { frontmatter: aspect.frontmatter, body: `Body for ${aspect.name}` });
      expect(saveResult.ok).toBe(true);
    }

    for (const aspect of aspects) {
      const loadResult = await selfModel.load(aspect.name);
      expect(loadResult.ok).toBe(true);
      expect(loadResult.value.frontmatter.aspect).toBe(aspect.name);
    }
  });

  it('save queues Ledger writes via Wire for structured fields', async () => {
    const frontmatter = {
      aspect: 'identity-core',
      version: 'sm-identity-v1',
      updated: new Date().toISOString(),
      value_orientations: [{ name: 'curiosity', weight: 0.8 }],
      expertise_map: { javascript: 0.9 },
    };

    await selfModel.save('identity-core', { frontmatter, body: 'test' });

    // Wire should have received queueWrite calls for Ledger tables
    expect(wire._calls.length).toBeGreaterThan(0);
    const tables = wire._calls.map(c => c.table);
    expect(tables).toContain('sm_value_orientations');
    expect(tables).toContain('sm_expertise_map');
  });

  it('save emits reverie:self-model:updated event via Switchboard', async () => {
    const frontmatter = {
      aspect: 'identity-core',
      version: 'sm-identity-v1',
      updated: new Date().toISOString(),
    };

    await selfModel.save('identity-core', { frontmatter, body: 'test' });

    const event = switchboard._events.find(e => e.name === 'reverie:self-model:updated');
    expect(event).toBeDefined();
    expect(event.payload.aspect).toBe('identity-core');
  });

  it('save rejects invalid aspect names', async () => {
    const result = await selfModel.save('invalid-aspect', { frontmatter: {}, body: '' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ASPECT');
  });

  it('getVersion returns current version number for aspect', () => {
    // Before any save, version starts at 0
    expect(selfModel.getVersion('identity-core')).toBe(0);
  });

  it('save caches in Magnet after writing to Journal', async () => {
    const frontmatter = {
      aspect: 'identity-core',
      version: 'sm-identity-v1',
      updated: new Date().toISOString(),
    };

    await selfModel.save('identity-core', { frontmatter, body: 'cached body' });

    const cached = magnet._store['reverie.self-model.identity-core'];
    expect(cached).toBeDefined();
    expect(cached.frontmatter.aspect).toBe('identity-core');
  });
});
