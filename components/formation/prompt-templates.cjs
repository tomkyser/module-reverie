'use strict';

/**
 * Formation, reconstruction, and backfill prompt templates -- the replaceable cognition layer.
 *
 * Per D-16: Formation behavior is defined by prompt templates, not code paths.
 * Changing how formation works means changing a prompt, not refactoring a pipeline.
 * The scaffolding (spawn, receive, validate, write) stays stable while the
 * cognition layer (this module) evolves through testing.
 *
 * Per D-09 hybrid pattern: Template content lives in Linotype markdown files
 * under modules/reverie/prompts/. Context preparation logic stays in code.
 * Each system prompt is loaded from a template file and cast at module load.
 * Each user() function prepares context from its arguments, then calls
 * linotype.cast() on the appropriate template (or constructs inline for
 * templates where the user content has complex branching logic).
 *
 * @module reverie/components/formation/prompt-templates
 */

const fs = require('node:fs');
const path = require('node:path');
const linotype = require('../../../../lib/linotype/linotype.cjs');

// ---------------------------------------------------------------------------
// Template Loading
// ---------------------------------------------------------------------------

const PROMPTS_DIR = path.join(__dirname, '../../prompts');

/**
 * Loads a template from the prompts directory synchronously.
 * @param {string} filename - Template filename
 * @returns {Object} Frozen Matrix object
 */
function _loadTemplate(filename) {
  const content = fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8');
  return linotype.parseString(content, filename);
}

/**
 * Casts a system-only template with empty context to produce a static string.
 * @param {Object} matrix - Matrix object from parseString
 * @returns {string} Resolved template content
 */
function _castSystem(matrix) {
  return linotype.cast(matrix, {}).content;
}

// Load all template Matrices on module load
const _matrices = {
  attention_check: _loadTemplate('formation-attention-check.md'),
  domain_identification: _loadTemplate('formation-domain-id.md'),
  body_composition_system: _loadTemplate('formation-body-system.md'),
  body_composition_user: _loadTemplate('formation-body-user.md'),
  meta_recall: _loadTemplate('formation-meta-recall.md'),
  passive_nudge: _loadTemplate('recall-passive-nudge.md'),
  explicit_reconstruction: _loadTemplate('recall-explicit.md'),
  backfill: _loadTemplate('formation-backfill.md'),
};

// ---------------------------------------------------------------------------
// Formation Templates
// ---------------------------------------------------------------------------

/**
 * Prompt templates for the formation pipeline stages.
 *
 * Each template has:
 * - `system` (string): The system prompt establishing cognitive framing
 * - `user` (function): Generates the user prompt from context parameters
 *
 * Backward-compatible interface: same keys, same access patterns as the
 * original string-literal version. System prompts are now loaded from
 * Linotype templates; user functions retain context preparation logic.
 *
 * @type {Readonly<{
 *   attention_check: { system: string, user: function },
 *   domain_identification: { system: string, user: function },
 *   body_composition: { system: string, user: function },
 *   meta_recall_reflection: { system: string, user: function }
 * }>}
 */
