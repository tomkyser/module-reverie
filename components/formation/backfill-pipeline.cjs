'use strict';

/**
 * Backfill pipeline orchestrator -- imports Claude conversation exports
 * through attention-gated formation with hybrid retrospective/experiential
 * framing and provenance tracking.
 *
 * Per D-13: Primary input format is Claude conversation exports (JSON).
 * Per D-14: Hybrid framing -- formation subagent decides per-conversation.
 * Per D-15: Equal treatment for trust/decay. origin='backfill' informational only.
 * Per Pitfall 3: Temporal values preserve original timestamps.
 * Per Pitfall 5: Per-conversation fragment cap prevents runaway formation.
 *
 * The pipeline reuses the formation pipeline infrastructure:
 * - prepareStimulus for attention gating
 * - processFormationOutput for fragment creation
 *
 * But provides backfill-specific stimulus preparation:
 * - Pre-composed BACKFILL_TEMPLATES prompts as stimulus.backfill_prompt
 * - origin='backfill' metadata on all stimuli
 * - Synthetic session IDs: 'backfill-{conversation_uuid}'
 * - Original timestamps in temporal fields
 *
 * @module reverie/components/formation/backfill-pipeline
 */

const { ok, err } = require('../../../../lib/result.cjs');
const { BACKFILL_DEFAULTS, FORMATION_DEFAULTS } = require('../../lib/constants.cjs');
const { createBackfillParser } = require('./backfill-parser.cjs');
const { BACKFILL_TEMPLATES } = require('./prompt-templates.cjs');

/**
 * Creates a backfill pipeline instance with options-based DI.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.formationPipeline - FormationPipeline instance (required)
 * @param {Object} [options.selfModel] - Self Model manager
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @param {Object} [options.lathe] - Lathe service for file I/O
 * @param {Object} [options.config] - Configuration overrides
 * @returns {{ dryRun: Function, processConversation: Function, runBatch: Function }}
 */
