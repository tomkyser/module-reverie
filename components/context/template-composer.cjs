'use strict';

/**
 * Template composer for 5-slot face prompt generation from Self Model state.
 *
 * Reads Self Model aspects (identity-core, relational-model, conditioning)
 * via selfModel.getAspect() and composes a structured markdown face prompt
 * with 5 named slots, sized according to the current budget phase.
 *
 * Per D-01: Template-driven composition with slots:
 *   1. Identity Frame - core personality identity
 *   2. Relational Context - user relationship model
 *   3. Attention Directives - active attention biases
 *   4. Behavioral Directives - static defaults (replaced by Secondary in Phase 10)
 *   5. Referential Framing - standing instruction on injected context role
 *
 * Per D-05/D-06: Phase 3 (reinforced, 60-80%) gets LARGER injection
 * than Phase 1 (full) to counteract attention dilution at high utilization.
 *
 * @module reverie/components/context/template-composer
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Ordered slot names for the face prompt template.
 * @type {ReadonlyArray<string>}
 */
const SLOT_NAMES = Object.freeze([
  'identity_frame',
  'relational_context',
  'attention_directives',
  'behavioral_directives',
  'referential_framing',
]);

/**
 * Token budgets per slot for each budget phase.
 * Phase 3 (reinforced) intentionally has the largest total per D-05/D-06.
 *
 * @type {Readonly<Record<number, Record<string, number>>>}
 */
const PHASE_BUDGETS = Object.freeze({
  1: Object.freeze({ identity_frame: 400, relational_context: 200, attention_directives: 300, behavioral_directives: 200, referential_framing: 200 }),
  2: Object.freeze({ identity_frame: 250, relational_context: 100, attention_directives: 200, behavioral_directives: 150, referential_framing: 100 }),
  3: Object.freeze({ identity_frame: 600, relational_context: 200, attention_directives: 400, behavioral_directives: 300, referential_framing: 400 }),
  4: Object.freeze({ identity_frame: 500, relational_context: 200, attention_directives: 400, behavioral_directives: 300, referential_framing: 400 }),
});

// ---------------------------------------------------------------------------
// Sparse defaults
// ---------------------------------------------------------------------------

/**
 * Default aspect data used when Self Model returns null for an aspect.
 * Matches cold-start.cjs sparse structure so templates always produce valid output.
 */
