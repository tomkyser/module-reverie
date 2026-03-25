'use strict';

/**
 * Tests for checkpoint-log.cjs validation result writer.
 *
 * Per D-15: Structured checkpoint log with pass/fail per success criterion.
 * JSON format at data/validation/checkpoint-{timestamp}.json.
 *
 * @module reverie/validation/checkpoint-log.test
 */

const { describe, it, expect, beforeEach } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { writeCheckpointLog, CHECKPOINT_SCHEMA } = require('./checkpoint-log.cjs');

describe('checkpoint-log', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamo-checkpoint-'));
  });

  describe('CHECKPOINT_SCHEMA', () => {
    it('defines the expected shape', () => {
      expect(CHECKPOINT_SCHEMA).toHaveProperty('timestamp');
      expect(CHECKPOINT_SCHEMA).toHaveProperty('criteria');
      expect(CHECKPOINT_SCHEMA).toHaveProperty('overall');
    });
  });

  describe('writeCheckpointLog', () => {
    it('all-pass produces overall: pass', () => {
      const results = {
        criteria: [
          { id: 'SC-1', name: 'Module discovery', passed: true, evidence: 'found reverie', duration_ms: 10 },
          { id: 'SC-2', name: 'Hook wiring', passed: true, evidence: '8 hooks registered', duration_ms: 5 },
        ],
      };
      const result = writeCheckpointLog(results, tmpDir);
      expect(result.ok).toBe(true);
      expect(result.value.overall).toBe('pass');

      // Verify the file was written
      const content = JSON.parse(fs.readFileSync(result.value.path, 'utf8'));
      expect(content.overall).toBe('pass');
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('all-fail produces overall: fail', () => {
      const results = {
        criteria: [
          { id: 'SC-1', name: 'Module discovery', passed: false, evidence: 'not found', duration_ms: 10 },
          { id: 'SC-2', name: 'Hook wiring', passed: false, evidence: 'exciter not init', duration_ms: 5 },
        ],
      };
      const result = writeCheckpointLog(results, tmpDir);
      expect(result.ok).toBe(true);
      expect(result.value.overall).toBe('fail');
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('mixed pass/fail produces overall: partial', () => {
      const results = {
        criteria: [
          { id: 'SC-1', name: 'Module discovery', passed: true, evidence: 'found', duration_ms: 10 },
          { id: 'SC-2', name: 'Hook wiring', passed: false, evidence: 'missing', duration_ms: 5 },
        ],
      };
      const result = writeCheckpointLog(results, tmpDir);
      expect(result.ok).toBe(true);
      expect(result.value.overall).toBe('partial');
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('writes valid JSON to disk', () => {
      const results = {
        criteria: [
          { id: 'SC-1', name: 'Test', passed: true, evidence: 'ok', duration_ms: 1 },
        ],
      };
      const result = writeCheckpointLog(results, tmpDir);
      expect(result.ok).toBe(true);

      const content = JSON.parse(fs.readFileSync(result.value.path, 'utf8'));
      expect(content).toHaveProperty('timestamp');
      expect(content).toHaveProperty('criteria');
      expect(content).toHaveProperty('overall');
      expect(Array.isArray(content.criteria)).toBe(true);
      expect(content.criteria[0].id).toBe('SC-1');
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('returns ok with file path', () => {
      const results = {
        criteria: [
          { id: 'SC-1', name: 'Test', passed: true, evidence: 'ok', duration_ms: 1 },
        ],
      };
      const result = writeCheckpointLog(results, tmpDir);
      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('path');
      expect(result.value.path).toContain('checkpoint-');
      expect(result.value.path).toContain('.json');
      expect(fs.existsSync(result.value.path)).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('creates output directory if it does not exist', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'deep');
      const results = {
        criteria: [
          { id: 'SC-1', name: 'Test', passed: true, evidence: 'ok', duration_ms: 1 },
        ],
      };
      const result = writeCheckpointLog(results, nestedDir);
      expect(result.ok).toBe(true);
      expect(fs.existsSync(result.value.path)).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('returns err on write failure', () => {
      // Use an invalid path that will fail to write
      const result = writeCheckpointLog({ criteria: [] }, '/dev/null/invalid/path');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('CHECKPOINT_WRITE_FAILED');
    });
  });
});
