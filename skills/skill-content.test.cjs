'use strict';

/**
 * Tests for skill content modules.
 *
 * Validates that each skill module:
 * - Exports the expected registration function
 * - Exports the expected content constant
 * - Content is non-empty and contains expected section markers
 * - Calling the register function invokes exciter.registerSkill with correct args
 * - All command references map to real registered commands
 *
 * @module reverie/skills/skill-content.test
 */

const { describe, it, expect } = require('bun:test');
const { registerDynamoSkill, DYNAMO_SKILL_CONTENT } = require('./dynamo-skill.cjs');
const { registerReverieSkill, REVERIE_SKILL_CONTENT } = require('./reverie-skill.cjs');
const { registerValidateSkill, VALIDATE_SKILL_CONTENT } = require('./validate-skill.cjs');

// ---------------------------------------------------------------------------
// Mock Exciter
// ---------------------------------------------------------------------------

function createMockExciter() {
  const calls = [];
  return {
    registerSkill: function (name, options) {
      calls.push({ name: name, options: options });
      return { ok: true, value: { name: name, path: '/mock/.claude/skills/' + name } };
    },
    calls: calls,
  };
}

// ---------------------------------------------------------------------------
// Known command surfaces (ground truth from register-commands.cjs + platform-commands.cjs)
// ---------------------------------------------------------------------------

/**
 * All Reverie CLI commands registered in register-commands.cjs.
 * Format: 'reverie <subcommand>' as they appear after Pulley prefixing.
 */
const REVERIE_COMMANDS = [
  'reverie status',
  'reverie start',
  'reverie stop',
  'reverie inspect fragment',
  'reverie inspect domains',
  'reverie inspect associations',
  'reverie inspect self-model',
  'reverie inspect identity',
  'reverie inspect relational',
  'reverie inspect conditioning',
  'reverie history sessions',
  'reverie history fragments',
  'reverie history consolidations',
  'reverie reset fragments',
  'reverie reset self-model',
  'reverie reset all',
  'reverie backfill',
];

/**
 * All platform CLI commands registered in platform-commands.cjs.
 */
const PLATFORM_COMMANDS = [
  'status',
  'health',
  'version',
  'install',
  'update',
  'config',
];

// ---------------------------------------------------------------------------
// /dynamo skill
// ---------------------------------------------------------------------------

describe('dynamo-skill', function () {
  it('exports registerDynamoSkill function', function () {
    expect(typeof registerDynamoSkill).toBe('function');
  });

  it('exports DYNAMO_SKILL_CONTENT string', function () {
    expect(typeof DYNAMO_SKILL_CONTENT).toBe('string');
    expect(DYNAMO_SKILL_CONTENT.length).toBeGreaterThan(0);
  });

  it('content contains expected section marker', function () {
    expect(DYNAMO_SKILL_CONTENT).toContain('# Dynamo Platform Dashboard');
  });

  it('content references bun bin/dynamo.cjs status', function () {
    expect(DYNAMO_SKILL_CONTENT).toContain('bun bin/dynamo.cjs status');
  });

  it('content references bun bin/dynamo.cjs health', function () {
    expect(DYNAMO_SKILL_CONTENT).toContain('bun bin/dynamo.cjs health');
  });

  it('content references bun bin/dynamo.cjs version', function () {
    expect(DYNAMO_SKILL_CONTENT).toContain('bun bin/dynamo.cjs version');
  });

  it('content references bun bin/dynamo.cjs config', function () {
    expect(DYNAMO_SKILL_CONTENT).toContain('bun bin/dynamo.cjs config');
  });

  it('content covers platform health topics per D-01', function () {
    expect(DYNAMO_SKILL_CONTENT).toContain('Platform lifecycle state');
    expect(DYNAMO_SKILL_CONTENT).toContain('Loaded modules');
    expect(DYNAMO_SKILL_CONTENT).toContain('Active services');
    expect(DYNAMO_SKILL_CONTENT).toContain('Hook registration');
  });

  it('calls exciter.registerSkill with correct name', function () {
    const mock = createMockExciter();
    const result = registerDynamoSkill(mock);
    expect(result.ok).toBe(true);
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].name).toBe('dynamo');
  });

  it('passes description and content options', function () {
    const mock = createMockExciter();
    registerDynamoSkill(mock);
    expect(mock.calls[0].options.description).toBeDefined();
    expect(mock.calls[0].options.content).toBe(DYNAMO_SKILL_CONTENT);
  });
});

// ---------------------------------------------------------------------------
// /reverie skill
// ---------------------------------------------------------------------------

