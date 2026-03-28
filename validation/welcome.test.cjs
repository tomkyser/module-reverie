'use strict';

/**
 * Validation tests for one-time welcome message injection.
 *
 * Tests that the Context Manager:
 * - Sets welcome message on cold-start init when no flag file exists
 * - Skips welcome when flag file already exists
 * - Exposes getWelcomeMessage() / clearWelcomeMessage() contract methods
 * - Welcome text meets D-06 content constraints (3 lines max, mentions /reverie and /dynamo)
 *
 * @module reverie/validation/welcome.test
 */

const { describe, it, expect, beforeEach } = require('bun:test');
const { createContextManager } = require('../components/context/context-manager.cjs');

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock Lathe service with controllable file existence.
 * @param {Object} opts
 * @param {boolean} opts.facePromptExists - Whether face-prompt.md exists
 * @param {boolean} opts.welcomeFlagExists - Whether .welcome-shown flag exists
 * @returns {Object} Mock lathe
 */
function createMockLathe(opts) {
  const _opts = opts || {};
  const _facePromptExists = !!_opts.facePromptExists;
  const _welcomeFlagExists = !!_opts.welcomeFlagExists;
  const _written = {};

  return {
    readFile: function (filePath) {
      if (filePath.includes('face-prompt.md') && _facePromptExists) {
        return Promise.resolve({ ok: true, value: '# Face Prompt\nTest face prompt content.' });
      }
      return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'File not found' } });
    },
    writeFile: function (filePath, content) {
      _written[filePath] = content;
      return Promise.resolve({ ok: true, value: { path: filePath } });
    },
    exists: function (filePath) {
      if (filePath.includes('.welcome-shown')) {
        return { ok: true, value: _welcomeFlagExists };
      }
      return { ok: true, value: false };
    },
    getWritten: function () { return _written; },
  };
}

/**
 * Creates a mock Self Model.
 * @returns {Object} Mock selfModel
 */
function createMockSelfModel() {
  const _aspects = {};
  return {
    save: function (name, data) {
      _aspects[name] = data;
      return Promise.resolve({ ok: true });
    },
    getAspect: function (name) {
      return _aspects[name] || { frontmatter: {}, body: '' };
    },
  };
}

/**
 * Creates a mock Switchboard.
 * @returns {Object} Mock switchboard
 */
function createMockSwitchboard() {
  const _events = [];
  return {
    emit: function (name, data) { _events.push({ name, data }); },
    getEvents: function () { return _events; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Welcome Message - Context Manager', function () {

  describe('Cold-start with NO welcome flag file', function () {
    it('should set welcome message on cold-start init', async function () {
      const lathe = createMockLathe({ facePromptExists: false, welcomeFlagExists: false });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();

      const welcomeMsg = cm.getWelcomeMessage();
      expect(welcomeMsg).not.toBeNull();
      expect(typeof welcomeMsg).toBe('string');
      expect(welcomeMsg.length).toBeGreaterThan(0);
    });

    it('should write welcome flag file on cold-start init', async function () {
      const lathe = createMockLathe({ facePromptExists: false, welcomeFlagExists: false });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();

      const written = lathe.getWritten();
      const welcomeKeys = Object.keys(written).filter(function (k) { return k.includes('.welcome-shown'); });
      expect(welcomeKeys.length).toBe(1);
    });
  });

  describe('Cold-start WITH welcome flag file', function () {
    it('should NOT set welcome message when flag file exists', async function () {
      const lathe = createMockLathe({ facePromptExists: false, welcomeFlagExists: true });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();

      const welcomeMsg = cm.getWelcomeMessage();
      expect(welcomeMsg).toBeNull();
    });
  });

  describe('Warm-start (face-prompt.md exists)', function () {
    it('should NOT set welcome message on warm-start', async function () {
      const lathe = createMockLathe({ facePromptExists: true, welcomeFlagExists: false });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();

      const welcomeMsg = cm.getWelcomeMessage();
      expect(welcomeMsg).toBeNull();
    });
  });

  describe('getWelcomeMessage() and clearWelcomeMessage()', function () {
    it('should return null after clearWelcomeMessage()', async function () {
      const lathe = createMockLathe({ facePromptExists: false, welcomeFlagExists: false });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();

      // Verify set
      expect(cm.getWelcomeMessage()).not.toBeNull();

      // Clear
      cm.clearWelcomeMessage();
      expect(cm.getWelcomeMessage()).toBeNull();
    });

    it('should be idempotent (double clear does not error)', async function () {
      const lathe = createMockLathe({ facePromptExists: false, welcomeFlagExists: false });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();
      cm.clearWelcomeMessage();
      cm.clearWelcomeMessage(); // Second call should not throw
      expect(cm.getWelcomeMessage()).toBeNull();
    });
  });

  describe('Welcome text content constraints (D-06)', function () {
    it('should be 3 lines or fewer', async function () {
      const lathe = createMockLathe({ facePromptExists: false, welcomeFlagExists: false });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();

      const welcomeMsg = cm.getWelcomeMessage();
      const lines = welcomeMsg.split('\n');
      expect(lines.length).toBeLessThanOrEqual(3);
    });

    it('should contain /reverie', async function () {
      const lathe = createMockLathe({ facePromptExists: false, welcomeFlagExists: false });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();

      const welcomeMsg = cm.getWelcomeMessage();
      expect(welcomeMsg).toContain('/reverie');
    });

    it('should contain /dynamo', async function () {
      const lathe = createMockLathe({ facePromptExists: false, welcomeFlagExists: false });
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();

      const result = createContextManager({ selfModel, lathe, switchboard, dataDir: '/tmp/test-reverie' });
      expect(result.ok).toBe(true);
      const cm = result.value;

      await cm.init();

      const welcomeMsg = cm.getWelcomeMessage();
      expect(welcomeMsg).toContain('/dynamo');
    });
  });
});
