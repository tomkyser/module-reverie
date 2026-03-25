'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

const { createFragmentAssembler } = require('../fragment-assembler.cjs');
const { baseFragmentSchema } = require('../../../lib/schemas.cjs');
const { createFragmentWriter } = require('../../fragments/fragment-writer.cjs');

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockJournal() {
  const calls = { write: [], delete: [] };
  return {
    calls,
    write: async (id, data) => {
      calls.write.push({ id, data });
      return { ok: true, value: undefined };
    },
    delete: async (id) => {
      calls.delete.push({ id });
      return { ok: true, value: undefined };
    },
  };
}

function createMockWire() {
  const calls = { queueWrite: [] };
  return {
    calls,
    queueWrite: (envelope) => {
      calls.queueWrite.push(envelope);
      return { ok: true, value: 1 };
    },
  };
}

function createMockSwitchboard() {
  const calls = { emit: [] };
  return {
    calls,
    emit: (event, data) => {
      calls.emit.push({ event, data });
    },
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/**
 * Mock formation output that includes source_locator data.
 */
function createSourceReferenceFormationOutput() {
  return JSON.stringify({
    should_form: true,
    fragments: [
      {
        domains: ['documentation', 'architecture'],
        entities: ['project-dynamo'],
        attention_tags: ['readme', 'project-overview'],
        self_model_relevance: {
          identity: 0.2,
          relational: 0.4,
          conditioning: 0.1,
        },
        emotional_valence: 0.3,
        initial_weight: 0.7,
        formation_frame: 'experiential',
        source_locator: {
          type: 'file',
          path: '/home/user/project/README.md',
          url: null,
          content_hash: 'sha256-abc123',
          last_verified: new Date().toISOString(),
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('source-reference formation path', () => {
  let assembler;

  beforeEach(() => {
    assembler = createFragmentAssembler();
  });

  describe('fragment-assembler type classification', () => {
    it('classifies fragment with source_locator as source-reference type', () => {
      const rawOutput = createSourceReferenceFormationOutput();
      const parsed = assembler.parseFormationOutput(rawOutput);
      expect(parsed.should_form).toBe(true);
      expect(parsed.fragments).toHaveLength(1);

      // Build frontmatter and verify type classification
      const frontmatter = assembler.buildFrontmatter(parsed.fragments[0], {
        id: 'frag-2026-03-25-f1e2d3c4',
        formationGroup: 'fg-src-test',
        siblings: [],
        sessionContext: {
          sessionId: 'session-test',
          selfModelVersion: 'sm-identity-v1',
          sessionStart: new Date().toISOString(),
          sessionPosition: 0.5,
          turnNumber: 3,
          trigger: 'user shared a file',
        },
      });

      expect(frontmatter.type).toBe('source-reference');
    });
  });

  describe('schema validation with source_locator', () => {
    it('formation output with source_locator passes baseFragmentSchema validation', () => {
      const rawOutput = createSourceReferenceFormationOutput();
      const parsed = assembler.parseFormationOutput(rawOutput);
      const frontmatter = assembler.buildFrontmatter(parsed.fragments[0], {
        id: 'frag-2026-03-25-f1e2d3c4',
        formationGroup: 'fg-src-test',
        siblings: [],
        sessionContext: {
          sessionId: 'session-test',
          selfModelVersion: 'sm-identity-v1',
          sessionStart: new Date().toISOString(),
          sessionPosition: 0.5,
          turnNumber: 3,
          trigger: 'user shared a file',
        },
      });

      const result = baseFragmentSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      expect(result.data.source_locator).toBeDefined();
      expect(result.data.source_locator.type).toBe('file');
      expect(result.data.source_locator.path).toBe('/home/user/project/README.md');
      expect(result.data.source_locator.content_hash).toBe('sha256-abc123');
    });
  });

  describe('full formation-to-write path', () => {
    it('assembler -> schema -> writer writes all 6 tables including source_locators', async () => {
      // Step 1: Parse formation output
      const rawOutput = createSourceReferenceFormationOutput();
      const parsed = assembler.parseFormationOutput(rawOutput);
      expect(parsed.should_form).toBe(true);

      // Step 2: Build frontmatter via assembler
      const frontmatter = assembler.buildFrontmatter(parsed.fragments[0], {
        id: 'frag-2026-03-25-f1e2d3c4',
        formationGroup: 'fg-src-test',
        siblings: [],
        sessionContext: {
          sessionId: 'session-test',
          selfModelVersion: 'sm-identity-v1',
          sessionStart: new Date().toISOString(),
          sessionPosition: 0.5,
          turnNumber: 3,
          trigger: 'user shared a file',
        },
      });

      // Step 3: Validate against schema
      const validation = baseFragmentSchema.safeParse(frontmatter);
      expect(validation.success).toBe(true);

      // Step 4: Write via FragmentWriter (mocked Wire/Journal)
      const journal = createMockJournal();
      const wire = createMockWire();
      const switchboard = createMockSwitchboard();
      const writer = createFragmentWriter({
        journal,
        wire,
        switchboard,
        sessionId: 'test-session',
      });

      const writeResult = await writer.writeFragment(frontmatter, 'This is my impression of the README.');
      expect(writeResult.ok).toBe(true);

      // Step 5: Verify all 6 tables were written
      const tablesWritten = new Set();
      for (const env of wire.calls.queueWrite) {
        if (env.payload && env.payload.table) {
          tablesWritten.add(env.payload.table);
        }
      }

      expect(tablesWritten.has('fragment_decay')).toBe(true);
      expect(tablesWritten.has('fragment_domains')).toBe(true);
      expect(tablesWritten.has('fragment_entities')).toBe(true);
      expect(tablesWritten.has('fragment_attention_tags')).toBe(true);
      expect(tablesWritten.has('formation_groups')).toBe(true);
      expect(tablesWritten.has('source_locators')).toBe(true);
      expect(tablesWritten.size).toBe(6);

      // Verify source_locators row has correct data
      const slWrite = wire.calls.queueWrite.find(
        env => env.payload && env.payload.table === 'source_locators'
      );
      expect(slWrite.payload.data[0].fragment_id).toBe('frag-2026-03-25-f1e2d3c4');
      expect(slWrite.payload.data[0].locator_type).toBe('file');
      expect(slWrite.payload.data[0].path).toBe('/home/user/project/README.md');
      expect(slWrite.payload.data[0].content_hash).toBe('sha256-abc123');
    });
  });
});
