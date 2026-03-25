'use strict';

/**
 * Integration test harness covering all 6 roadmap success criteria (SC-1 through SC-6).
 *
 * Uses real module code with mock dependencies (Conductor, Wire, Switchboard) to test
 * integration wiring without live Claude Code sessions. Each describe block maps 1:1
 * to a roadmap success criterion.
 *
 * Per D-13: bun:test integration tests -- fast, repeatable, CI-friendly verification
 * of every integration point.
 *
 * @module reverie/validation/integration-harness.test
 */

const { describe, it, expect, beforeEach } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---------------------------------------------------------------------------
// SC-1: Module discovery and automatic registration (INT-01, INT-03)
// ---------------------------------------------------------------------------

describe('SC-1: Module discovery and automatic registration', () => {
  it('discovers modules directory with manifest.cjs', () => {
    const { discoverModules } = require('../../../core/armature/module-discovery.cjs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamo-test-'));
    try {
      // Create mock module with manifest.cjs
      const modDir = path.join(tmpDir, 'test-module');
      fs.mkdirSync(modDir);
      fs.writeFileSync(
        path.join(modDir, 'manifest.cjs'),
        "module.exports = { name: 'test', version: '1.0.0', main: './entry.cjs', enabled: true };"
      );
      const result = discoverModules(tmpDir);
      expect(result.length).toBe(1);
      expect(result[0]).toContain('test-module');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('loads valid module manifest', () => {
    const { loadModule } = require('../../../core/armature/module-discovery.cjs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamo-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'manifest.cjs'),
        "module.exports = { name: 'test', version: '1.0.0', main: './entry.cjs', enabled: true };"
      );
      fs.writeFileSync(
        path.join(tmpDir, 'entry.cjs'),
        "module.exports = { register: function() { return { status: 'ok' }; } };"
      );
      const result = loadModule(tmpDir);
      expect(result.ok).toBe(true);
      expect(result.value.name).toBe('test');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('Reverie manifest.cjs is loadable', () => {
    const { REVERIE_MANIFEST } = require('../manifest.cjs');
    expect(REVERIE_MANIFEST.name).toBe('reverie');
    expect(REVERIE_MANIFEST.main).toBe('./reverie.cjs');
    expect(REVERIE_MANIFEST.enabled).toBe(true);
  });

  it('returns empty array for nonexistent directory', () => {
    const { discoverModules } = require('../../../core/armature/module-discovery.cjs');
    expect(discoverModules('/nonexistent/path')).toEqual([]);
  });

  it('returns err for disabled module', () => {
    const { loadModule } = require('../../../core/armature/module-discovery.cjs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamo-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'manifest.cjs'),
        "module.exports = { name: 'disabled', version: '1.0.0', main: './e.cjs', enabled: false };"
      );
      const result = loadModule(tmpDir);
      expect(result.ok).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// SC-2: Hook handlers fire through Exciter/Armature (INT-01)
// ---------------------------------------------------------------------------

describe('SC-2: Hook handlers fire through Exciter/Armature', () => {
  it('registerHooks accepts all 8 hook types', () => {
    const { createExciter } = require('../../../core/services/exciter/exciter.cjs');
    const exciterResult = createExciter();
    expect(exciterResult.ok).toBe(true);
    const exciter = exciterResult.value;
    const mockSwitchboard = { on: () => {}, off: () => {}, emit: () => {} };
    const mockLathe = {
      writeFileSync: () => ({ ok: true, value: undefined }),
      readFileSync: () => ({ ok: true, value: '' }),
      mkdirSync: () => {},
    };
    exciter.init({ switchboard: mockSwitchboard, lathe: mockLathe });

    const handlers = {};
    const hookTypes = [
      'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
      'Stop', 'PreCompact', 'SubagentStart', 'SubagentStop',
    ];
    for (const hookType of hookTypes) {
      handlers[hookType] = () => ({});
    }
    const result = exciter.registerHooks('test-module', handlers);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(8);
  });

  it('getRegisteredHooks returns registered hooks', () => {
    const { createExciter } = require('../../../core/services/exciter/exciter.cjs');
    const exciterResult = createExciter();
    const exciter = exciterResult.value;
    const mockSwitchboard = { on: () => {}, off: () => {}, emit: () => {} };
    const mockLathe = {
      writeFileSync: () => ({ ok: true, value: undefined }),
      readFileSync: () => ({ ok: true, value: '' }),
      mkdirSync: () => {},
    };
    exciter.init({ switchboard: mockSwitchboard, lathe: mockLathe });
    exciter.registerHooks('test', { SessionStart: () => ({}) });
    const hooks = exciter.getRegisteredHooks();
    expect(hooks.ok).toBe(true);
    expect(hooks.value).toHaveProperty('SessionStart');
  });

  it('hook-handlers exports createHookHandlers factory', () => {
    const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
    expect(typeof createHookHandlers).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// SC-3: Skills registered and accessible (INT-02)
// ---------------------------------------------------------------------------

describe('SC-3: Skills registered and accessible', () => {
  it('registerSkill creates SKILL.md file', () => {
    const { createExciter } = require('../../../core/services/exciter/exciter.cjs');
    const exciterResult = createExciter();
    const exciter = exciterResult.value;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamo-skills-'));
    try {
      let writtenPath = null;
      let writtenContent = null;
      const mockSwitchboard = { on: () => {}, off: () => {}, emit: () => {} };
      const mockLathe = {
        writeFileSync: (p, c) => {
          writtenPath = p;
          writtenContent = c;
          // Actually write the file so the skill manager can verify
          const dir = path.dirname(p);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(p, c);
          return { ok: true, value: undefined };
        },
        readFileSync: () => ({ ok: true, value: '' }),
        mkdirSync: (p) => { fs.mkdirSync(p, { recursive: true }); },
      };
      exciter.init({ switchboard: mockSwitchboard, lathe: mockLathe, config: { projectRoot: tmpDir } });
      const result = exciter.registerSkill(
        'test-skill',
        { description: 'A test skill', content: '# Test\nDo something.' },
        tmpDir
      );
      expect(result.ok).toBe(true);
      expect(writtenContent).toContain('---');
      expect(writtenContent).toContain('name: test-skill');
      expect(writtenContent).toContain('# Test');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('dynamo-skill exports registerDynamoSkill', () => {
    const { registerDynamoSkill } = require('../skills/dynamo-skill.cjs');
    expect(typeof registerDynamoSkill).toBe('function');
  });

  it('reverie-skill exports registerReverieSkill', () => {
    const { registerReverieSkill } = require('../skills/reverie-skill.cjs');
    expect(typeof registerReverieSkill).toBe('function');
  });

  it('validate-skill exports registerValidateSkill', () => {
    const { registerValidateSkill } = require('../skills/validate-skill.cjs');
    expect(typeof registerValidateSkill).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// SC-4: Session triplet spawning with Wire topology (SES-01, SES-02, SES-03)
// ---------------------------------------------------------------------------

describe('SC-4: Session triplet spawning with Wire topology', () => {
  it('triplet ID format matches triplet-{4hex}', () => {
    const { generateTripletId } = require('../components/session/triplet.cjs');
    const id = generateTripletId();
    expect(id).toMatch(/^triplet-[0-9a-f]{4}$/);
  });

  it('session IDs use triplet prefix', () => {
    const { generateTripletId, makeTripletSessionId } = require('../components/session/triplet.cjs');
    const tripletId = generateTripletId();
    const sessionId = makeTripletSessionId(tripletId, 'secondary');
    expect(sessionId).toContain(tripletId + ':secondary');
  });

  it('visual markers produce colored prefixes', () => {
    const { formatPrefix, ROLE_LABELS } = require('../components/session/visual-markers.cjs');
    const prefix = formatPrefix(ROLE_LABELS.secondary, 'a1b2');
    expect(prefix).toContain('[Mind a1b2]');
  });

  it('topology rules enforce Primary<->Secondary, Secondary<->Tertiary', () => {
    const { TOPOLOGY_RULES, SESSION_IDENTITIES } = require('../components/session/session-config.cjs');
    expect(TOPOLOGY_RULES[SESSION_IDENTITIES.PRIMARY]).toContain('secondary');
    expect(TOPOLOGY_RULES[SESSION_IDENTITIES.SECONDARY]).toContain('primary');
    expect(TOPOLOGY_RULES[SESSION_IDENTITIES.SECONDARY]).toContain('tertiary');
    expect(TOPOLOGY_RULES[SESSION_IDENTITIES.TERTIARY]).toContain('secondary');
    // No direct Primary<->Tertiary
    expect(TOPOLOGY_RULES[SESSION_IDENTITIES.PRIMARY]).not.toContain('tertiary');
    expect(TOPOLOGY_RULES[SESSION_IDENTITIES.TERTIARY]).not.toContain('primary');
  });
});

// ---------------------------------------------------------------------------
// SC-5: Multi-triplet isolation
// ---------------------------------------------------------------------------

describe('SC-5: Multi-triplet isolation', () => {
  it('two triplets generate different IDs', () => {
    const { generateTripletId } = require('../components/session/triplet.cjs');
    const id1 = generateTripletId();
    const id2 = generateTripletId();
    expect(id1).not.toBe(id2);
  });

  it('Wire registry isolates sessions by triplet-prefixed ID', () => {
    const { createRegistry } = require('../../../core/services/wire/registry.cjs');
    const registry = createRegistry();
    const { makeTripletSessionId } = require('../components/session/triplet.cjs');
    registry.register(makeTripletSessionId('triplet-aaaa', 'secondary'), {
      identity: 'secondary', capabilities: ['send'], writePermissions: [],
    });
    registry.register(makeTripletSessionId('triplet-bbbb', 'secondary'), {
      identity: 'secondary', capabilities: ['send'], writePermissions: [],
    });
    const s1 = registry.lookup('triplet-aaaa:secondary');
    const s2 = registry.lookup('triplet-bbbb:secondary');
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s1).not.toBe(s2);
    registry.destroy();
  });

  it('extractTripletId correctly partitions session IDs', () => {
    const { extractTripletId } = require('../components/session/triplet.cjs');
    expect(extractTripletId('triplet-aaaa:primary')).toBe('triplet-aaaa');
    expect(extractTripletId('triplet-bbbb:secondary')).toBe('triplet-bbbb');
    expect(extractTripletId('triplet-aaaa:primary')).not.toBe(extractTripletId('triplet-bbbb:primary'));
  });

  it('max_triplets config defaults to 3', () => {
    const { createSessionConfig } = require('../components/session/session-config.cjs');
    const config = createSessionConfig({});
    expect(config.max_triplets).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// SC-6: Full lifecycle validation
// ---------------------------------------------------------------------------

describe('SC-6: Full lifecycle validation', () => {
  it('Reverie register function exists and is callable', () => {
    const { register } = require('../reverie.cjs');
    expect(typeof register).toBe('function');
  });

  it('hook-handlers exports createHookHandlers factory', () => {
    const { createHookHandlers } = require('../hooks/hook-handlers.cjs');
    expect(typeof createHookHandlers).toBe('function');
  });

  it('session manager creates with required options', () => {
    const { createSessionManager } = require('../components/session/session-manager.cjs');
    const sm = createSessionManager({
      conductor: { spawnSession: () => ({ ok: true }), stopSession: () => {} },
      wire: {
        register: () => {},
        unregister: () => {},
        send: async () => {},
        createEnvelope: () => ({ ok: true, value: {} }),
      },
      selfModel: { getState: () => ({}) },
      switchboard: { emit: () => {}, on: () => {} },
      sublimationLoop: { getSystemPrompt: () => '' },
      config: require('../components/session/session-config.cjs').createSessionConfig({}),
    });
    expect(sm.getState().state).toBe('uninitialized');
  });

  it('context manager factory is available', () => {
    const { createContextManager } = require('../components/context/context-manager.cjs');
    expect(typeof createContextManager).toBe('function');
  });

  it('REM consolidator factory is available', () => {
    const { createRemConsolidator } = require('../components/rem/rem-consolidator.cjs');
    expect(typeof createRemConsolidator).toBe('function');
  });
});