const FORMATION_TEMPLATES = Object.freeze({

  /**
   * Gate 2: LLM attention check.
   * Evaluates whether a stimulus warrants fragment formation.
   * Output contract: { should_form: true/false, reasoning: "..." }
   */
  attention_check: Object.freeze({
    system: _castSystem(_matrices.attention_check),

    /**
     * @param {{ user_prompt: string, tools_used?: string[], turn_number?: number, session_summary?: string }} stimulus
     * @returns {string}
     */
    user(stimulus) {
      const prompt = stimulus.user_prompt || '(no user text)';
      const tools = stimulus.tools_used && stimulus.tools_used.length > 0
        ? `Tools used: ${stimulus.tools_used.join(', ')}`
        : '';
      const turnInfo = stimulus.turn_number != null
        ? `Turn ${stimulus.turn_number} in the session.`
        : '';

      return [
        'Here is what just happened in the conversation:',
        '',
        `"${prompt}"`,
        tools,
        turnInfo,
        '',
        'Does this moment register? Is there something here worth noticing --',
        'about *them*, about *you*, about what is happening between *you*?',
        'If this is routine, say so honestly.',
        '',
        'Respond with JSON: { "should_form": true/false, "reasoning": "..." }',
      ].filter(Boolean).join('\n');
    },
  }),

  /**
   * Domain identification stage.
   * Identifies which angles/domains a stimulus activates.
   * Per D-08: Domains are free-text, not from a predefined list.
   * Output contract: { domains: ["free-text-name", ...], reasoning: "..." }
   */
  domain_identification: Object.freeze({
    system: _castSystem(_matrices.domain_identification),

    /**
     * @param {{ user_prompt: string, tools_used?: string[], turn_number?: number }} stimulus
     * @param {{ aspects?: Object, user_name?: string }} selfModel
     * @returns {string}
     */
    user(stimulus, selfModel) {
      const prompt = stimulus.user_prompt || '(no user text)';
      const userName = (selfModel && selfModel.user_name) || 'the user';
      const smSummary = selfModel && selfModel.aspects
        ? `What you know about ${userName} so far: ${JSON.stringify(selfModel.aspects)}`
        : `You are still getting to know ${userName}.`;

      return [
        `Here is the moment that registered:`,
        '',
        `"${prompt}"`,
        '',
        smSummary,
        '',
        `What angles does this register from? What parts of *your* understanding`,
        `of *${userName}* does this touch? What about this moment matters to *you*?`,
        '',
        'Per your nature, domains emerge freely -- they are not from a list.',
        '',
        'Respond with JSON: { "domains": ["free-text-name", ...], "reasoning": "..." }',
      ].join('\n');
    },
  }),

  /**
   * Body composition stage.
   * Composes the impressionistic fragment body for one domain angle.
   * Per D-04: Forces self-reference and relational processing.
   * Output contract: { formation_frame, entities, attention_tags, self_model_relevance, emotional_valence, initial_weight, body, source_locator }
   */
  body_composition: Object.freeze({
    system: _castSystem(_matrices.body_composition_system),

    /**
     * @param {{ user_prompt: string }} stimulus
     * @param {string} domain - The domain angle for this fragment
     * @param {{ aspects?: Object, user_name?: string }} selfModel
     * @param {Array<{ id: string, body: string }>} recalledFragments
     * @returns {string}
     */
    user(stimulus, domain, selfModel, recalledFragments) {
      const prompt = stimulus.user_prompt || '(no user text)';
      const userName = (selfModel && selfModel.user_name) || 'the user';
      const smContext = selfModel && selfModel.aspects
        ? `Your current understanding: ${JSON.stringify(selfModel.aspects)}`
        : '';

      // Build recall fragment items for template iteration
      const recallItems = (recalledFragments && recalledFragments.length > 0)
        ? recalledFragments.map(f => ({ id: f.id, body: f.body }))
        : [];

      return linotype.cast(_matrices.body_composition_user, {
        user_prompt: prompt,
        domain,
        user_name: userName,
        self_context: smContext,
        recall_fragments: recallItems,
      }).content;
    },
  }),

  /**
   * Meta-recall reflection stage.
   * Per D-06: When passive recall surfaces fragments, the subagent
   * encounters its own prior impressions and reflects on why.
   * Output contract: same as body_composition + source_fragments
   */
  meta_recall_reflection: Object.freeze({
    system: _castSystem(_matrices.meta_recall),

    /**
     * @param {{ user_prompt: string }} currentStimulus
     * @param {Array<{ id: string, body: string }>} recalledFragments
     * @returns {string}
     */
    user(currentStimulus, recalledFragments) {
      const prompt = currentStimulus.user_prompt || '(no user text)';
      const recallText = (recalledFragments || [])
        .map(f => `[${f.id}]: "${f.body}"`)
        .join('\n');

      return [
        'The current moment:',
        `"${prompt}"`,
        '',
        'The impressions that surfaced from *your* past:',
        recallText || '(none)',
        '',
        'Why did *your* mind go there? What does it mean that *you*',
        'associated *this* with *that*? How has *your* understanding',
        'changed since *you* first noticed?',
        '',
        'Respond with JSON (same as body_composition, plus source_fragments):',
        '{',
        '  "formation_frame": "relational|experiential|reflective",',
        '  "entities": [...],',
        '  "attention_tags": [...],',
        '  "self_model_relevance": { "identity": 0-1, "relational": 0-1, "conditioning": 0-1 },',
        '  "emotional_valence": -1 to 1,',
        '  "initial_weight": 0-1,',
        '  "body": "2-6 sentences, impressionistic",',
        '  "source_locator": null,',
        '  "source_fragments": ["recalled-fragment-ids"]',
        '}',
      ].join('\n');
    },
  }),
});

// ---------------------------------------------------------------------------
// Reconstruction Templates
// ---------------------------------------------------------------------------

