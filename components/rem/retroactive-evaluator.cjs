'use strict';

/**
 * Retroactive Evaluator -- LLM-driven re-evaluation of session fragments
 * against the completed session arc.
 *
 * Per D-06: Mind (Secondary) re-reads all session fragments with full session
 * summary context. LLM judgment updates relevance scores, adds retroactive
 * attention tags, adjusts pointers.
 *
 * Per D-07: Fragment promotion gate -- promote or discard. No archive path for
 * REM-rejected fragments. Clean separation: if REM doesn't endorse it, it never
 * existed in long-term storage.
 *
 * Per D-09: Recall meta-fragment creation during REM. Every significant recall
 * event from the session becomes a meta-recall fragment.
 *
 * Design: The evaluator does NOT call the LLM directly. It composes prompts and
 * provides an apply function. The full-rem.cjs orchestrator (Plan 05) feeds the
 * prompts to Secondary's LLM context and passes responses back. This keeps the
 * evaluator testable without LLM mocks.
 *
 * @module reverie/components/rem/retroactive-evaluator
 */

const { ok, err } = require('../../../../lib/result.cjs');
const { createEnvelope, MESSAGE_TYPES, URGENCY_LEVELS } = require('../../../../core/services/wire/protocol.cjs');
const { LIFECYCLE_DIRS, REM_DEFAULTS } = require('../../lib/constants.cjs');

// ---------------------------------------------------------------------------
// Prompt Composition
// ---------------------------------------------------------------------------

/**
 * Builds a structured prompt for LLM retroactive evaluation of session fragments.
 *
 * The prompt presents the full session summary and each fragment's metadata,
 * asking the LLM to decide PROMOTE or DISCARD for each fragment.
 *
 * @param {string} sessionSummary - Summary of the completed session arc
 * @param {Array<Object>} fragments - Array of fragment objects with frontmatter + _body
 * @returns {string} Structured evaluation prompt
 */
function composeEvaluationPrompt(sessionSummary, fragments) {
  const fragmentDescriptions = fragments.map((f, i) => {
    const domains = (f.associations && f.associations.domains) || [];
    const entities = (f.associations && f.associations.entities) || [];
    const tags = (f.associations && f.associations.attention_tags) || [];
    const relevance = (f.associations && f.associations.self_model_relevance) || {};
    const body = f._body || '(no body)';
    return [
      `### Fragment ${i + 1}: ${f.id}`,
      `- Type: ${f.type}`,
      `- Domains: ${domains.join(', ') || 'none'}`,
      `- Entities: ${entities.join(', ') || 'none'}`,
      `- Attention Tags: ${tags.join(', ') || 'none'}`,
      `- Current Relevance: identity=${relevance.identity || 0}, relational=${relevance.relational || 0}, conditioning=${relevance.conditioning || 0}`,
      `- Body Preview: ${body.slice(0, 200)}`,
    ].join('\n');
  }).join('\n\n');

  return [
    'You are reviewing fragments from a completed session. Evaluate each fragment against the full session arc.',
    'For each fragment, decide: PROMOTE (to long-term memory) or DISCARD.',
    'For promoted fragments, update: relevance scores (0-1 for identity/relational/conditioning), new attention tags, updated pointers.',
    '',
    '## Session Summary',
    sessionSummary,
    '',
    '## Fragments to Evaluate',
    fragmentDescriptions,
    '',
    '## Response Format',
    'Respond in JSON format as an array:',
    '[{ "fragment_id": "...", "action": "promote"|"discard", "updated_relevance": { "identity": 0.0-1.0, "relational": 0.0-1.0, "conditioning": 0.0-1.0 }, "new_attention_tags": [...], "reason": "..." }]',
  ].join('\n');
}

/**
 * Parses the LLM response for fragment evaluation decisions.
 *
 * Attempts JSON.parse first. If that fails, tries to extract a JSON array
 * from the text using regex (handles markdown code blocks). On complete
 * failure, returns empty array.
 *
 * @param {string} llmResponse - Raw LLM response text
 * @returns {Array<Object>} Array of per-fragment decisions
 */
