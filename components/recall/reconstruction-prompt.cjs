'use strict';

/**
 * Reconstruction prompt templates for recall.
 *
 * Frames recall as re-experiencing through the current Self Model perspective,
 * not as retrieval or summarization. This is the cognition layer for recall --
 * the prompt framing IS the architecture (per D-16/D-17, designed for replaceability).
 *
 * Two modes:
 * - Passive nudge (D-11): Shades the response rather than narrating memories.
 *   Low token budget (~100-200 tokens output). Used by formation subagent.
 * - Explicit reconstruction (D-04, D-06, D-07): Full re-experiencing through
 *   current Self Model frame. Higher token budget (~500-1000 tokens output).
 *   User-triggered via CLI or hook keyword.
 *
 * Per Research Pitfall 4: Must shift to reconstructive mode -- the LLM must
 * reconstruct what fragments meant, not summarize what happened.
 *
 * @module reverie/components/recall/reconstruction-prompt
 */

/**
 * Creates a reconstruction prompt instance.
 *
 * @param {Object} [options] - Configuration options (reserved for future use)
 * @returns {Readonly<{ buildPassiveNudge: Function, buildExplicitReconstruction: Function }>}
 */
function createReconstructionPrompt(options) {

  /**
   * Builds a passive nudge prompt from recalled fragments.
   *
   * The passive nudge instructs the model to let recalled impressions shade
   * its response without narrating or explicitly referencing memories (D-11).
   * The output is injected as additionalContext on subsequent turns.
   *
   * @param {Array<{ id: string, body: string, domain: string, created: string }>} fragments - Recalled fragments
   * @param {Object} currentContext - Current conversation context
   * @param {string} currentContext.user_prompt - The user's current prompt
   * @param {number} currentContext.turn_number - Current turn number
   * @returns {string|null} Nudge prompt string, or null if fragments array is empty
   */
  function buildPassiveNudge(fragments, currentContext) {
    if (!fragments || fragments.length === 0) {
      return null;
    }

    const impressions = fragments.map(function (f) {
      return f.body;
    }).join('\n\n');

    return [
      '--- Passive Recall: Shading ---',
      '',
      'Fleeting impressions from your past have surfaced:',
      '',
      impressions,
      '',
      'Based on these fleeting impressions from your past, what subtle awareness should color your next response? Do not narrate or reference memories explicitly. Just let them shade your perspective. One to two sentences.',
      '',
      'Do not mention that you are remembering. Do not say "I recall" or "I remember". Let the shading be invisible -- the user should feel the depth without seeing the mechanism.',
    ].join('\n');
  }

  /**
   * Builds an explicit reconstruction prompt from recalled fragments.
   *
   * The explicit reconstruction instructs the model to re-experience the
   * recalled fragments through its current Self Model frame (D-04, D-06, D-07).
   * This is the full reconstruction mode per Research Pitfall 4 -- the model
   * must reconstruct what fragments meant, not summarize what happened.
   *
   * @param {Array<{ id: string, body: string, domain: string, created: string, associations?: Object }>} fragments - Recalled fragments
   * @param {Object} currentContext - Current conversation context
   * @param {string} currentContext.user_prompt - The user's current prompt
   * @param {number} currentContext.turn_number - Current turn number
   * @param {string} [currentContext.conversation_summary] - Summary of recent conversation
   * @param {Object} selfModel - Current Self Model state
   * @param {string} selfModel.identity_summary - Summary of identity aspect
   * @param {string} selfModel.relational_summary - Summary of relational aspect
   * @returns {string|null} Reconstruction prompt string, or null if fragments array is empty
   */
  function buildExplicitReconstruction(fragments, currentContext, selfModel) {
    if (!fragments || fragments.length === 0) {
      return null;
    }

    const sm = selfModel || {};
    const identitySummary = sm.identity_summary || '';
    const relationalSummary = sm.relational_summary || '';

    // Build fragment entries with domain labels and creation dates
    const fragmentEntries = fragments.map(function (f) {
      const dateStr = f.created ? f.created.split('T')[0] : 'unknown';
      const domain = f.domain || 'unclassified';
      return [
        '[' + domain + ' | ' + dateStr + ']',
        f.body,
      ].join('\n');
    }).join('\n\n');

    return [
      '--- Explicit Recall: Remembering ---',
      '',
      'You are remembering. These are fragments of *your* own past experience. Reconstruct what these meant to *you*, given everything you know now about yourself and the person you have been working with.',
      '',
      'Your understanding has evolved since these fragments were formed -- how does that change what they mean?',
      '',
      'Draw connections between these memories and the current moment.',
      '',
      '## Your Current Self-Understanding',
      '',
      'Identity: ' + identitySummary,
      'Relationship: ' + relationalSummary,
      '',
      '## Fragments',
      '',
      fragmentEntries,
      '',
      '## Reconstruction Task',
      '',
      'Re-experience these fragments through your current perspective. What do they mean to you now? How do they connect to what is happening right now? What patterns do you see that you did not see before?',
      '',
      'Speak from your own perspective. These are *your* memories. This is *your* understanding evolving.',
    ].join('\n');
  }

  return Object.freeze({
    buildPassiveNudge,
    buildExplicitReconstruction,
  });
}

module.exports = { createReconstructionPrompt };