function createBackfillPipeline(options) {
  const opts = options || {};
  const _formationPipeline = opts.formationPipeline;
  const _selfModel = opts.selfModel;
  const _switchboard = opts.switchboard;
  const _lathe = opts.lathe;
  const _config = opts.config || {};

  const _parser = createBackfillParser({});

  // ---------------------------------------------------------------------------
  // dryRun
  // ---------------------------------------------------------------------------

  /**
   * Parses an export file and returns statistics without writing any fragments.
   *
   * NO writes, NO formation calls. Pure analysis.
   *
   * @param {string} exportJson - Raw JSON string from Claude export file
   * @returns {import('../../../../lib/result.cjs').Result<{
   *   conversations: number,
   *   total_turns: number,
   *   user_turns: number,
   *   estimated_fragments: number,
   *   oldest: string|null,
   *   newest: string|null
   * }>}
   */
  function dryRun(exportJson) {
    const parsed = _parser.parseExportFile(exportJson);
    if (!parsed.ok) {
      return parsed;
    }

    const conversations = parsed.value.conversations;
    let totalTurns = 0;
    let userTurns = 0;
    let oldest = null;
    let newest = null;

    for (const conv of conversations) {
      totalTurns += conv.turns.length;
      for (const turn of conv.turns) {
        if (turn.sender === 'human') {
          userTurns++;
        }
      }
      if (conv.created) {
        if (!oldest || conv.created < oldest) {
          oldest = conv.created;
        }
        if (!newest || conv.created > newest) {
          newest = conv.created;
        }
      }
    }

    // Estimate fragments: ~30% of user turns pass attention gate (conservative estimate)
    const estimatedFragments = Math.ceil(userTurns * 0.3);

    return ok({
      conversations: conversations.length,
      total_turns: totalTurns,
      user_turns: userTurns,
      estimated_fragments: estimatedFragments,
      oldest: oldest,
      newest: newest,
    });
  }

  // ---------------------------------------------------------------------------
  // processConversation
  // ---------------------------------------------------------------------------

  /**
   * Processes a single parsed conversation through backfill formation.
   *
   * Extracts user turns, composes backfill-specific formation prompts using
   * BACKFILL_TEMPLATES, and feeds through the formation pipeline's attention
   * gate and output processing.
   *
   * @param {Object} conversation - Parsed conversation object from backfillParser
   * @param {Object} [processOptions={}] - Processing options
   * @param {boolean} [processOptions.dryRun=false] - If true, skip formation
   * @param {number} [processOptions.maxFragments] - Override max fragments cap
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{
   *   turns_processed: number,
   *   fragments_formed: number,
   *   skipped_by_attention: number
   * }>>}
   */
  async function processConversation(conversation, processOptions) {
    const popts = processOptions || {};
    const maxFragments = popts.maxFragments != null
      ? popts.maxFragments
      : BACKFILL_DEFAULTS.max_fragments_per_conversation;

    const syntheticSessionId = 'backfill-' + conversation.id;
    const conversationAge = _parser.getConversationAge(conversation.created);
    const selfModelSnapshot = _selfModel ? _selfModel.getAspect('identity-core') : null;

    // Filter to user turns only (sender === 'human')
    const userTurns = [];
    for (let i = 0; i < conversation.turns.length; i++) {
      if (conversation.turns[i].sender === 'human') {
        userTurns.push(conversation.turns[i]);
      }
    }

    let turnsProcessed = 0;
    let fragmentsFormed = 0;
    let skippedByAttention = 0;

    for (const turn of userTurns) {
      // Check fragment cap
      if (fragmentsFormed >= maxFragments) {
        break;
      }

      // Find the following assistant response for context
      let assistantContext = '';
      const nextIdx = turn.index + 1;
      if (nextIdx < conversation.turns.length && conversation.turns[nextIdx].sender === 'assistant') {
        assistantContext = conversation.turns[nextIdx].text;
      }

      // Compose backfill-specific formation prompt from BACKFILL_TEMPLATES
      const backfillSystemPrompt = BACKFILL_TEMPLATES.backfill_formation.system;
      const backfillUserPrompt = BACKFILL_TEMPLATES.backfill_formation.user(
        turn, selfModelSnapshot, conversationAge
      );

      // Compute temporal values per Pitfall 3
      const totalTurns = conversation.turns.length;
      const sessionRelative = turn.index / Math.max(1, totalTurns - 1);

      // Build stimulus package with backfill-specific fields
      const hookPayload = {
        user_prompt: turn.text,
        assistant_context: assistantContext,
        turn_number: turn.index,
        session_summary: 'Backfill: "' + conversation.title + '" (' + (conversationAge || 'unknown age') + ')',
        origin: BACKFILL_DEFAULTS.origin_marker,
        backfill_prompt: {
          system: backfillSystemPrompt,
          user: backfillUserPrompt,
        },
        backfill_temporal: {
          absolute: turn.timestamp,
          session_relative: sessionRelative,
          sequence: turn.index,
        },
      };

      const sessionContext = {
        sessionId: syntheticSessionId,
        turnNumber: turn.index,
        position: sessionRelative,
        recentTools: [],
      };

      // Pass through formation pipeline attention gate
      const stimulus = _formationPipeline.prepareStimulus(hookPayload, sessionContext);

      if (!stimulus || (stimulus.turn_context && !stimulus.turn_context.user_prompt)) {
        skippedByAttention++;
        turnsProcessed++;
        continue;
      }

      // Process through formation
      const formResult = await _formationPipeline.processFormationOutput(
        JSON.stringify({ should_form: true, fragments: [{ body: turn.text, domains: [], entities: [], attention_tags: [] }] }),
        {
          sessionId: syntheticSessionId,
          turnNumber: turn.index,
          sessionPosition: sessionRelative,
          trigger: 'backfill',
        }
      );

      if (formResult.ok && formResult.value.formed > 0) {
        fragmentsFormed += formResult.value.formed;
      }

      turnsProcessed++;

      // Emit progress
      if (_switchboard) {
        _switchboard.emit('reverie:backfill:progress', {
          conversation_id: conversation.id,
          turn: turnsProcessed,
          total_turns: userTurns.length,
          fragments_formed: fragmentsFormed,
        });
      }
    }

    return ok({
      turns_processed: turnsProcessed,
      fragments_formed: fragmentsFormed,
      skipped_by_attention: skippedByAttention,
    });
  }

  // ---------------------------------------------------------------------------
  // runBatch
  // ---------------------------------------------------------------------------

  /**
   * Processes multiple conversations from an export file in batches.
   *
   * @param {string} exportJson - Raw JSON string from Claude export file
   * @param {Object} [batchOptions={}] - Batch processing options
   * @param {boolean} [batchOptions.dryRun=false] - If true, skip formation
   * @param {number} [batchOptions.batchSize] - Conversations per batch
   * @param {number} [batchOptions.limit] - Process only first N conversations
   * @param {string} [batchOptions.conversationId] - Process single conversation by UUID
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{
   *   conversations_processed: number,
   *   turns_processed: number,
   *   fragments_formed: number,
   *   skipped_by_attention: number,
   *   errors: Array
   * }>>}
   */
  async function runBatch(exportJson, batchOptions) {
    const bopts = batchOptions || {};
    const batchSize = bopts.batchSize || BACKFILL_DEFAULTS.default_batch_size;

    // Parse the export file
    const parsed = _parser.parseExportFile(exportJson);
    if (!parsed.ok) {
      return parsed;
    }

    let conversations = parsed.value.conversations;

    // Filter by conversationId if specified
    if (bopts.conversationId) {
      conversations = conversations.filter(function (c) {
        return c.id === bopts.conversationId;
      });
      if (conversations.length === 0) {
        return err('CONVERSATION_NOT_FOUND', 'No conversation found with ID: ' + bopts.conversationId);
      }
    }

    // Apply limit if specified
    if (bopts.limit != null && bopts.limit > 0) {
      conversations = conversations.slice(0, bopts.limit);
    }

    // Aggregate stats
    let conversationsProcessed = 0;
    let totalTurnsProcessed = 0;
    let totalFragmentsFormed = 0;
    let totalSkippedByAttention = 0;
    const errors = [];

    // Process in batches
    for (let batchStart = 0; batchStart < conversations.length; batchStart += batchSize) {
      const batch = conversations.slice(batchStart, batchStart + batchSize);

      for (const conv of batch) {
        try {
          const result = await processConversation(conv, {
            dryRun: bopts.dryRun,
          });

          if (result.ok) {
            conversationsProcessed++;
            totalTurnsProcessed += result.value.turns_processed;
            totalFragmentsFormed += result.value.fragments_formed;
            totalSkippedByAttention += result.value.skipped_by_attention;
          } else {
            errors.push({ conversation_id: conv.id, error: result.error });
          }
        } catch (e) {
          errors.push({ conversation_id: conv.id, error: { code: 'PROCESSING_ERROR', message: e.message } });
        }

        // Emit batch progress
        if (_switchboard) {
          _switchboard.emit('reverie:backfill:batch-progress', {
            current: conversationsProcessed,
            total: conversations.length,
            stats: {
              turns_processed: totalTurnsProcessed,
              fragments_formed: totalFragmentsFormed,
            },
          });
        }
      }
    }

    return ok({
      conversations_processed: conversationsProcessed,
      turns_processed: totalTurnsProcessed,
      fragments_formed: totalFragmentsFormed,
      skipped_by_attention: totalSkippedByAttention,
      errors: errors,
    });
  }

  return Object.freeze({
    dryRun,
    processConversation,
    runBatch,
  });
}

module.exports = { createBackfillPipeline };
