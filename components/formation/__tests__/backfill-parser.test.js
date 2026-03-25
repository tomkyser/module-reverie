'use strict';

const { describe, it, expect } = require('bun:test');

describe('backfill-parser', function () {
  const { createBackfillParser } = require('../backfill-parser.cjs');

  function makeParser() {
    return createBackfillParser({});
  }

  describe('v1 format detection', function () {
    it('detects Claude export format with chat_messages array and sender field', function () {
      const parser = makeParser();
      const input = JSON.stringify({
        uuid: 'conv-001',
        name: 'Test Conversation',
        created_at: '2025-12-01T10:00:00Z',
        updated_at: '2025-12-01T11:00:00Z',
        chat_messages: [
          { uuid: 'msg-001', sender: 'human', content: [{ type: 'text', text: 'Hello' }], created_at: '2025-12-01T10:00:00Z' },
        ],
      });
      const result = parser.parseExportFile(input);
      expect(result.ok).toBe(true);
      expect(result.value.version).toBe('v1');
    });

    it('rejects non-Claude format (no chat_messages)', function () {
      const parser = makeParser();
      const input = JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] });
      const result = parser.parseExportFile(input);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('UNKNOWN_FORMAT');
    });

    it('rejects format with chat_messages but missing sender', function () {
      const parser = makeParser();
      const input = JSON.stringify({
        chat_messages: [{ role: 'user', content: 'Hello' }],
      });
      const result = parser.parseExportFile(input);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('UNKNOWN_FORMAT');
    });
  });

  describe('parseConversation via parseExportFile', function () {
    it('extracts turns with index, sender, text, timestamp', function () {
      const parser = makeParser();
      const input = JSON.stringify({
        uuid: 'conv-002',
        name: 'Multi-turn',
        created_at: '2025-12-01T10:00:00Z',
        updated_at: '2025-12-01T11:00:00Z',
        chat_messages: [
          { uuid: 'msg-001', sender: 'human', content: [{ type: 'text', text: 'What is Dynamo?' }], created_at: '2025-12-01T10:00:00Z' },
          { uuid: 'msg-002', sender: 'assistant', content: [{ type: 'text', text: 'Dynamo is a platform.' }], created_at: '2025-12-01T10:01:00Z' },
          { uuid: 'msg-003', sender: 'human', content: [{ type: 'text', text: 'Tell me more.' }], created_at: '2025-12-01T10:02:00Z' },
        ],
      });
      const result = parser.parseExportFile(input);
      expect(result.ok).toBe(true);
      const conv = result.value.conversations[0];
      expect(conv.turns).toHaveLength(3);

      expect(conv.turns[0].index).toBe(0);
      expect(conv.turns[0].sender).toBe('human');
      expect(conv.turns[0].text).toBe('What is Dynamo?');
      expect(conv.turns[0].timestamp).toBe('2025-12-01T10:00:00Z');

      expect(conv.turns[1].index).toBe(1);
      expect(conv.turns[1].sender).toBe('assistant');
      expect(conv.turns[1].text).toBe('Dynamo is a platform.');

      expect(conv.turns[2].index).toBe(2);
      expect(conv.turns[2].sender).toBe('human');
    });

    it('combines text-type content items and ignores tool_use/thinking', function () {
      const parser = makeParser();
      const input = JSON.stringify({
        uuid: 'conv-003',
        name: 'Mixed content',
        created_at: '2025-12-01T10:00:00Z',
        chat_messages: [
          {
            uuid: 'msg-001',
            sender: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Let me consider...' },
              { type: 'text', text: 'First part.' },
              { type: 'tool_use', name: 'read_file', input: { path: '/test' } },
              { type: 'text', text: 'Second part.' },
            ],
            created_at: '2025-12-01T10:00:00Z',
          },
        ],
      });
      const result = parser.parseExportFile(input);
      expect(result.ok).toBe(true);
      const turn = result.value.conversations[0].turns[0];
      expect(turn.text).toBe('First part.\nSecond part.');
    });

    it('handles empty content arrays gracefully', function () {
      const parser = makeParser();
      const input = JSON.stringify({
        uuid: 'conv-004',
        name: 'Empty content',
        created_at: '2025-12-01T10:00:00Z',
        chat_messages: [
          { uuid: 'msg-001', sender: 'human', content: [], created_at: '2025-12-01T10:00:00Z' },
        ],
      });
      const result = parser.parseExportFile(input);
      expect(result.ok).toBe(true);
      expect(result.value.conversations[0].turns[0].text).toBe('');
    });

    it('handles single-message conversations', function () {
      const parser = makeParser();
      const input = JSON.stringify({
        uuid: 'conv-005',
        name: 'Solo',
        created_at: '2025-12-01T10:00:00Z',
        chat_messages: [
          { uuid: 'msg-001', sender: 'human', content: [{ type: 'text', text: 'Just one message' }], created_at: '2025-12-01T10:00:00Z' },
        ],
      });
      const result = parser.parseExportFile(input);
      expect(result.ok).toBe(true);
      expect(result.value.conversations[0].turns).toHaveLength(1);
      expect(result.value.count).toBe(1);
    });

    it('handles array of conversations', function () {
      const parser = makeParser();
      const input = JSON.stringify([
        {
          uuid: 'conv-A',
          name: 'First',
          created_at: '2025-12-01T10:00:00Z',
          chat_messages: [{ uuid: 'msg-1', sender: 'human', content: [{ type: 'text', text: 'A' }], created_at: '2025-12-01T10:00:00Z' }],
        },
        {
          uuid: 'conv-B',
          name: 'Second',
          created_at: '2025-12-02T10:00:00Z',
          chat_messages: [{ uuid: 'msg-2', sender: 'human', content: [{ type: 'text', text: 'B' }], created_at: '2025-12-02T10:00:00Z' }],
        },
      ]);
      const result = parser.parseExportFile(input);
      expect(result.ok).toBe(true);
      expect(result.value.conversations).toHaveLength(2);
      expect(result.value.count).toBe(2);
    });
  });

  describe('getConversationAge', function () {
    it('returns human-readable age for dates months ago', function () {
      const parser = makeParser();
      const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const age = parser.getConversationAge(threeMonthsAgo);
      expect(age).toContain('month');
    });

    it('handles null/invalid dates gracefully', function () {
      const parser = makeParser();
      expect(parser.getConversationAge(null)).toBe(null);
      expect(parser.getConversationAge(undefined)).toBe(null);
      expect(parser.getConversationAge('not-a-date')).toBe(null);
    });

    it('returns day-scale age for recent dates', function () {
      const parser = makeParser();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const age = parser.getConversationAge(threeDaysAgo);
      expect(age).toContain('day');
    });
  });

  describe('BACKFILL_TEMPLATES', function () {
    it('backfill_formation system contains subjective framing markers', function () {
      const { BACKFILL_TEMPLATES } = require('../prompt-templates.cjs');
      const system = BACKFILL_TEMPLATES.backfill_formation.system;
      expect(system).toContain('*you*');
      expect(system).toContain('*{user_name}*');
    });

    it('backfill_formation user includes conversation age context', function () {
      const { BACKFILL_TEMPLATES } = require('../prompt-templates.cjs');
      const turn = { sender: 'human', text: 'Hello there' };
      const selfModel = { version: '1.0.0' };
      const age = '3 months ago';
      const output = BACKFILL_TEMPLATES.backfill_formation.user(turn, selfModel, age);
      expect(output).toContain('3 months ago');
    });
  });
});