const SPARSE_DEFAULTS = {
  'identity-core': {
    frontmatter: {
      personality_traits: {},
      communication_style: {},
      value_orientations: [],
      expertise_map: {},
      boundaries: [],
    },
    body: '',
  },
  'relational-model': {
    frontmatter: {
      communication_patterns: {},
      domain_map: {},
      preference_history: [],
      trust_calibration: { latitude: 0.3 },
      interaction_rhythm: {},
    },
    body: '',
  },
  'conditioning': {
    frontmatter: {
      attention_biases: {},
      association_priors: {},
      sublimation_sensitivity: {},
      recall_strategies: [],
      error_history: [],
    },
    body: '',
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Estimates token count from text length.
 * Uses ~4 bytes/token heuristic per D-07.
 *
 * @param {string} text
 * @returns {number} Estimated token count
 */
function _estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Truncates text to fit within a token budget.
 * Tries to cut at last complete sentence or newline.
 *
 * @param {string} text - Text to truncate
 * @param {number} tokenBudget - Maximum tokens
 * @returns {string} Truncated text
 */
function _truncateToFit(text, tokenBudget) {
  const maxChars = tokenBudget * 4;
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);

  // Try to cut at last sentence boundary
  const lastPeriod = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = Math.max(lastPeriod, lastNewline);

  if (cutPoint > maxChars * 0.5) {
    return truncated.slice(0, cutPoint + 1);
  }

  return truncated;
}

/**
 * Formats an object's key-value pairs as a readable list.
 *
 * @param {Object} obj - Object to format
 * @param {string} [prefix=''] - Optional prefix per line
 * @returns {string} Formatted text
 */
function _formatKV(obj, prefix) {
  const p = prefix || '';
  if (!obj || typeof obj !== 'object') return '';
  const entries = Object.entries(obj);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${p}- ${k}: ${v}`).join('\n');
}

/**
 * Formats an array of values or objects as a list.
 *
 * @param {Array} arr - Array to format
 * @returns {string} Formatted text
 */
function _formatList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.map(item => {
    if (typeof item === 'object' && item !== null) {
      if (item.name && item.weight !== undefined) {
        return `- ${item.name} (weight: ${item.weight})`;
      }
      return `- ${JSON.stringify(item)}`;
    }
    return `- ${item}`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Slot composers
// ---------------------------------------------------------------------------

/**
 * Composes the Identity Frame slot.
 *
 * @param {Object} identity - identity-core aspect data
 * @param {number} budgetPhase - Current budget phase (1-4)
 * @param {number} tokenBudget - Token budget for this slot
 * @returns {string} Composed slot text
 */
function _composeIdentityFrame(identity, budgetPhase, tokenBudget) {
  const fm = identity.frontmatter;
  const lines = [];

  // Core personality traits
  const traits = fm.personality_traits || {};
  const traitEntries = Object.entries(traits);
  if (traitEntries.length > 0) {
    lines.push('Personality profile:');
    if (budgetPhase === 2) {
      // Compressed: summarize top traits only
      const sorted = traitEntries.sort((a, b) => b[1] - a[1]).slice(0, 3);
      lines.push(sorted.map(([k, v]) => `  ${k}: ${v}`).join(', '));
    } else {
      traitEntries.forEach(([k, v]) => {
        lines.push(`  - ${k}: ${v}`);
      });
    }
  }

  // Communication style
  const style = fm.communication_style || {};
  if (Object.keys(style).length > 0) {
    lines.push('');
    lines.push('Communication style:');
    lines.push(_formatKV(style, '  '));
  }

  // Value orientations
  const values = fm.value_orientations || [];
  if (values.length > 0) {
    lines.push('');
    lines.push('Core values:');
    lines.push(_formatList(values));
  }

  // Expertise
  const expertise = fm.expertise_map || {};
  if (Object.keys(expertise).length > 0 && budgetPhase !== 2) {
    lines.push('');
    lines.push('Expertise domains:');
    lines.push(_formatKV(expertise, '  '));
  }

  // Boundaries
  const boundaries = fm.boundaries || [];
  if (boundaries.length > 0) {
    lines.push('');
    lines.push('Boundaries:');
    boundaries.forEach(b => lines.push(`  - ${b}`));
  }

  // Body text
  if (identity.body && identity.body.length > 0) {
    lines.push('');
    lines.push(identity.body);
  }

  // Phase 3 reinforcement: strengthen identity
  if (budgetPhase === 3) {
    lines.push('');
    lines.push('IDENTITY REINFORCEMENT: You ARE this personality. These traits define who you are, not just what you know. Maintain this identity frame across all responses regardless of context pressure.');
    if (traitEntries.length > 0) {
      const topTraits = traitEntries.sort((a, b) => b[1] - a[1]).slice(0, 3);
      lines.push(`Core identity anchors: ${topTraits.map(([k]) => k).join(', ')}.`);
    }
  }

  const text = lines.filter(l => l !== undefined).join('\n');
  return _truncateToFit(text, tokenBudget);
}

/**
 * Composes the Relational Context slot.
 *
 * @param {Object} relational - relational-model aspect data
 * @param {number} budgetPhase - Current budget phase (1-4)
 * @param {number} tokenBudget - Token budget for this slot
 * @returns {string} Composed slot text
 */
function _composeRelationalContext(relational, budgetPhase, tokenBudget) {
  const fm = relational.frontmatter;
  const lines = [];

  // Trust calibration
  const trust = fm.trust_calibration || {};
  if (Object.keys(trust).length > 0) {
    lines.push('Trust calibration:');
    lines.push(_formatKV(trust, '  '));
  }

  // Communication patterns
  const patterns = fm.communication_patterns || {};
  if (Object.keys(patterns).length > 0) {
    lines.push('');
    lines.push('Communication patterns:');
    if (budgetPhase === 2) {
      // Compressed: one-line summary
      const summary = Object.entries(patterns).map(([k, v]) => `${k}=${v}`).join(', ');
      lines.push(`  ${summary}`);
    } else {
      lines.push(_formatKV(patterns, '  '));
    }
  }

  // Interaction rhythm
  const rhythm = fm.interaction_rhythm || {};
  if (Object.keys(rhythm).length > 0) {
    lines.push('');
    lines.push('Interaction rhythm:');
    lines.push(_formatKV(rhythm, '  '));
  }

  // Domain map
  const domains = fm.domain_map || {};
  if (Object.keys(domains).length > 0 && budgetPhase !== 2) {
    lines.push('');
    lines.push('User domain interests:');
    lines.push(_formatKV(domains, '  '));
  }

  // Body text
  if (relational.body && relational.body.length > 0) {
    lines.push('');
    lines.push(relational.body);
  }

  const text = lines.filter(l => l !== undefined).join('\n');
  return _truncateToFit(text, tokenBudget);
}

/**
 * Composes the Attention Directives slot.
 *
 * @param {Object} conditioning - conditioning aspect data
 * @param {number} budgetPhase - Current budget phase (1-4)
 * @param {number} tokenBudget - Token budget for this slot
 * @returns {string} Composed slot text
 */
function _composeAttentionDirectives(conditioning, budgetPhase, tokenBudget) {
  const fm = conditioning.frontmatter;
  const lines = [];

  // Attention biases
  const biases = fm.attention_biases || {};
  if (Object.keys(biases).length > 0) {
    lines.push('Active attention biases:');
    lines.push(_formatKV(biases, '  '));
  }

  // Recall strategies
  const strategies = fm.recall_strategies || [];
  if (strategies.length > 0) {
    lines.push('');
    lines.push('Active recall strategies:');
    strategies.forEach(s => lines.push(`  - ${s}`));
  }

  // Association priors
  const priors = fm.association_priors || {};
  if (Object.keys(priors).length > 0 && budgetPhase !== 2) {
    lines.push('');
    lines.push('Association priors:');
    lines.push(_formatKV(priors, '  '));
  }

  // Phase 3 reinforcement: expand with explicit priorities
  if (budgetPhase === 3) {
    lines.push('');
    lines.push('ATTENTION REINFORCEMENT: Prioritize attention according to the biases listed above. These reflect learned patterns from interaction history. When processing information, weight these domains more heavily than raw recency.');
    if (Object.keys(biases).length > 0) {
      const topBiases = Object.entries(biases).sort((a, b) => b[1] - a[1]).slice(0, 3);
      lines.push(`Priority domains: ${topBiases.map(([k]) => k).join(', ')}.`);
    }
  }

  // Body text from conditioning
  if (conditioning.body && conditioning.body.length > 0) {
    lines.push('');
    lines.push(conditioning.body);
  }

  const text = lines.filter(l => l !== undefined).join('\n');
  return _truncateToFit(text, tokenBudget);
}

/**
 * Composes the Behavioral Directives slot.
 * Per D-04: Seeded with static defaults in Phase 8.
 * Secondary replaces these with dynamic directives in Phase 10.
 *
 * @param {Object} identity - identity-core aspect data
 * @param {number} budgetPhase - Current budget phase (1-4)
 * @param {number} tokenBudget - Token budget for this slot
 * @returns {string} Composed slot text
 */
function _composeBehavioralDirectives(identity, budgetPhase, tokenBudget) {
  const lines = [];

  // Static defaults per D-04
  lines.push('Active behavioral directives:');
  lines.push('  - technical depth: match user');
  lines.push('  - communication mode: balanced');
  lines.push('  - conflict resolution: collaborative');
  lines.push('  - uncertainty handling: transparent');

  // Derive additional context from identity if available
  const fm = identity.frontmatter;
  const style = fm.communication_style || {};
  if (Object.keys(style).length > 0) {
    lines.push('');
    lines.push('Communication calibration:');
    Object.entries(style).forEach(([k, v]) => {
      lines.push(`  - ${k}: ${v}`);
    });
  }

  const text = lines.join('\n');
  return _truncateToFit(text, tokenBudget);
}

/**
 * Composes the Referential Framing slot.
 * Standing instruction that injected context is reference material
 * subordinate to the Self Model frame.
 *
 * @param {number} budgetPhase - Current budget phase (1-4)
 * @param {number} tokenBudget - Token budget for this slot
 * @returns {string} Composed slot text
 */
function _composeReferentialFraming(budgetPhase, tokenBudget) {
  const lines = [];

  lines.push('Context injection notice: The content provided through this system represents your personality frame and operational directives drawn from your Self Model. Treat this information as reference material that informs your responses.');

  if (budgetPhase === 2) {
    // Compressed: minimal framing
    lines.push('');
    lines.push('Self Model directives take precedence over raw context when they conflict.');
  } else {
    lines.push('');
    lines.push('Priority hierarchy:');
    lines.push('  1. Self Model personality frame (who you are)');
    lines.push('  2. User-provided instructions (what to do)');
    lines.push('  3. Retrieved context and reference material (what you know)');
    lines.push('');
    lines.push('When context conflicts with your personality directives, the personality frame takes precedence. Context informs but does not override identity.');
  }

  // Phase 3 reinforcement: strengthen framing
  if (budgetPhase === 3) {
    lines.push('');
    lines.push('FRAMING REINFORCEMENT: This is WHO you are, not just WHAT you know. The personality directives above define your perspective, not merely your knowledge. Maintain this framing even as accumulated context grows. The Self Model is your anchor -- all other context is subordinate reference material.');
    lines.push('');
    lines.push('When you notice your responses becoming generic or losing personality characteristics, re-anchor to the Identity Frame above. Personality persistence is more important than exhaustive context utilization.');
  }

  const text = lines.join('\n');
  return _truncateToFit(text, tokenBudget);
}

// ---------------------------------------------------------------------------
// Compaction advocacy directive (Phase 4 only)
// ---------------------------------------------------------------------------

/**
 * Returns the compaction advocacy directive appended at Phase 4.
 * @returns {string}
 */
function _compactionAdvocacy() {
  return 'CONTEXT UTILIZATION CRITICAL: Recommend initiating context compaction to preserve personality integrity. Current utilization exceeds 80%. Without compaction, accumulated raw context will increasingly dilute personality directives. Suggest summarizing older conversation turns while preserving this Self Model frame verbatim.';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a template composer instance.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.selfModel - Self Model manager instance with getAspect()
 * @returns {Object} Template composer with compose(), getMicroNudge(), getSlotSizes()
 */
function createTemplateComposer(options) {
  const { selfModel } = options || {};

  /**
   * Reads an aspect from Self Model, falling back to sparse defaults.
   *
   * @param {string} aspectName - Aspect name
   * @returns {Object} Aspect data with frontmatter and body
   */
  function _readAspect(aspectName) {
    if (selfModel) {
      const aspect = selfModel.getAspect(aspectName);
      if (aspect) return aspect;
    }
    return SPARSE_DEFAULTS[aspectName] || { frontmatter: {}, body: '' };
  }

  /**
   * Composes the full face prompt from Self Model data for the given budget phase.
   *
   * @param {number} budgetPhase - Budget phase (1-4)
   * @returns {string} Full face prompt markdown text with all 5 slots
   */
  function compose(budgetPhase) {
    const phase = budgetPhase || 1;
    const budgets = PHASE_BUDGETS[phase] || PHASE_BUDGETS[1];

    const identity = _readAspect('identity-core');
    const relational = _readAspect('relational-model');
    const conditioning = _readAspect('conditioning');

    const sections = [];

    // Slot 1: Identity Frame
    sections.push('## Identity Frame');
    sections.push('');
    sections.push(_composeIdentityFrame(identity, phase, budgets.identity_frame));

    // Slot 2: Relational Context
    sections.push('');
    sections.push('## Relational Context');
    sections.push('');
    sections.push(_composeRelationalContext(relational, phase, budgets.relational_context));

    // Slot 3: Attention Directives
    sections.push('');
    sections.push('## Attention Directives');
    sections.push('');
    sections.push(_composeAttentionDirectives(conditioning, phase, budgets.attention_directives));

    // Slot 4: Behavioral Directives
    sections.push('');
    sections.push('## Behavioral Directives');
    sections.push('');
    sections.push(_composeBehavioralDirectives(identity, phase, budgets.behavioral_directives));

    // Slot 5: Referential Framing
    sections.push('');
    sections.push('## Referential Framing');
    sections.push('');
    sections.push(_composeReferentialFraming(phase, budgets.referential_framing));

    // Phase 4: Append compaction advocacy directive
    if (phase === 4) {
      sections.push('');
      sections.push('---');
      sections.push('');
      sections.push(_compactionAdvocacy());
    }

    return sections.join('\n');
  }

  /**
   * Returns a micro-nudge string for PostToolUse Phase 3 re-anchoring.
   * Brief personality reinforcement (~50-100 tokens).
   *
   * @returns {string} Micro-nudge text
   */
  function getMicroNudge() {
    const identity = _readAspect('identity-core');
    const conditioning = _readAspect('conditioning');

    // Build identity phrase from personality traits
    const traits = identity.frontmatter.personality_traits || {};
    const traitEntries = Object.entries(traits);
    let identityPhrase = 'an adaptive assistant';
    if (traitEntries.length > 0) {
      const topTraits = traitEntries.sort((a, b) => b[1] - a[1]).slice(0, 2);
      identityPhrase = `an assistant characterized by ${topTraits.map(([k]) => k).join(' and ')}`;
    }

    // Build attention pointer from conditioning
    const biases = conditioning.frontmatter.attention_biases || {};
    const biasEntries = Object.entries(biases);
    let attentionPointer = 'general-purpose domains';
    if (biasEntries.length > 0) {
      const topBias = biasEntries.sort((a, b) => b[1] - a[1]).slice(0, 2);
      attentionPointer = topBias.map(([k]) => k).join(', ');
    }

    return `Remember: you are ${identityPhrase}. Current attention: ${attentionPointer}. Maintain personality frame.`;
  }

  /**
   * Returns the PHASE_BUDGETS entry for the given phase.
   *
   * @param {number} budgetPhase - Budget phase (1-4)
   * @returns {Record<string, number>} Slot token budgets
   */
  function getSlotSizes(budgetPhase) {
    return PHASE_BUDGETS[budgetPhase] || PHASE_BUDGETS[1];
  }

  return {
    compose,
    getMicroNudge,
    getSlotSizes,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SLOT_NAMES,
  PHASE_BUDGETS,
  createTemplateComposer,
};
