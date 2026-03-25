'use strict';

/**
 * Versioned parser for Claude conversation export JSON files.
 *
 * Follows Lithograph's versioned parser pattern: a PARSERS registry
 * with detect() per version, allowing future format changes by adding
 * a new parser version without modifying consumers.
 *
 * Claude conversation exports use this structure:
 * { uuid, name, created_at, updated_at, chat_messages: [{ uuid, sender, content, created_at }] }
 * content is an array: [{ type: 'text', text: '...' }, { type: 'thinking', ... }, { type: 'tool_use', ... }]
 * sender: 'human' or 'assistant'
 *
 * Per D-13: Primary input format is Claude conversation exports (JSON).
 * Per D-14: Hybrid framing -- formation subagent decides framing per-conversation.
 *
 * @module reverie/components/formation/backfill-parser
 */

const { ok, err } = require('../../../../lib/result.cjs');

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

/**
 * Extracts text content from a Claude message content array.
 *
 * Filters for items with type === 'text', maps to .text, joins with newline.
 * Ignores tool_use, thinking, tool_result, and any other content types.
 *
 * @param {Array|*} contentArray - Message content array from Claude export
 * @returns {string} Combined text content, or empty string if not array
 */
function extractTextContent(contentArray) {
  if (!Array.isArray(contentArray)) {
    return '';
  }
  return contentArray
    .filter(function (item) { return item && item.type === 'text'; })
    .map(function (item) { return item.text || ''; })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Versioned parsers
// ---------------------------------------------------------------------------

/**
 * Registry of versioned parsers. Each parser has:
 * - detect(parsed): Returns true if the parsed object matches this format
 * - parseConversation(conversation): Parses a single conversation into structured turns
 *
 * @type {Readonly<Object.<string, { detect: function, parseConversation: function }>>}
 */
const PARSERS = Object.freeze({
  v1: Object.freeze({
    /**
     * Detects v1 Claude export format.
     * v1 has a chat_messages array where entries have a string sender field.
     *
     * @param {Object} parsed - Parsed conversation object
     * @returns {boolean}
     */
    detect(parsed) {
      return Array.isArray(parsed.chat_messages)
        && parsed.chat_messages.length > 0
        && typeof parsed.chat_messages[0].sender === 'string';
    },

    /**
     * Parses a single conversation into structured turns.
     *
     * @param {Object} conversation - Raw conversation object from Claude export
     * @returns {{ id: string, title: string, created: string|null, updated: string|null, turns: Array }}
     */
    parseConversation(conversation) {
      return {
        id: conversation.uuid || 'unknown',
        title: conversation.name || 'Untitled',
        created: conversation.created_at || null,
        updated: conversation.updated_at || null,
        turns: (conversation.chat_messages || []).map(function (msg, idx) {
          return {
            index: idx,
            sender: msg.sender,
            text: extractTextContent(msg.content),
            timestamp: msg.created_at || null,
          };
        }),
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

/**
 * Detects the format version of a parsed conversation object.
 *
 * Iterates through registered PARSERS, calling detect() on each.
 * Returns the version key of the first match, or null if none match.
 *
 * @param {Object} parsed - A parsed conversation object
 * @returns {string|null} Version string (e.g., 'v1') or null if undetectable
 */
function detectVersion(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  for (const version of Object.keys(PARSERS)) {
    try {
      if (PARSERS[version].detect(parsed)) {
        return version;
      }
    } catch (_) {
      // Parser detect threw -- skip this version
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Conversation age
// ---------------------------------------------------------------------------

/**
 * Computes a human-readable age string for a conversation.
 *
 * @param {string|null} createdAt - ISO timestamp of conversation creation
 * @returns {string|null} Human-readable age (e.g., "3 months ago") or null for invalid input
 */
function getConversationAge(createdAt) {
  if (!createdAt) {
    return null;
  }

  const created = new Date(createdAt);
  if (isNaN(created.getTime())) {
    return null;
  }

  const now = Date.now();
  const diffMs = now - created.getTime();
  if (diffMs < 0) {
    return 'in the future';
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'today';
  }
  if (diffDays === 1) {
    return 'yesterday';
  }
  if (diffDays < 7) {
    return diffDays + ' days ago';
  }
  if (diffDays < 14) {
    return '1 week ago';
  }
  if (diffDays < 30) {
    return Math.floor(diffDays / 7) + ' weeks ago';
  }
  if (diffDays < 60) {
    return '1 month ago';
  }
  if (diffDays < 365) {
    return Math.floor(diffDays / 30) + ' months ago';
  }
  if (diffDays < 730) {
    return '1 year ago';
  }
  return Math.floor(diffDays / 365) + ' years ago';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a backfill parser instance.
 *
 * @param {Object} [options={}] - Configuration options
 * @param {Object} [options.config] - Parser configuration (reserved for future use)
 * @returns {{ parseExportFile: function, getConversationAge: function, PARSERS: Object }}
 */
function createBackfillParser(options) {

  /**
   * Parses a Claude conversation export JSON string.
   *
   * Handles both single conversation objects and arrays of conversations.
   * Detects format version via detectVersion and uses the matching parser.
   *
   * @param {string} jsonString - Raw JSON string from Claude export file
   * @returns {import('../../../../lib/result.cjs').Result<{ conversations: Array, version: string, count: number }>}
   */
  function parseExportFile(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      return err('PARSE_ERROR', 'Invalid JSON: ' + e.message);
    }

    // Normalize to array of conversations
    const conversations = Array.isArray(parsed) ? parsed : [parsed];

    if (conversations.length === 0) {
      return err('EMPTY_EXPORT', 'No conversations found in export');
    }

    // Detect version from first conversation
    const version = detectVersion(conversations[0]);
    if (!version) {
      return err('UNKNOWN_FORMAT', 'Could not detect export format version');
    }

    const parser = PARSERS[version];
    const parsedConversations = conversations.map(function (conv) {
      return parser.parseConversation(conv);
    });

    return ok({
      conversations: parsedConversations,
      version: version,
      count: parsedConversations.length,
    });
  }

  return Object.freeze({
    parseExportFile,
    getConversationAge,
    PARSERS,
  });
}

module.exports = { createBackfillParser };
