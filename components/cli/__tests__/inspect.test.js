'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

describe('Reverie CLI Inspect', function () {
  let createInspectHandlers;
  let registerReverieCommands;
  let mockContext;

  beforeEach(function () {
    createInspectHandlers = require('../inspect.cjs').createInspectHandlers;
    registerReverieCommands = require('../register-commands.cjs').registerReverieCommands;

    mockContext = {
      modeManager: {
        getMode: function () { return 'active'; },
        getMetrics: function () {
          return { mode: 'active', uptime_ms: 5000, mode_changes: 1, last_health_check: null, active_sessions_count: 2 };
        },
      },
      selfModel: {
        getAspect: function (name) {
          if (name === 'identity-core') {
            return { aspect: 'identity-core', version: 3, updated: '2026-03-25', core_traits: { curiosity: 0.9 } };
          }
          if (name === 'relational-model') {
            return { aspect: 'relational-model', version: 2, updated: '2026-03-24', user_model: { name: 'Tom' } };
          }
          if (name === 'conditioning') {
            return { aspect: 'conditioning', version: 1, updated: '2026-03-23', behavioral_patterns: {} };
          }
          return null;
        },
      },
      journal: {
        read: function (id) {
          if (id === 'frag-2026-03-25-abcdef01') {
            return {
              ok: true,
              value: {
                frontmatter: { id: 'frag-2026-03-25-abcdef01', type: 'experiential', domains: ['coding'] },
                body: 'This is the fragment body content.',
              },
            };
          }
          return { ok: false, error: { code: 'NOT_FOUND', message: 'Fragment not found' } };
        },
        list: function (dir) {
          return { ok: true, value: [] };
        },
      },
      wire: {
        query: function (table) {
          if (table === 'domains') {
            return {
              ok: true,
              value: [
                { id: 'd-001', name: 'coding', description: 'Programming', fragment_count: 12, archived: false, parent_domain_id: null },
                { id: 'd-002', name: 'music', description: 'Music', fragment_count: 5, archived: true, parent_domain_id: null },
              ],
            };
          }
          if (table === 'associations') {
            return {
              ok: true,
              value: [
                { source: 'Tom', target: 'coding', weight: 0.85, co_occurrence_count: 15 },
                { source: 'Tom', target: 'debugging', weight: 0.6, co_occurrence_count: 8 },
              ],
            };
          }
          return { ok: true, value: [] };
        },
      },
      switchboard: {
        lastEvent: function () { return null; },
      },
      formationPipeline: {},
    };
  });

  describe('handleInspectFragment', function () {
    it('returns fragment frontmatter and body for valid ID', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectFragment(['frag-2026-03-25-abcdef01'], {});
      expect(result.ok).toBe(true);
      expect(result.value.json.frontmatter.id).toBe('frag-2026-03-25-abcdef01');
      expect(result.value.json.body).toBe('This is the fragment body content.');
    });

    it('returns err for non-existent ID', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectFragment(['frag-nonexistent'], {});
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('FRAGMENT_NOT_FOUND');
    });

    it('returns err for missing ID', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectFragment([], {});
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('MISSING_ID');
    });

    it('returns human, json, raw output modes', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectFragment(['frag-2026-03-25-abcdef01'], {});
      expect(result.value).toHaveProperty('human');
      expect(result.value).toHaveProperty('json');
      expect(result.value).toHaveProperty('raw');
    });
  });

  describe('handleInspectDomains', function () {
    it('returns array of domains with expected fields', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectDomains([], {});
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.value.json)).toBe(true);
      expect(result.value.json.length).toBe(2);
      expect(result.value.json[0]).toHaveProperty('id');
      expect(result.value.json[0]).toHaveProperty('name');
      expect(result.value.json[0]).toHaveProperty('fragment_count');
      expect(result.value.json[0]).toHaveProperty('archived');
      expect(result.value.json[0]).toHaveProperty('parent_domain_id');
    });

    it('returns human, json, raw output modes', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectDomains([], {});
      expect(result.value).toHaveProperty('human');
      expect(result.value).toHaveProperty('json');
      expect(result.value).toHaveProperty('raw');
    });
  });

  describe('handleInspectAssociations', function () {
    it('returns edges around a named entity', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectAssociations(['Tom'], {});
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.value.json)).toBe(true);
      expect(result.value.json.length).toBe(2);
      expect(result.value.json[0]).toHaveProperty('source');
      expect(result.value.json[0]).toHaveProperty('target');
      expect(result.value.json[0]).toHaveProperty('weight');
      expect(result.value.json[0]).toHaveProperty('co_occurrence_count');
    });

    it('returns err for missing entity', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectAssociations([], {});
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('MISSING_ENTITY');
    });

    it('returns human, json, raw output modes', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectAssociations(['Tom'], {});
      expect(result.value).toHaveProperty('human');
      expect(result.value).toHaveProperty('json');
      expect(result.value).toHaveProperty('raw');
    });
  });

  describe('handleInspectSelfModel', function () {
    it('returns all three aspects', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectSelfModel([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json).toHaveProperty('identity');
      expect(result.value.json).toHaveProperty('relational');
      expect(result.value.json).toHaveProperty('conditioning');
    });

    it('returns human, json, raw output modes', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectSelfModel([], {});
      expect(result.value).toHaveProperty('human');
      expect(result.value).toHaveProperty('json');
      expect(result.value).toHaveProperty('raw');
    });
  });

  describe('handleInspectIdentity', function () {
    it('returns identity-core aspect only', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectIdentity([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json.aspect).toBe('identity-core');
      expect(result.value.json.version).toBe(3);
    });

    it('returns human, json, raw output modes', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectIdentity([], {});
      expect(result.value).toHaveProperty('human');
      expect(result.value).toHaveProperty('json');
      expect(result.value).toHaveProperty('raw');
    });
  });

  describe('handleInspectRelational', function () {
    it('returns relational-model aspect only', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectRelational([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json.aspect).toBe('relational-model');
      expect(result.value.json.version).toBe(2);
    });

    it('returns human, json, raw output modes', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectRelational([], {});
      expect(result.value).toHaveProperty('human');
      expect(result.value).toHaveProperty('json');
      expect(result.value).toHaveProperty('raw');
    });
  });

  describe('handleInspectConditioning', function () {
    it('returns conditioning aspect only', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectConditioning([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json.aspect).toBe('conditioning');
      expect(result.value.json.version).toBe(1);
    });

    it('returns human, json, raw output modes', function () {
      const handlers = createInspectHandlers(mockContext);
      const result = handlers.handleInspectConditioning([], {});
      expect(result.value).toHaveProperty('human');
      expect(result.value).toHaveProperty('json');
      expect(result.value).toHaveProperty('raw');
    });
  });

  describe('All handlers return ok with three output modes', function () {
    it('every handler returns ok({ human, json, raw })', function () {
      const handlers = createInspectHandlers(mockContext);

      // fragment
      const r1 = handlers.handleInspectFragment(['frag-2026-03-25-abcdef01'], {});
      expect(r1.ok).toBe(true);

      // domains
      const r2 = handlers.handleInspectDomains([], {});
      expect(r2.ok).toBe(true);

      // associations
      const r3 = handlers.handleInspectAssociations(['Tom'], {});
      expect(r3.ok).toBe(true);

      // self-model
      const r4 = handlers.handleInspectSelfModel([], {});
      expect(r4.ok).toBe(true);

      // identity
      const r5 = handlers.handleInspectIdentity([], {});
      expect(r5.ok).toBe(true);

      // relational
      const r6 = handlers.handleInspectRelational([], {});
      expect(r6.ok).toBe(true);

      // conditioning
      const r7 = handlers.handleInspectConditioning([], {});
      expect(r7.ok).toBe(true);

      const results = [r1, r2, r3, r4, r5, r6, r7];
      for (let i = 0; i < results.length; i++) {
        expect(results[i].value).toHaveProperty('human');
        expect(results[i].value).toHaveProperty('json');
        expect(results[i].value).toHaveProperty('raw');
      }
    });
  });

  describe('registerReverieCommands registers all 7 inspect subcommands', function () {
    it('registers inspect fragment, domains, associations, self-model, identity, relational, conditioning', function () {
      const registered = [];
      const mockCircuitApi = {
        registerCommand: function (name, handler, meta) {
          registered.push({ name, handler, meta });
        },
        ok: function (v) { return { ok: true, value: v }; },
        err: function (c, m) { return { ok: false, error: { code: c, message: m } }; },
      };

      registerReverieCommands(mockCircuitApi, mockContext);

      const expectedInspects = [
        'inspect fragment',
        'inspect domains',
        'inspect associations',
        'inspect self-model',
        'inspect identity',
        'inspect relational',
        'inspect conditioning',
      ];

      for (let i = 0; i < expectedInspects.length; i++) {
        const found = registered.find(function (r) { return r.name === expectedInspects[i]; });
        expect(found).toBeDefined();
        expect(typeof found.handler).toBe('function');
      }
    });
  });
});
