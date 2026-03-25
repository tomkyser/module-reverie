'use strict';

/**
 * Tests for skill content modules.
 *
 * Validates that each skill module:
 * - Exports the expected registration function
 * - Exports the expected content constant
 * - Content is non-empty and contains expected section markers
 * - Calling the register function invokes exciter.registerSkill with correct args
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

  it('content references Pulley CLI commands per D-03', function () {
    expect(DYNAMO_SKILL_CONTENT).toContain('pulley.cjs status');
    expect(DYNAMO_SKILL_CONTENT).toContain('pulley.cjs health');
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

  it('content references Pulley CLI commands per D-03', function () {
    expect(REVERIE_SKILL_CONTENT).toContain('pulley.cjs reverie status');
    expect(REVERIE_SKILL_CONTENT).toContain('pulley.cjs reverie start');
    expect(REVERIE_SKILL_CONTENT).toContain('pulley.cjs reverie inspect');
    expect(REVERIE_SKILL_CONTENT).toContain('pulley.cjs reverie stop');
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

  it('content references bun test for validation per D-16', function () {
    expect(VALIDATE_SKILL_CONTENT).toContain('bun test modules/reverie/validation/');
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
