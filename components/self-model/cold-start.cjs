'use strict';

/**
 * Cold start seed generator for Self Model initialization.
 *
 * Produces minimal sparse defaults for the three Self Model aspects
 * (Identity Core, Relational Model, Conditioning) on first activation.
 * Optionally applies entropy engine variance to personality trait weights.
 *
 * Implements:
 * - SM-05: Cold start initialization from seed prompt
 * - D-07: Entropy engine integration for mood variance
 *
 * Per spec Section 2.3: Cold start produces valid sparse state that passes
 * schema validation. The entropy engine (if provided) introduces natural
 * variance to baseline personality traits.
 *
 * @module reverie/components/self-model/cold-start
 */

// ---------------------------------------------------------------------------
// Default personality trait weights
// ---------------------------------------------------------------------------

/**
 * Baseline Big Five personality trait weights for cold start.
 * All neutral (0.5) except neuroticism which starts lower (0.3)
 * to reflect a well-adjusted baseline.
 *
 * @type {Record<string, number>}
 */
const DEFAULT_PERSONALITY_TRAITS = Object.freeze({
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.3,
});

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Creates a cold start seed with sparse defaults for all three Self Model aspects.
 *
 * @param {Object} options - Configuration options
 * @param {Object} [options.entropy] - Optional entropy engine instance for trait variance
 * @returns {{ identityCore: Object, relationalModel: Object, conditioning: Object }}
 */
function createColdStartSeed(options) {
  const opts = options || {};
  const now = new Date().toISOString();

  // Apply entropy to personality traits if engine is provided
  let personalityTraits = { ...DEFAULT_PERSONALITY_TRAITS };
  if (opts.entropy && typeof opts.entropy.applyVariance === 'function') {
    personalityTraits = opts.entropy.applyVariance(personalityTraits);
  }

  return {
    identityCore: {
      frontmatter: {
        aspect: 'identity-core',
        version: 'sm-identity-v1',
        updated: now,
        personality_traits: personalityTraits,
        communication_style: {},
        value_orientations: [],
        expertise_map: {},
        boundaries: ['Default Claude safety boundaries active'],
      },
      body: [
        'Identity not yet formed. Observing.',
        '',
        'Personality traits: undifferentiated.',
        'Communication style: adaptive, following user cues.',
        'Value orientations: balanced, no strong leanings yet.',
        'Expertise map: empty -- awaiting demonstrated interaction domains.',
        'Boundaries: default Claude safety boundaries active.',
      ].join('\n'),
    },

    relationalModel: {
      frontmatter: {
        aspect: 'relational-model',
        version: 'sm-relational-v1',
        updated: now,
        communication_patterns: {},
        domain_map: {},
        preference_history: [],
        trust_calibration: { latitude: 0.3 },
        interaction_rhythm: {},
      },
      body: [
        'No user model formed yet.',
        '',
        'Communication patterns: unknown.',
        'Domain interests: unknown.',
        'Preference history: empty.',
        'Trust calibration: conservative -- no latitude earned yet.',
        'Interaction rhythm: no data.',
      ].join('\n'),
    },

    conditioning: {
      frontmatter: {
        aspect: 'conditioning',
        version: 'sm-conditioning-v1',
        updated: now,
        attention_biases: {},
        association_priors: {},
        sublimation_sensitivity: {},
        recall_strategies: [],
        error_history: [],
      },
      body: [
        'Default conditioning. No learned biases.',
        '',
        'Attention biases: uniform across domains.',
        'Association priors: no weighted connections.',
        'Sublimation sensitivity: default thresholds.',
        'Recall strategies: none learned.',
        'Error history: empty.',
      ].join('\n'),
    },
  };
}

/**
 * Generates a cold start seed from a user-provided seed prompt.
 *
 * Creates the standard cold start seed then appends the prompt text
 * to the identity core body as the starting narrative. The prompt
 * does not alter the sparse defaults -- it records the seed context.
 *
 * @param {string} prompt - User-provided seed prompt text
 * @param {Object} options - Configuration options (passed to createColdStartSeed)
 * @returns {{ identityCore: Object, relationalModel: Object, conditioning: Object }}
 */
function generateSeedFromPrompt(prompt, options) {
  const seed = createColdStartSeed(options);

  // Append seed prompt to identity core body
  seed.identityCore.body += `\n\nSeed prompt: ${prompt}`;

  return seed;
}

module.exports = { createColdStartSeed, generateSeedFromPrompt };