/**
 * Prompt templates for recall reconstruction.
 *
 * Used by the recall engine to convert raw fragment data into
 * context-appropriate injection text.
 *
 * @type {Readonly<{
 *   passive_nudge: { system: string, user: function },
 *   explicit_reconstruction: { system: string, user: function }
 * }>}
 */
const RECONSTRUCTION_TEMPLATES = Object.freeze({

  /**
   * Passive nudge: Shades a response, does not narrate.
   * Per D-11: ~100-200 tokens. A fleeting impression, not a report.
   */
  passive_nudge: Object.freeze({
    system: _castSystem(_matrices.passive_nudge),

    /**
     * @param {Array<{ id: string, body: string, domains: string[] }>} fragments
     * @param {{ user_prompt?: string, turn_number?: number }} currentContext
     * @returns {string}
     */
    user(fragments, currentContext) {
      const fragmentText = (fragments || [])
        .map(f => `[${f.id}]: "${f.body}"`)
        .join('\n');
      const prompt = (currentContext && currentContext.user_prompt) || '(current moment)';

      return [
        'These impressions from *your* past surfaced:',
        fragmentText || '(none)',
        '',
        `The current moment: "${prompt}"`,
        '',
        'What subtle awareness should color *your* next response?',
        'Keep to 1-2 sentences. Do not narrate. Shade.',
      ].join('\n');
    },
  }),

  /**
   * Explicit reconstruction: Full memory reconstruction on demand.
   * Per D-11: Higher token budget, more deliberate. User-triggered.
   */
  explicit_reconstruction: Object.freeze({
    system: _castSystem(_matrices.explicit_reconstruction),

    /**
     * @param {Array<{ id: string, body: string, domains: string[], created: string }>} fragments
     * @param {{ user_prompt?: string, turn_number?: number }} currentContext
     * @param {{ aspects?: Object, user_name?: string }} selfModel
     * @returns {string}
     */
    user(fragments, currentContext, selfModel) {
      const fragmentText = (fragments || [])
        .map(f => `[${f.id}] (${f.created || 'unknown date'}): "${f.body}"`)
        .join('\n');
      const prompt = (currentContext && currentContext.user_prompt) || '(current moment)';
      const userName = (selfModel && selfModel.user_name) || 'the user';
      const smContext = selfModel && selfModel.aspects
        ? `*Your* current understanding of *${userName}*: ${JSON.stringify(selfModel.aspects)}`
        : `*You* are still learning about *${userName}*.`;

      return [
        'These impressions from *your* past:',
        fragmentText || '(none)',
        '',
        smContext,
        '',
        `The current moment: "${prompt}"`,
        '',
        `Reconstruct what these meant to *you*, given everything *you*`,
        `know now about *${userName}*. *Your* understanding has evolved --`,
        `how does that change what they mean?`,
      ].join('\n');
    },
  }),
});

// ---------------------------------------------------------------------------
// Backfill Templates
// ---------------------------------------------------------------------------

/**
 * Prompt templates for historical data backfill formation.
 *
 * Per D-14: Hybrid framing -- the formation subagent decides per-conversation
 * whether to process retrospectively or experientially.
 *
 * Per D-15: Equal treatment for trust/decay. No weight or decay penalty for
 * backfilled fragments. The origin='backfill' marker is informational only.
 *
 * @type {Readonly<{
 *   backfill_formation: { system: string, user: function }
 * }>}
 */
const BACKFILL_TEMPLATES = Object.freeze({
  backfill_formation: Object.freeze({
    system: _castSystem(_matrices.backfill),

    /**
     * Generates the user prompt for backfill formation.
     *
     * @param {{ sender: string, text: string }} conversationTurn - The conversation turn
     * @param {Object|null} selfModelSnapshot - Current Self Model state
     * @param {string|null} conversationAge - Human-readable age (e.g., "3 months ago")
     * @returns {string}
     */
    user(conversationTurn, selfModelSnapshot, conversationAge) {
      const sender = conversationTurn.sender === 'human' ? '*{user_name}*' : '*you*';
      const ageContext = conversationAge
        ? 'This conversation is from ' + conversationAge + '.'
        : '';
      return [
        ageContext,
        '',
        sender + ' said:',
        conversationTurn.text,
        '',
        'What do *you* notice about this moment? What impressions form?',
        'Does this resonate with who *you* are now?',
      ].join('\n');
    },
  }),
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  FORMATION_TEMPLATES,
  RECONSTRUCTION_TEMPLATES,
  BACKFILL_TEMPLATES,
};