describe('reverie-skill', function () {
  it('exports registerReverieSkill function', function () {
    expect(typeof registerReverieSkill).toBe('function');
  });

  it('exports REVERIE_SKILL_CONTENT string', function () {
    expect(typeof REVERIE_SKILL_CONTENT).toBe('string');
    expect(REVERIE_SKILL_CONTENT.length).toBeGreaterThan(0);
  });

  it('content contains expected section marker', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('# Reverie Session Management');
  });

  it('content references bun bin/dynamo.cjs reverie status', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('bun bin/dynamo.cjs reverie status');
  });

  it('content references bun bin/dynamo.cjs reverie start', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('bun bin/dynamo.cjs reverie start');
  });

  it('content references bun bin/dynamo.cjs reverie stop', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('bun bin/dynamo.cjs reverie stop');
  });

  it('content references reverie inspect subcommands', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('reverie inspect fragment');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie inspect domains');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie inspect associations');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie inspect self-model');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie inspect identity');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie inspect relational');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie inspect conditioning');
  });

  it('content references reverie history subcommands', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('reverie history sessions');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie history fragments');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie history consolidations');
  });

  it('content references reverie reset subcommands', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('reverie reset fragments');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie reset self-model');
    expect(REVERIE_SKILL_CONTENT).toContain('reverie reset all');
  });

  it('content references reverie backfill', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('reverie backfill');
  });

  it('content mentions --confirm for reset commands', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('--confirm');
  });

  it('content covers session management topics per D-02', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('Active/Passive/REM/Dormant');
    expect(REVERIE_SKILL_CONTENT).toContain('Session topology');
    expect(REVERIE_SKILL_CONTENT).toContain('Triplet ID');
  });

  it('content offers contextual actions per D-02', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('Dormant');
    expect(REVERIE_SKILL_CONTENT).toContain('Active');
    expect(REVERIE_SKILL_CONTENT).toContain('Passive');
  });

  it('calls exciter.registerSkill with correct name', function () {
    const mock = createMockExciter();
    const result = registerReverieSkill(mock);
    expect(result.ok).toBe(true);
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].name).toBe('reverie');
  });

  it('passes description and content options', function () {
    const mock = createMockExciter();
    registerReverieSkill(mock);
    expect(mock.calls[0].options.description).toBeDefined();
    expect(mock.calls[0].options.content).toBe(REVERIE_SKILL_CONTENT);
  });
});

// ---------------------------------------------------------------------------
// /dynamo-validate skill
// ---------------------------------------------------------------------------

describe('validate-skill', function () {
  it('exports registerValidateSkill function', function () {
    expect(typeof registerValidateSkill).toBe('function');
  });

  it('exports VALIDATE_SKILL_CONTENT string', function () {
    expect(typeof VALIDATE_SKILL_CONTENT).toBe('string');
    expect(VALIDATE_SKILL_CONTENT.length).toBeGreaterThan(0);
  });

  it('content contains expected section marker', function () {
    expect(VALIDATE_SKILL_CONTENT).toContain('# Dynamo E2E Validation');
  });

  it('content references bun test for validation', function () {
    expect(VALIDATE_SKILL_CONTENT).toContain('bun test modules/reverie/validation/');
  });

  it('content references integration harness test', function () {
    expect(VALIDATE_SKILL_CONTENT).toContain('bun test modules/reverie/validation/integration-harness.test.cjs');
  });

  it('content covers all 6 success criteria', function () {
    expect(VALIDATE_SKILL_CONTENT).toContain('SC-1');
    expect(VALIDATE_SKILL_CONTENT).toContain('SC-2');
    expect(VALIDATE_SKILL_CONTENT).toContain('SC-3');
    expect(VALIDATE_SKILL_CONTENT).toContain('SC-4');
    expect(VALIDATE_SKILL_CONTENT).toContain('SC-5');
    expect(VALIDATE_SKILL_CONTENT).toContain('SC-6');
  });

  it('content includes go-live gate language per D-17', function () {
    expect(VALIDATE_SKILL_CONTENT).toContain('go-live gate');
    expect(VALIDATE_SKILL_CONTENT).toContain('All 6 success criteria must be green');
  });

  it('calls exciter.registerSkill with correct name', function () {
    const mock = createMockExciter();
    const result = registerValidateSkill(mock);
    expect(result.ok).toBe(true);
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].name).toBe('dynamo-validate');
  });

  it('passes description and content options', function () {
    const mock = createMockExciter();
    registerValidateSkill(mock);
    expect(mock.calls[0].options.description).toBeDefined();
    expect(mock.calls[0].options.content).toBe(VALIDATE_SKILL_CONTENT);
  });
});

// ---------------------------------------------------------------------------
// Cross-reference: no skill references a command that does not exist
// ---------------------------------------------------------------------------

describe('skill command cross-reference', function () {
  /**
   * Extracts all `bun bin/dynamo.cjs <cmd>` references from skill content.
   * Returns the command portion (e.g., 'status', 'reverie start').
   */
  function extractCommandRefs(content) {
    const refs = [];
    const re = /bun bin\/dynamo\.cjs\s+([a-z][a-z0-9 -]*)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      refs.push(m[1].trim());
    }
    return refs;
  }

  /**
   * Checks if a command reference matches any known registered command.
   * A reference like 'reverie inspect fragment <id>' matches 'reverie inspect fragment'.
   */
  function commandExists(ref) {
    const allCommands = PLATFORM_COMMANDS.concat(REVERIE_COMMANDS);
    return allCommands.some(function (cmd) {
      return ref === cmd || ref.startsWith(cmd + ' ');
    });
  }

  it('all /dynamo skill command references map to real commands', function () {
    const refs = extractCommandRefs(DYNAMO_SKILL_CONTENT);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(commandExists(ref)).toBe(true);
    }
  });

  it('all /reverie skill command references map to real commands', function () {
    const refs = extractCommandRefs(REVERIE_SKILL_CONTENT);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(commandExists(ref)).toBe(true);
    }
  });

  it('all /dynamo-validate skill command references map to real commands', function () {
    const refs = extractCommandRefs(VALIDATE_SKILL_CONTENT);
    // validate skill uses bun test, not bun bin/dynamo.cjs -- so fewer direct refs
    // but any that exist must still be valid
    for (const ref of refs) {
      expect(commandExists(ref)).toBe(true);
    }
  });

  it('all three export functions exist', function () {
    expect(typeof registerDynamoSkill).toBe('function');
    expect(typeof registerReverieSkill).toBe('function');
    expect(typeof registerValidateSkill).toBe('function');
  });
});