function parseEvaluationResponse(llmResponse) {
  if (!llmResponse || typeof llmResponse !== 'string') {
    return [];
  }

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(llmResponse);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_e) {
    // Fall through to regex extraction
  }

  // Try extracting JSON array from text (handles ```json ... ``` blocks)
  try {
    const match = llmResponse.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (_e) {
    // Fall through to empty array
  }

  return [];
}

/**
 * Builds a prompt for creating meta-recall fragments from significant recall events.
 *
 * @param {Array<Object>} recallEvents - Recall events from the session
 * @param {string} sessionSummary - Session summary for context
 * @returns {string} Meta-recall prompt
 */
function composeMetaRecallPrompt(recallEvents, sessionSummary) {
  if (!recallEvents || recallEvents.length === 0) {
    return '';
  }

  const eventDescriptions = recallEvents.map((evt, i) => {
    return [
      `### Recall Event ${i + 1}`,
      `- Query: ${evt.query || 'unknown'}`,
      `- Fragments Composed: ${(evt.fragments_composed || []).join(', ')}`,
      `- Reconstruction: ${(evt.reconstruction_output || '').slice(0, 200)}`,
      `- Trigger: ${evt.trigger || 'unknown'}`,
      `- Incorporated by Primary: ${evt.incorporated ? 'yes' : 'no'}`,
    ].join('\n');
  }).join('\n\n');

  return [
    'Review these recall events from the session and determine which are significant enough to warrant meta-recall fragments.',
    'A meta-recall fragment captures the act of remembering itself -- when the recall was particularly meaningful or changed the session direction.',
    '',
    '## Session Summary',
    sessionSummary,
    '',
    '## Recall Events',
    eventDescriptions,
    '',
    '## Response Format',
    'Respond in JSON array format. For each significant recall event, provide:',
    '[{ "source_fragments": ["frag-id-1", ...], "body": "Description of why this recall was significant...", "attention_tags": ["meta-recall", ...] }]',
    'Return empty array [] if no recalls warrant meta-recall fragments.',
  ].join('\n');
}

/**
 * Parses the LLM response for meta-recall fragment specifications.
 *
 * @param {string} llmResponse - Raw LLM response text
 * @returns {Array<Object>} Array of meta-recall fragment specs
 */
