'use strict';

/**
 * Fragment assembler -- parses subagent formation output into schema-valid
 * fragment frontmatter.
 *
 * The formation subagent produces free-form JSON output (possibly wrapped
 * in markdown code blocks). The assembler:
 * 1. Extracts and parses the JSON reliably (never throws)
 * 2. Builds complete frontmatter objects matching baseFragmentSchema
 * 3. Applies emergent type classification per D-14
 *
 * Per D-14: Fragment type is emergent, not prescribed. The assembler labels
 * type post-formation based on what the LLM produced:
 * - source_fragments present -> 'meta-recall'
 * - source_locator present -> 'source-reference'
 * - otherwise -> 'experiential'
 *
 * The caller validates the assembled frontmatter via validateFragment()
 * before writing (separation of concerns: assembler builds, schema validates).
 *
 * @module reverie/components/formation/fragment-assembler
 */

/**
 * Regex to extract JSON from markdown code blocks.
 * Matches ```json ... ``` or ``` ... ``` blocks.
 * @type {RegExp}
 */
const CODE_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)```/;

/**
 * Creates a fragment assembler instance with options-based DI.
 *
 * @param {Object} [options={}] - Configuration options (reserved for future use)
 * @returns {{ parseFormationOutput: function, buildFrontmatter: function }}
 */
function createFragmentAssembler(options) {

  /**
   * Parses raw subagent formation output into a structured object.
   *
   * Attempts parsing in order:
   * 1. Direct JSON.parse
   * 2. Extract JSON from markdown code blocks
   * 3. Return { should_form: false, error: 'parse_failed' }
   *
   * Never throws regardless of input.
   *
   * @param {string} rawOutput - Raw text output from formation subagent
   * @returns {{ should_form: boolean, fragments?: Array, nudge?: string, error?: string }}
   */
  function parseFormationOutput(rawOutput) {
    // Guard against non-string input
    if (typeof rawOutput !== 'string' || rawOutput.length === 0) {
      return { should_form: false, error: 'parse_failed', raw: rawOutput };
    }

    // Attempt 1: Direct JSON.parse
    try {
      const parsed = JSON.parse(rawOutput);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch (_) {
      // Fall through to code block extraction
    }

    // Attempt 2: Extract from markdown code blocks
    try {
      const match = rawOutput.match(CODE_BLOCK_REGEX);
      if (match && match[1]) {
        const parsed = JSON.parse(match[1].trim());
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      }
    } catch (_) {
      // Fall through to failure
    }

    // Attempt 3: Parse failed
    return { should_form: false, error: 'parse_failed', raw: rawOutput };
  }

  /**
   * Builds a complete fragment frontmatter object from subagent output
   * and session context.
   *
   * The output matches the baseFragmentSchema from schemas.cjs:
   * - id, type, created, source_session, self_model_version
   * - formation_group, formation_frame, sibling_fragments
   * - temporal: { absolute, session_relative, sequence }
   * - decay: { initial_weight, current_weight, last_accessed, access_count, consolidation_count, pinned }
   * - associations: { domains, entities, self_model_relevance, emotional_valence, attention_tags }
   * - pointers: { causal_antecedents, causal_consequents, thematic_siblings, contradictions, meta_recalls, source_fragments }
   * - formation: { trigger, attention_pointer, active_domains_at_formation, sublimation_that_prompted }
   * - source_locator (optional, only for source-reference)
   *
   * @param {Object} fragmentData - One element from the formation output's fragments array
   * @param {Object} context - Session and formation context
   * @param {string} context.id - Fragment ID (pre-generated, matches FRAGMENT_ID_PATTERN)
   * @param {string} context.formationGroup - Formation group ID
   * @param {string[]} [context.siblings] - Sibling fragment IDs
   * @param {Object} context.sessionContext - Session metadata
   * @param {string} context.sessionContext.sessionId - Current session ID
   * @param {string} [context.sessionContext.selfModelVersion] - Self Model version
   * @param {string} [context.sessionContext.sessionStart] - Session start ISO timestamp
   * @param {number} [context.sessionContext.sessionPosition] - Position in session (0-1)
   * @param {number} [context.sessionContext.turnNumber] - Turn sequence number
   * @param {string} [context.sessionContext.trigger] - What triggered formation
   * @returns {Object} Complete frontmatter object matching baseFragmentSchema
   */
  function buildFrontmatter(fragmentData, context) {
    const data = fragmentData || {};
    const ctx = context || {};
    const sc = ctx.sessionContext || {};
    const now = new Date().toISOString();

    // Emergent type classification per D-14
    let type = 'experiential';
    if (Array.isArray(data.source_fragments) && data.source_fragments.length > 0) {
      type = 'meta-recall';
    } else if (data.source_locator) {
      type = 'source-reference';
    }

    const siblings = ctx.siblings || [];
    const initialWeight = data.initial_weight != null ? data.initial_weight : 0.5;

    const frontmatter = {
      id: ctx.id,
      type,
      created: now,
      source_session: sc.sessionId || '',
      self_model_version: sc.selfModelVersion || '0.0.0',
      formation_group: ctx.formationGroup || '',
      formation_frame: data.formation_frame || 'experiential',
      sibling_fragments: siblings,

      temporal: {
        absolute: sc.sessionStart || now,
        session_relative: sc.sessionPosition != null ? sc.sessionPosition : 0,
        sequence: sc.turnNumber != null ? sc.turnNumber : 0,
      },

      decay: {
        initial_weight: initialWeight,
        current_weight: initialWeight,
        last_accessed: now,
        access_count: 0,
        consolidation_count: 0,
        pinned: false,
      },

      associations: {
        domains: data.domains || [],
        entities: data.entities || [],
        self_model_relevance: data.self_model_relevance || {
          identity: 0,
          relational: 0,
          conditioning: 0,
        },
        emotional_valence: data.emotional_valence != null ? data.emotional_valence : 0,
        attention_tags: data.attention_tags || [],
      },

      pointers: {
        causal_antecedents: [],
        causal_consequents: [],
        thematic_siblings: siblings,
        contradictions: [],
        meta_recalls: [],
        source_fragments: data.source_fragments || [],
      },

      formation: {
        trigger: sc.trigger || 'user_prompt',
        attention_pointer: (data.attention_tags && data.attention_tags[0]) || '',
        active_domains_at_formation: data.domains || [],
        sublimation_that_prompted: null,
      },
    };

    // Only include source_locator for source-reference type
    if (data.source_locator) {
      frontmatter.source_locator = data.source_locator;
    }

    return frontmatter;
  }

  return Object.freeze({ parseFormationOutput, buildFrontmatter });
}

module.exports = { createFragmentAssembler };
