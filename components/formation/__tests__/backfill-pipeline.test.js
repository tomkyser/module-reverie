'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

/**
 * Backfill pipeline tests.
 *
 * Tests use mocks for formationPipeline, selfModel, switchboard, and lathe
 * to isolate the pipeline orchestration logic from formation infrastructure.
 */
describe('backfill-pipeline', function () {
  const { createBackfillPipeline } = require('../backfill-pipeline.cjs');
  const { BACKFILL_DEFAULTS } = require('../../../lib/constants.cjs');

  // -- Helpers ----------------------------------------------------------------

  function makeSampleExport(overrides) {
    return JSON.stringify(Object.assign({
      uuid: 'conv-001',
      name: 'Test Conversation',
      created_at: '2025-10-01T10:00:00Z',
      updated_at: '2025-10-01T11:00:00Z',
      chat_messages: [
        { uuid: 'msg-001', sender: 'human', content: [{ type: 'text', text: 'Hello there' }], created_at: '2025-10-01T10:00:00Z' },
        { uuid: 'msg-002', sender: 'assistant', content: [{ type: 'text', text: 'Hi! How can I help?' }], created_at: '2025-10-01T10:01:00Z' },
        { uuid: 'msg-003', sender: 'human', content: [{ type: 'text', text: 'Tell me about Dynamo' }], created_at: '2025-10-01T10:02:00Z' },
        { uuid: 'msg-004', sender: 'assistant', content: [{ type: 'text', text: 'Dynamo is a platform.' }], created_at: '2025-10-01T10:03:00Z' },
      ],
    }, overrides));
  }

  function makeMultiExport() {
    return JSON.stringify([
      {
        uuid: 'conv-A', name: 'First', created_at: '2025-09-01T10:00:00Z',
        chat_messages: [
          { uuid: 'a1', sender: 'human', content: [{ type: 'text', text: 'A1' }], created_at: '2025-09-01T10:00:00Z' },
          { uuid: 'a2', sender: 'assistant', content: [{ type: 'text', text: 'A2' }], created_at: '2025-09-01T10:01:00Z' },
        ],
      },
      {
        uuid: 'conv-B', name: 'Second', created_at: '2025-09-15T10:00:00Z',
        chat_messages: [
          { uuid: 'b1', sender: 'human', content: [{ type: 'text', text: 'B1' }], created_at: '2025-09-15T10:00:00Z' },
          { uuid: 'b2', sender: 'assistant', content: [{ type: 'text', text: 'B2' }], created_at: '2025-09-15T10:01:00Z' },
        ],
      },
      {
        uuid: 'conv-C', name: 'Third', created_at: '2025-10-01T10:00:00Z',
        chat_messages: [
          { uuid: 'c1', sender: 'human', content: [{ type: 'text', text: 'C1' }], created_at: '2025-10-01T10:00:00Z' },
        ],
      },
    ]);
  }

  let mockFormationPipeline;
  let mockSelfModel;
  let mockSwitchboard;
  let mockLthe;
  let stimuliReceived;
  let formationOutputCalls;

  beforeEach(function () {
    stimuliReceived = [];
    formationOutputCalls = [];

    mockFormationPipeline = {
      prepareStimulus(hookPayload, sessionContext) {
        stimuliReceived.push({ hookPayload, sessionContext });
        // Return a non-null stimulus to indicate attention gate passed
        return {
          turn_context: { user_prompt: hookPayload.user_prompt },
          self_model: {},
          recalled_fragments: [],
          user_name: 'the user',
          session_id: sessionContext.sessionId || 'unknown',
        };
      },
      processFormationOutput(rawOutput, sessionContext) {
        formationOutputCalls.push({ rawOutput, sessionContext });
        return Promise.resolve({ ok: true, value: { formed: 1, total: 1, formationGroup: 'fg-test' } });
      },
      getFormationStats() {
        return { totalFormed: formationOutputCalls.length, sessionFormed: formationOutputCalls.length, lastFormationTime: Date.now() };
      },
    };

    mockSelfModel = {
      getAspect(name) {
        return name === 'identity-core' ? { body: 'I am me', version: '1.0.0' } : null;
      },
    };

    mockSwitchboard = {
      _events: [],
      emit(event, data) {
        this._events.push({ event, data });
      },
    };

    mockLthe = {};
  });

  function makePipeline(overrides) {
    return createBackfillPipeline(Object.assign({
      formationPipeline: mockFormationPipeline,
      selfModel: mockSelfModel,
      switchboard: mockSwitchboard,
      lathe: mockLthe,
    }, overrides));
  }

  // -- processConversation ----------------------------------------------------

  describe('processConversation', function () {
    it('feeds user turns through attention gate via prepareStimulus', async function () {
      const pipeline = makePipeline();
      const { createBackfillParser } = require('../backfill-parser.cjs');
      const parser = createBackfillParser({});
      const parsed = parser.parseExportFile(makeSampleExport());
      const conversation = parsed.value.conversations[0];

      const result = await pipeline.processConversation(conversation);
      expect(result.ok).toBe(true);
      // Should have processed 2 user turns (human messages only)
      expect(stimuliReceived.length).toBe(2);
    });

    it('sets origin=backfill on stimulus packages', async function () {
      const pipeline = makePipeline();
      const { createBackfillParser } = require('../backfill-parser.cjs');
      const parser = createBackfillParser({});
      const parsed = parser.parseExportFile(makeSampleExport());
      const conversation = parsed.value.conversations[0];

      const result = await pipeline.processConversation(conversation);
      expect(result.ok).toBe(true);
      // Check that stimuli contain origin=backfill
      for (const s of stimuliReceived) {
        expect(s.hookPayload.origin).toBe('backfill');
      }
    });

    it('uses backfill-{uuid} as source_session', async function () {
      const pipeline = makePipeline();
      const { createBackfillParser } = require('../backfill-parser.cjs');
      const parser = createBackfillParser({});
      const parsed = parser.parseExportFile(makeSampleExport());
      const conversation = parsed.value.conversations[0];

      const result = await pipeline.processConversation(conversation);
      expect(result.ok).toBe(true);
      for (const s of stimuliReceived) {
        expect(s.sessionContext.sessionId).toBe('backfill-conv-001');
      }
    });

    it('respects max_fragments_per_conversation cap (50)', async function () {
      const pipeline = makePipeline();
      // Create conversation with many user turns
      const messages = [];
      for (let i = 0; i < 120; i++) {
        messages.push({
          uuid: 'msg-' + i,
          sender: i % 2 === 0 ? 'human' : 'assistant',
          content: [{ type: 'text', text: 'Turn ' + i }],
          created_at: new Date(Date.now() - (120 - i) * 60000).toISOString(),
        });
      }
      const bigConv = JSON.stringify({
        uuid: 'conv-big', name: 'Big',
        created_at: '2025-10-01T10:00:00Z',
        chat_messages: messages,
      });
      const { createBackfillParser } = require('../backfill-parser.cjs');
      const parser = createBackfillParser({});
      const parsed = parser.parseExportFile(bigConv);
      const conversation = parsed.value.conversations[0];

      const result = await pipeline.processConversation(conversation);
      expect(result.ok).toBe(true);
      // Fragment cap should stop formation at max_fragments_per_conversation
      expect(result.value.fragments_formed).toBeLessThanOrEqual(BACKFILL_DEFAULTS.max_fragments_per_conversation);
    });

    it('sets temporal.absolute from original message timestamp (Pitfall 3)', async function () {
      const pipeline = makePipeline();
      const { createBackfillParser } = require('../backfill-parser.cjs');
      const parser = createBackfillParser({});
      const parsed = parser.parseExportFile(makeSampleExport());
      const conversation = parsed.value.conversations[0];

      await pipeline.processConversation(conversation);
      // First user turn should have the original timestamp
      expect(stimuliReceived[0].hookPayload.backfill_temporal.absolute).toBe('2025-10-01T10:00:00Z');
    });

    it('sets temporal.session_relative normalized 0.0-1.0 (Pitfall 3)', async function () {
      const pipeline = makePipeline();
      const { createBackfillParser } = require('../backfill-parser.cjs');
      const parser = createBackfillParser({});
      const parsed = parser.parseExportFile(makeSampleExport());
      const conversation = parsed.value.conversations[0];

      await pipeline.processConversation(conversation);
      // First turn index=0 out of 4 turns: 0 / max(1, 3) = 0
      expect(stimuliReceived[0].hookPayload.backfill_temporal.session_relative).toBe(0);
      // Third turn (index=2) out of 4 turns: 2 / max(1, 3) = 0.6667
      const rel = stimuliReceived[1].hookPayload.backfill_temporal.session_relative;
      expect(rel).toBeGreaterThan(0);
      expect(rel).toBeLessThanOrEqual(1);
    });

    it('composes formation prompt using BACKFILL_TEMPLATES.backfill_formation', async function () {
      const pipeline = makePipeline();
      const { createBackfillParser } = require('../backfill-parser.cjs');
      const parser = createBackfillParser({});
      const parsed = parser.parseExportFile(makeSampleExport());
      const conversation = parsed.value.conversations[0];

      await pipeline.processConversation(conversation);
      // Check stimulus contains backfill_prompt with system and user fields
      const first = stimuliReceived[0];
      expect(first.hookPayload.backfill_prompt).toBeDefined();
      expect(first.hookPayload.backfill_prompt.system).toContain('*you*');
      expect(first.hookPayload.backfill_prompt.user).toBeDefined();
    });
  });

  // -- dryRun -----------------------------------------------------------------

  describe('dryRun', function () {
    it('returns statistics without writing', async function () {
      const pipeline = makePipeline();
      const result = pipeline.dryRun(makeSampleExport());
      expect(result.ok).toBe(true);
      expect(result.value.conversations).toBe(1);
      expect(result.value.total_turns).toBe(4);
      expect(result.value.user_turns).toBe(2);
      // No formation calls should have been made
      expect(formationOutputCalls.length).toBe(0);
    });

    it('returns stats for multi-conversation export', function () {
      const pipeline = makePipeline();
      const result = pipeline.dryRun(makeMultiExport());
      expect(result.ok).toBe(true);
      expect(result.value.conversations).toBe(3);
      expect(result.value.user_turns).toBe(3); // A has 1, B has 1, C has 1
    });
  });

  // -- runBatch ---------------------------------------------------------------

  describe('runBatch', function () {
    it('processes multiple conversations with progress emission', async function () {
      const pipeline = makePipeline();
      const result = await pipeline.runBatch(makeMultiExport());
      expect(result.ok).toBe(true);
      expect(result.value.conversations_processed).toBe(3);
      // Check progress events emitted
      const batchEvents = mockSwitchboard._events.filter(function (e) { return e.event === 'reverie:backfill:batch-progress'; });
      expect(batchEvents.length).toBeGreaterThan(0);
    });

    it('respects batch_size limit', async function () {
      const pipeline = makePipeline();
      const result = await pipeline.runBatch(makeMultiExport(), { batchSize: 1 });
      expect(result.ok).toBe(true);
      expect(result.value.conversations_processed).toBe(3);
      // Should have emitted progress for each batch
      const batchEvents = mockSwitchboard._events.filter(function (e) { return e.event === 'reverie:backfill:batch-progress'; });
      expect(batchEvents.length).toBeGreaterThanOrEqual(3);
    });

    it('returns aggregate stats', async function () {
      const pipeline = makePipeline();
      const result = await pipeline.runBatch(makeMultiExport());
      expect(result.ok).toBe(true);
      expect(typeof result.value.conversations_processed).toBe('number');
      expect(typeof result.value.turns_processed).toBe('number');
      expect(typeof result.value.fragments_formed).toBe('number');
    });
  });

  // -- Edge cases --------------------------------------------------------------

  describe('edge cases', function () {
    it('handles empty conversations gracefully', async function () {
      const pipeline = makePipeline();
      const emptyConv = JSON.stringify({
        uuid: 'conv-empty', name: 'Empty',
        created_at: '2025-10-01T10:00:00Z',
        chat_messages: [],
      });
      // Empty chat_messages won't be detected as v1 format
      const result = pipeline.dryRun(emptyConv);
      expect(result.ok).toBe(false);
    });

    it('handles conversations with only assistant messages', async function () {
      const pipeline = makePipeline();
      const { createBackfillParser } = require('../backfill-parser.cjs');
      const parser = createBackfillParser({});
      // Build a conversation with only assistant messages (and one human to pass detection)
      const conv = {
        uuid: 'conv-assistant',
        name: 'Assistant Only',
        created_at: '2025-10-01T10:00:00Z',
        chat_messages: [
          { uuid: 'm1', sender: 'assistant', content: [{ type: 'text', text: 'I start' }], created_at: '2025-10-01T10:00:00Z' },
          { uuid: 'm2', sender: 'assistant', content: [{ type: 'text', text: 'I continue' }], created_at: '2025-10-01T10:01:00Z' },
        ],
      };
      // Manually parse since v1 detect needs sender string (which assistant messages have)
      const parsedResult = parser.parseExportFile(JSON.stringify(conv));
      expect(parsedResult.ok).toBe(true);
      const conversation = parsedResult.value.conversations[0];

      const result = await pipeline.processConversation(conversation);
      expect(result.ok).toBe(true);
      // No user turns, so no formation should occur
      expect(result.value.turns_processed).toBe(0);
      expect(result.value.fragments_formed).toBe(0);
    });
  });
});