function parseMetaRecallResponse(llmResponse) {
  if (!llmResponse || typeof llmResponse !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(llmResponse);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_e) {
    // Fall through
  }

  try {
    const match = llmResponse.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (_e) {
    // Fall through
  }

  return [];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a retroactive evaluator instance with injected dependencies.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.fragmentWriter - FragmentWriter for promotion writes
 * @param {Object} options.journal - Journal provider for working fragment reads/deletes
 * @param {Object} options.wire - Wire service for Ledger write-intent envelopes
 * @param {Object} options.switchboard - Switchboard for event emission
 * @param {Object} [options.config] - Configuration overrides
 * @returns {Object} Retroactive evaluator instance (frozen)
 */
function createRetroactiveEvaluator(options = {}) {
  const _fragmentWriter = options.fragmentWriter;
  const _journal = options.journal;
  const _wire = options.wire;
  const _switchboard = options.switchboard;
  const _config = options.config || {};
  const _minSignificance = _config.meta_recall_min_significance || REM_DEFAULTS.meta_recall_min_significance;

  // -------------------------------------------------------------------------
  // Fragment Promotion (D-07: promote to active)
  // -------------------------------------------------------------------------

  /**
   * Promotes a fragment from working/ to active/.
   *
   * Updates fragment frontmatter with evaluation results (new relevance scores,
   * attention tags), sets _lifecycle = 'active', writes to active/ via
   * fragmentWriter, updates Ledger via Wire write-intent, deletes working/ copy.
   *
   * @param {Object} fragment - Original working fragment
   * @param {Object} evaluation - LLM evaluation results for this fragment
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function promoteFragment(fragment, evaluation) {
    try {
      // Build promoted fragment with updated metadata
      const promoted = Object.assign({}, fragment);
      promoted._lifecycle = LIFECYCLE_DIRS.active;

      // Update relevance scores from evaluation
      if (evaluation.updated_relevance) {
        promoted.associations = Object.assign({}, promoted.associations, {
          self_model_relevance: evaluation.updated_relevance,
        });
      }

      // Add new attention tags from evaluation
      if (evaluation.new_attention_tags && evaluation.new_attention_tags.length > 0) {
        const existingTags = promoted.associations.attention_tags || [];
        const mergedTags = [...new Set([...existingTags, ...evaluation.new_attention_tags])];
        promoted.associations = Object.assign({}, promoted.associations, {
          attention_tags: mergedTags,
        });
      }

      // Increment consolidation count
      promoted.decay = Object.assign({}, promoted.decay, {
        consolidation_count: (promoted.decay.consolidation_count || 0) + 1,
      });

      const body = fragment._body || '';

      // Write promoted fragment via fragmentWriter (writes to active/)
      const writeResult = await _fragmentWriter.writeFragment(promoted, body);
      if (!writeResult.ok) {
        return writeResult;
      }

      // Update Ledger fragment_decay lifecycle via Wire write-intent
      const lifecycleEnvelope = createEnvelope({
        type: MESSAGE_TYPES.WRITE_INTENT,
        from: 'rem-evaluator',
        to: 'ledger',
        payload: {
          table: 'fragment_decay',
          data: [{
            fragment_id: fragment.id,
            lifecycle: LIFECYCLE_DIRS.active,
            consolidation_count: promoted.decay.consolidation_count,
          }],
          operation: 'update',
        },
        urgency: URGENCY_LEVELS.ACTIVE,
      });
      if (lifecycleEnvelope.ok) {
        _wire.queueWrite(lifecycleEnvelope.value);
      }

      // Delete working/ copy from Journal
      await _journal.delete(fragment.id);

      // Emit event
      if (_switchboard) {
        _switchboard.emit('reverie:rem:fragment-promoted', {
          id: fragment.id,
          reason: evaluation.reason,
        });
      }

      return ok({ id: fragment.id, lifecycle: LIFECYCLE_DIRS.active });
    } catch (error) {
      return err('PROMOTE_FAILED', `Failed to promote fragment ${fragment.id}: ${error.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Fragment Discard (D-07: discard rejected fragments)
  // -------------------------------------------------------------------------

  /**
   * Discards a fragment rejected by REM evaluation.
   *
   * Deletes from Journal (working/ path), deletes from Ledger tables
   * (fragment_decay, fragment_domains, fragment_entities, etc.) via Wire
   * write-intents.
   *
   * @param {string} fragmentId - Fragment ID to discard
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function discardFragment(fragmentId) {
    try {
      // Delete from Journal
      await _journal.delete(fragmentId);

      // Delete from Ledger tables via Wire write-intents
      const tables = [
        'fragment_decay',
        'fragment_domains',
        'fragment_entities',
        'fragment_attention_tags',
      ];

      for (const table of tables) {
        const envelope = createEnvelope({
          type: MESSAGE_TYPES.WRITE_INTENT,
          from: 'rem-evaluator',
          to: 'ledger',
          payload: {
            table,
            data: [{ fragment_id: fragmentId }],
            operation: 'delete',
          },
          urgency: URGENCY_LEVELS.ACTIVE,
        });
        if (envelope.ok) {
          _wire.queueWrite(envelope.value);
        }
      }

      // Emit event
      if (_switchboard) {
        _switchboard.emit('reverie:rem:fragment-discarded', { id: fragmentId });
      }

      return ok({ id: fragmentId });
    } catch (error) {
      return err('DISCARD_FAILED', `Failed to discard fragment ${fragmentId}: ${error.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Orchestrator
  // -------------------------------------------------------------------------

  /**
   * Orchestrates retroactive evaluation of session fragments.
   *
   * Composes evaluation and meta-recall prompts. Returns the prompts and an
   * apply function that processes LLM responses. This prompt/apply separation
   * keeps the evaluator testable without LLM mocks.
   *
   * @param {string} sessionSummary - Summary of the completed session arc
   * @param {Array<Object>} fragments - Session fragments to evaluate
   * @param {Array<Object>} recallEvents - Recall events from the session
   * @returns {{ prompt: string, metaRecallPrompt: string|null, apply: Function }}
   */
  function evaluate(sessionSummary, fragments, recallEvents) {
    const evaluationPrompt = composeEvaluationPrompt(sessionSummary, fragments);

    // Only compose meta-recall prompt if there are significant recall events
    const significantRecalls = (recallEvents || []).filter(
      evt => (evt.significance || 0) >= _minSignificance
    );
    const metaRecallPrompt = significantRecalls.length > 0
      ? composeMetaRecallPrompt(significantRecalls, sessionSummary)
      : null;

    // Build a fragment lookup for apply
    const fragmentMap = new Map();
    for (const f of fragments) {
      fragmentMap.set(f.id, f);
    }

    /**
     * Processes LLM responses: parses decisions, promotes/discards fragments,
     * creates meta-recall fragments.
     *
     * @param {string} llmEvalResponse - LLM evaluation response
     * @param {string} [llmMetaRecallResponse] - LLM meta-recall response
     * @returns {Promise<{ promoted: number, discarded: number, meta_recalls_created: number, errors: Array }>}
     */
    async function apply(llmEvalResponse, llmMetaRecallResponse) {
      const stats = { promoted: 0, discarded: 0, meta_recalls_created: 0, errors: [] };

      // Parse evaluation decisions
      const decisions = parseEvaluationResponse(llmEvalResponse);

      // Process each decision
      for (const decision of decisions) {
        const fragment = fragmentMap.get(decision.fragment_id);
        if (!fragment) {
          stats.errors.push({ fragment_id: decision.fragment_id, error: 'Fragment not found in session' });
          continue;
        }

        if (decision.action === 'promote') {
          const result = await promoteFragment(fragment, decision);
          if (result.ok) {
            stats.promoted++;
          } else {
            stats.errors.push({ fragment_id: decision.fragment_id, error: result.error });
          }
        } else if (decision.action === 'discard') {
          const result = await discardFragment(decision.fragment_id);
          if (result.ok) {
            stats.discarded++;
          } else {
            stats.errors.push({ fragment_id: decision.fragment_id, error: result.error });
          }
        }
      }

      // Process meta-recall fragments
      if (llmMetaRecallResponse && metaRecallPrompt) {
        const metaRecallSpecs = parseMetaRecallResponse(llmMetaRecallResponse);
        for (const spec of metaRecallSpecs) {
          try {
            const fragmentId = _fragmentWriter.generateFragmentId();
            const now = new Date().toISOString();
            const metaRecallFragment = {
              id: fragmentId,
              type: 'meta-recall',
              created: now,
              source_session: (fragments[0] && fragments[0].source_session) || 'unknown',
              self_model_version: (fragments[0] && fragments[0].self_model_version) || 'sm-identity-v1',
              formation_group: `fg-meta-recall-${Date.now()}`,
              formation_frame: 'meta-recall',
              sibling_fragments: [],
              temporal: {
                absolute: now,
                session_relative: 1.0,
                sequence: 0,
              },
              decay: {
                initial_weight: 0.7,
                current_weight: 0.7,
                last_accessed: now,
                access_count: 0,
                consolidation_count: 0,
                pinned: false,
              },
              associations: {
                domains: [],
                entities: [],
                self_model_relevance: { identity: 0.3, relational: 0.3, conditioning: 0.3 },
                emotional_valence: 0.0,
                attention_tags: spec.attention_tags || ['meta-recall'],
              },
              pointers: {
                causal_antecedents: [],
                causal_consequents: [],
                thematic_siblings: [],
                contradictions: [],
                meta_recalls: [],
                source_fragments: spec.source_fragments || [],
              },
              formation: {
                trigger: 'REM retroactive evaluation - meta-recall creation',
                attention_pointer: 'meta-recall',
                active_domains_at_formation: [],
                sublimation_that_prompted: null,
              },
              _lifecycle: LIFECYCLE_DIRS.active,
            };

            const writeResult = await _fragmentWriter.writeFragment(metaRecallFragment, spec.body || '');
            if (writeResult.ok) {
              stats.meta_recalls_created++;
            } else {
              stats.errors.push({ fragment_id: fragmentId, error: writeResult.error });
            }
          } catch (error) {
            stats.errors.push({ error: error.message });
          }
        }
      }

      return stats;
    }

    return { prompt: evaluationPrompt, metaRecallPrompt, apply };
  }

  return Object.freeze({
    evaluate,
    composeEvaluationPrompt,
    parseEvaluationResponse,
    composeMetaRecallPrompt,
    parseMetaRecallResponse,
    promoteFragment,
    discardFragment,
  });
}

module.exports = { createRetroactiveEvaluator };
