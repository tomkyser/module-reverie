'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

describe('Reverie CLI Status', function () {
  let createStatusHandler;
  let registerReverieCommands;
  let mockContext;

  beforeEach(function () {
    createStatusHandler = require('../status.cjs').createStatusHandler;
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
            return { aspect: 'identity-core', version: 3, updated: '2026-03-25' };
          }
          return null;
        },
      },
      journal: {
        list: function (dir) {
          if (dir === 'working') return { ok: true, value: ['f1.md', 'f2.md'] };
          if (dir === 'active') return { ok: true, value: ['f3.md', 'f4.md', 'f5.md'] };
          if (dir === 'archive') return { ok: true, value: ['f6.md'] };
          return { ok: true, value: [] };
        },
      },
      switchboard: {
        lastEvent: function (name) { return null; },
      },
      wire: {
        query: function (tableName) {
          if (tableName === 'domains') {
            return {
              ok: true,
              value: [
                { id: 'd-1', name: 'technical', fragment_count: 5, archived: false },
                { id: 'd-2', name: 'personal', fragment_count: 3, archived: false },
                { id: 'd-3', name: 'deprecated', fragment_count: 1, archived: true },
              ],
            };
          }
          if (tableName === 'associations') {
            return {
              ok: true,
              value: [
                { source_id: 'e1', target_id: 'e2', weight: 0.8 },
                { source_id: 'e2', target_id: 'e3', weight: 0.5 },
                { source_id: 'e1', target_id: 'e3', weight: 0.3 },
                { source_id: 'e3', target_id: 'e4', weight: 0.7 },
              ],
            };
          }
          return { ok: true, value: [] };
        },
      },
      formationPipeline: {},
    };
  });

  describe('createStatusHandler', function () {
    it('returns a handler object with handle function', function () {
      const handler = createStatusHandler(mockContext);
      expect(handler).toBeDefined();
      expect(typeof handler.handle).toBe('function');
    });

    it('handleReverieStatus returns ok with human, json, raw', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('human');
      expect(result.value).toHaveProperty('json');
      expect(result.value).toHaveProperty('raw');
    });

    it('json contains mode field', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(result.value.json.mode).toBe('active');
    });

    it('json contains topology_health field', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(result.value.json).toHaveProperty('topology_health');
    });

    it('json contains fragments with working, active, archive counts', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(result.value.json.fragments).toEqual({ working: 2, active: 3, archive: 1 });
    });

    it('json contains self_model_version', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(result.value.json.self_model_version).toBe(3);
    });

    it('json contains last_rem field', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(result.value.json).toHaveProperty('last_rem');
    });

    it('json contains domain_count from Wire query (excludes archived)', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(result.value.json.domain_count).toBe(2); // 3 domains, 1 archived
    });

    it('json contains association_index_size from Wire query', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(result.value.json.association_index_size).toBe(4); // 4 association edges
    });

    it('domain_count falls back to 0 when Wire has no query method', function () {
      const ctx = Object.assign({}, mockContext, { wire: {} });
      const handler = createStatusHandler(ctx);
      const result = handler.handle([], {});
      expect(result.value.json.domain_count).toBe(0);
      expect(result.value.json.association_index_size).toBe(0);
    });

    it('human output is a multi-line string with labeled values', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      expect(typeof result.value.human).toBe('string');
      expect(result.value.human).toContain('Mode:');
      expect(result.value.human).toContain('active');
    });

    it('raw output is JSON.stringify of data object', function () {
      const handler = createStatusHandler(mockContext);
      const result = handler.handle([], {});
      const parsed = JSON.parse(result.value.raw);
      expect(parsed.mode).toBe('active');
      expect(parsed.fragments).toBeDefined();
    });

    it('works with null modeManager (returns unknown mode)', function () {
      const ctx = Object.assign({}, mockContext, { modeManager: null });
      const handler = createStatusHandler(ctx);
      const result = handler.handle([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json.mode).toBe('unknown');
    });

    it('works with null selfModel (returns uninitialized version)', function () {
      const ctx = Object.assign({}, mockContext, { selfModel: null });
      const handler = createStatusHandler(ctx);
      const result = handler.handle([], {});
      expect(result.ok).toBe(true);
      expect(result.value.json.self_model_version).toBe('uninitialized');
    });
  });

  describe('registerReverieCommands', function () {
    it('registers status command via circuitApi', function () {
      const registered = [];
      const mockCircuitApi = {
        registerCommand: function (name, handler, meta) {
          registered.push({ name, handler, meta });
        },
        ok: function (v) { return { ok: true, value: v }; },
        err: function (c, m) { return { ok: false, error: { code: c, message: m } }; },
      };

      const result = registerReverieCommands(mockCircuitApi, mockContext);
      expect(result.ok).toBe(true);
      const statusCmd = registered.find(function (r) { return r.name === 'status'; });
      expect(statusCmd).toBeDefined();
      expect(typeof statusCmd.handler).toBe('function');
    });
  });
});
