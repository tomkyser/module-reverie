'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');
const path = require('node:path');

describe('nudge-manager', () => {
  let createNudgeManager;

  function loadModule() {
    if (!createNudgeManager) {
      ({ createNudgeManager } = require('../nudge-manager.cjs'));
    }
  }

  /**
   * Creates a mock lathe with in-memory file store.
   */
  function createMockLathe() {
    const files = new Map();
    const mtimes = new Map();

    return {
      files,
      mtimes,
      async writeFile(filePath, content) {
        files.set(filePath, content);
        mtimes.set(filePath, Date.now());
        return { ok: true, value: { path: filePath } };
      },
      async readFile(filePath) {
        if (files.has(filePath)) {
          return { ok: true, value: files.get(filePath) };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: `File not found: ${filePath}` } };
      },
      async stat(filePath) {
        if (mtimes.has(filePath)) {
          return { ok: true, value: { mtimeMs: mtimes.get(filePath) } };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: `File not found: ${filePath}` } };
      },
    };
  }

  describe('writeNudge', () => {
    it('writes nudge text to latest-nudge.md', async () => {
      loadModule();
      const lathe = createMockLathe();
      const mgr = createNudgeManager({ lathe, dataDir: '/tmp/test-reverie' });

      const result = await mgr.writeNudge('A subtle impression from this exchange.');
      expect(result.ok).toBe(true);

      // Should have written to the latest nudge path
      const nudgeDir = '/tmp/test-reverie/data/formation/nudges';
      const latestPath = path.join(nudgeDir, 'latest-nudge.md');
      expect(lathe.files.has(latestPath)).toBe(true);
      expect(lathe.files.get(latestPath)).toBe('A subtle impression from this exchange.');
    });

    it('also writes timestamped copy', async () => {
      loadModule();
      const lathe = createMockLathe();
      const mgr = createNudgeManager({ lathe, dataDir: '/tmp/test-reverie' });

      await mgr.writeNudge('Test nudge content.');

      // Should have two files written: latest + timestamped
      const nudgeDir = '/tmp/test-reverie/data/formation/nudges';
      const writtenPaths = [...lathe.files.keys()].filter(p => p.startsWith(nudgeDir));
      expect(writtenPaths.length).toBeGreaterThanOrEqual(2);

      // One should be timestamped (nudge-{timestamp}.md pattern)
      const timestamped = writtenPaths.find(p => /nudge-\d+\.md$/.test(p));
      expect(timestamped).toBeDefined();
    });
  });

  describe('readLatestNudge', () => {
    it('reads from latest-nudge.md', async () => {
      loadModule();
      const lathe = createMockLathe();
      const mgr = createNudgeManager({ lathe, dataDir: '/tmp/test-reverie' });

      // Write a nudge first
      await mgr.writeNudge('Something that registered.');

      const result = await mgr.readLatestNudge();
      expect(result.ok).toBe(true);
      expect(result.value).not.toBeNull();
      expect(result.value.text).toBe('Something that registered.');
    });

    it('returns null when no nudge file exists', async () => {
      loadModule();
      const lathe = createMockLathe();
      const mgr = createNudgeManager({ lathe, dataDir: '/tmp/test-reverie' });

      const result = await mgr.readLatestNudge();
      expect(result.ok).toBe(true);
      expect(result.value).toBeNull();
    });

    it('returns null when nudge is stale (older than max age)', async () => {
      loadModule();
      const lathe = createMockLathe();
      const mgr = createNudgeManager({ lathe, dataDir: '/tmp/test-reverie' });

      // Write a nudge
      await mgr.writeNudge('Old nudge.');

      // Manually set the mtime to be old (2 minutes ago, max age is 60s)
      const nudgeDir = '/tmp/test-reverie/data/formation/nudges';
      const latestPath = path.join(nudgeDir, 'latest-nudge.md');
      lathe.mtimes.set(latestPath, Date.now() - 120000);

      const result = await mgr.readLatestNudge();
      expect(result.ok).toBe(true);
      expect(result.value).toBeNull();
    });

    it('nudge paths use expected data directory structure', async () => {
      loadModule();
      const lathe = createMockLathe();
      const mgr = createNudgeManager({ lathe, dataDir: '/tmp/test-reverie' });

      await mgr.writeNudge('Check path.');

      const nudgeDir = '/tmp/test-reverie/data/formation/nudges';
      const latestPath = path.join(nudgeDir, 'latest-nudge.md');
      expect(lathe.files.has(latestPath)).toBe(true);
    });

    it('resolves ~ in dataDir to HOME', async () => {
      loadModule();
      const lathe = createMockLathe();
      const mgr = createNudgeManager({ lathe, dataDir: '~/.dynamo/reverie' });

      await mgr.writeNudge('Tilde test.');

      const home = process.env.HOME || '/tmp';
      const expectedDir = path.join(home, '.dynamo/reverie/data/formation/nudges');
      const latestPath = path.join(expectedDir, 'latest-nudge.md');
      expect(lathe.files.has(latestPath)).toBe(true);
    });
  });
});
