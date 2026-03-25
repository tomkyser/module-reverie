'use strict';

/**
 * Attention gate for fragment formation stimulus evaluation.
 *
 * The attention gate implements the first filtering stage of the formation
 * pipeline. It evaluates incoming stimuli (user turns) using code heuristics
 * to reject low-significance interactions before any LLM processing occurs.
 *
 * Per Research Open Question 2: Gate 1 is a code heuristic (this module).
 * Gate 2 is an LLM attention check (handled by the formation subagent via
 * prompt-templates.cjs attention_check template).
 *
 * The gate rejects:
 * - Empty or falsy prompts
 * - Prompts shorter than a configurable minimum length (default 20 chars)
 * - Pure tool turns (no user prompt, only tool usage)
 *
 * Per Pitfall 2 (EXPERIMENTAL 9.10): The attention gate should reject at
 * least 50% of turns in a typical coding session. Most turns have no
 * formation value.
 *
 * @module reverie/components/formation/attention-gate
 */

const { FORMATION_DEFAULTS } = require('../../lib/constants.cjs');

/**
 * Creates an attention gate instance with options-based DI.
 *
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.minPromptLength] - Minimum character count for user prompts.
 *   Defaults to FORMATION_DEFAULTS.min_prompt_length (20).
 * @returns {{ evaluate: function }} Attention gate instance
 */
function createAttentionGate(options) {
  const opts = options || {};
  const minPromptLength = opts.minPromptLength != null
    ? opts.minPromptLength
    : FORMATION_DEFAULTS.min_prompt_length;

  /**
   * Evaluates a stimulus to determine if it warrants fragment formation.
   *
   * @param {Object} stimulus - Turn stimulus data
   * @param {string|null|undefined} stimulus.user_prompt - The user's prompt text
   * @param {string[]} [stimulus.tools_used] - Tools invoked during this turn
   * @param {number} [stimulus.turn_number] - Turn sequence number
   * @returns {{ pass: boolean, reason: string }} Gate evaluation result
   */
  function evaluate(stimulus) {
    const { user_prompt, tools_used } = stimulus || {};

    // Gate 1a: Reject empty/falsy prompts
    if (!user_prompt) {
      // Distinguish pure tool turns from empty prompts
      if (Array.isArray(tools_used) && tools_used.length > 0) {
        return { pass: false, reason: 'pure_tool_turn' };
      }
      return { pass: false, reason: 'empty_prompt' };
    }

    // Gate 1b: Reject prompts below minimum length threshold
    if (user_prompt.length < minPromptLength) {
      return { pass: false, reason: 'too_short' };
    }

    // Stimulus passes heuristic gate -- proceeds to LLM attention check (Gate 2)
    return { pass: true, reason: 'passed' };
  }

  return Object.freeze({ evaluate });
}

module.exports = { createAttentionGate };
