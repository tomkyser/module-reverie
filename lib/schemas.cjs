'use strict';

/**
 * Zod validation schemas for Reverie fragment types and Self Model aspects.
 *
 * Per D-15: Zod is the module-level validation tool for fragment and Self Model
 * schemas. Platform-level validation (manifests, config) remains in lib/schema.cjs.
 *
 * Fragment schemas enforce the data contracts defined in reverie-spec-v2.md
 * Section 3.3 (Fragment Schema), Section 3.5 (Fragment Types), and
 * Section 2.2 (Self Model fields).
 *
 * @module reverie/lib/schemas
 */

const { z } = require('zod');
const { FRAGMENT_TYPES, FRAGMENT_ID_PATTERN } = require('./constants.cjs');

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * Temporal positioning within a session.
 * absolute: ISO timestamp
 * session_relative: 0.0 (session start) to 1.0 (session end)
 * sequence: monotonic ordering within a formation group
 */
const temporalSchema = z.object({
  absolute: z.string(),
  session_relative: z.number().min(0).max(1),
  sequence: z.number().int().nonnegative(),
});

/**
 * Decay state for fragment survival calculation.
 * Weights are 0.0-1.0 range. Counts are non-negative integers.
 */
const decaySchema = z.object({
  initial_weight: z.number().min(0).max(1),
  current_weight: z.number().min(0).max(1),
  last_accessed: z.string(),
  access_count: z.number().int().nonnegative(),
  consolidation_count: z.number().int().nonnegative(),
  pinned: z.boolean(),
});

/**
 * Self Model relevance scores per aspect.
 * Each value is 0.0 (irrelevant) to 1.0 (highly relevant).
 */
const selfModelRelevanceSchema = z.object({
  identity: z.number().min(0).max(1),
  relational: z.number().min(0).max(1),
  conditioning: z.number().min(0).max(1),
});

/**
 * Association metadata: domains, entities, relevance, valence, tags.
 * emotional_valence: -1.0 (negative) to 1.0 (positive).
 */
const associationsSchema = z.object({
  domains: z.array(z.string()),
  entities: z.array(z.string()),
  self_model_relevance: selfModelRelevanceSchema,
  emotional_valence: z.number().min(-1).max(1),
  attention_tags: z.array(z.string()),
});

/**
 * Source locator for source-reference fragments.
 * Nullable fields: path, url, content_hash (depends on locator type).
 */
const sourceLocatorSchema = z.object({
  type: z.enum(['file', 'url', 'inline']),
  path: z.string().nullable(),
  url: z.string().nullable(),
  content_hash: z.string().nullable(),
  last_verified: z.string(),
});

/**
 * Fragment graph pointers (causal, thematic, contradictions, etc.).
 * All arrays of fragment IDs.
 */
const pointersSchema = z.object({
  causal_antecedents: z.array(z.string()),
  causal_consequents: z.array(z.string()),
  thematic_siblings: z.array(z.string()),
  contradictions: z.array(z.string()),
  meta_recalls: z.array(z.string()),
  source_fragments: z.array(z.string()),
});

/**
 * Formation context: what triggered this fragment and the attention state.
 */
const formationSchema = z.object({
  trigger: z.string(),
  attention_pointer: z.string(),
  active_domains_at_formation: z.array(z.string()),
  sublimation_that_prompted: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Base Fragment Schema
// ---------------------------------------------------------------------------

/**
 * Base schema for all fragment types per spec Section 3.3.
 * All fragments share these fields. Type-specific schemas extend this.
 *
 * id: validated against FRAGMENT_ID_PATTERN (frag-YYYY-MM-DD-hex8)
 * type: must be one of FRAGMENT_TYPES
 * source_locator: optional (only required for source-reference type)
 */
const baseFragmentSchema = z.object({
  id: z.string().regex(FRAGMENT_ID_PATTERN),
  type: z.enum(FRAGMENT_TYPES),
  created: z.string(),
  source_session: z.string(),
  self_model_version: z.string(),
  formation_group: z.string(),
  formation_frame: z.string(),
  sibling_fragments: z.array(z.string()),
  temporal: temporalSchema,
  decay: decaySchema,
  associations: associationsSchema,
  pointers: pointersSchema,
  formation: formationSchema,
  origin: z.string().optional(),
  source_locator: sourceLocatorSchema.optional(),
});

// ---------------------------------------------------------------------------
// Type-Specific Fragment Schemas
// ---------------------------------------------------------------------------

/** Experiential fragment — direct interaction experience. */
const experientialFragment = baseFragmentSchema.extend({
  type: z.literal('experiential'),
});

/**
 * Meta-recall fragment — reflection on previous memories.
 * Must reference at least one source fragment in pointers.source_fragments.
 */
const metaRecallFragment = baseFragmentSchema.extend({
  type: z.literal('meta-recall'),
}).refine(f => f.pointers.source_fragments.length > 0, {
  message: 'Meta-recall fragments must reference source fragments',
});

/** Sublimation fragment — subconscious pattern recognition. */
const sublimationFragment = baseFragmentSchema.extend({
  type: z.literal('sublimation'),
});

/** Consolidation fragment — REM-produced merged fragments. */
const consolidationFragment = baseFragmentSchema.extend({
  type: z.literal('consolidation'),
});

/**
 * Source-reference fragment — external content references.
 * Must have a source_locator (not null/undefined).
 */
const sourceReferenceFragment = baseFragmentSchema.extend({
  type: z.literal('source-reference'),
}).refine(f => f.source_locator != null, {
  message: 'Source-reference fragments must have a source_locator',
});

// ---------------------------------------------------------------------------
// validateFragment() dispatcher
// ---------------------------------------------------------------------------

/**
 * Schema dispatch map: type string -> type-specific schema.
 * @type {Record<string, import('zod').ZodType>}
 */
const SCHEMA_MAP = {
  'experiential': experientialFragment,
  'meta-recall': metaRecallFragment,
  'sublimation': sublimationFragment,
  'consolidation': consolidationFragment,
  'source-reference': sourceReferenceFragment,
};

/**
 * Validates a fragment frontmatter object against the correct type-specific schema.
 *
 * Dispatches based on the `type` field. Returns a Result-compatible object:
 * - { ok: true, value } on success
 * - { ok: false, error } on failure
 *
 * @param {Object} frontmatter - Fragment frontmatter to validate
 * @returns {{ ok: true, value: Object } | { ok: false, error: Object }}
 */
function validateFragment(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'Frontmatter must be an object' } };
  }

  const schema = SCHEMA_MAP[frontmatter.type];
  if (!schema) {
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_TYPE',
        message: `Unknown fragment type: ${frontmatter.type}`,
        context: { validTypes: FRAGMENT_TYPES },
      },
    };
  }

  const result = schema.safeParse(frontmatter);
  if (result.success) {
    return { ok: true, value: result.data };
  }

  return {
    ok: false,
    error: {
      code: 'VALIDATION_FAILED',
      message: result.error.issues
        ? result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        : String(result.error),
      context: { issues: result.error.issues || [] },
    },
  };
}

// ---------------------------------------------------------------------------
// Self Model Schemas (spec Section 2.2)
// ---------------------------------------------------------------------------

/**
 * Identity Core aspect: stable personality foundation.
 * version: sm-identity-vN format.
 */
const identityCoreSchema = z.object({
  aspect: z.literal('identity-core'),
  version: z.string().regex(/^sm-identity-v\d+$/),
  updated: z.string(),
  personality_traits: z.record(z.string(), z.number()).optional(),
  communication_style: z.record(z.string(), z.any()).optional(),
  value_orientations: z.array(z.object({ name: z.string(), weight: z.number() })).optional(),
  expertise_map: z.record(z.string(), z.number()).optional(),
  boundaries: z.array(z.string()).optional(),
});

/**
 * Relational Model aspect: user relationship state.
 * version: sm-relational-vN format.
 */
const relationalModelSchema = z.object({
  aspect: z.literal('relational-model'),
  version: z.string().regex(/^sm-relational-v\d+$/),
  updated: z.string(),
  communication_patterns: z.record(z.string(), z.any()).optional(),
  domain_map: z.record(z.string(), z.number()).optional(),
  preference_history: z.array(z.any()).optional(),
  trust_calibration: z.record(z.string(), z.number()).optional(),
  interaction_rhythm: z.record(z.string(), z.any()).optional(),
});

/**
 * Conditioning aspect: behavioral patterns and environmental adaptation.
 * version: sm-conditioning-vN format.
 */
const conditioningSchema = z.object({
  aspect: z.literal('conditioning'),
  version: z.string().regex(/^sm-conditioning-v\d+$/),
  updated: z.string(),
  attention_biases: z.record(z.string(), z.number()).optional(),
  association_priors: z.record(z.string(), z.number()).optional(),
  sublimation_sensitivity: z.record(z.string(), z.number()).optional(),
  recall_strategies: z.array(z.any()).optional(),
  error_history: z.array(z.any()).optional(),
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Sub-schemas
  temporalSchema,
  decaySchema,
  selfModelRelevanceSchema,
  associationsSchema,
  sourceLocatorSchema,
  pointersSchema,
  formationSchema,

  // Base and type-specific fragment schemas
  baseFragmentSchema,
  experientialFragment,
  metaRecallFragment,
  sublimationFragment,
  consolidationFragment,
  sourceReferenceFragment,

  // Dispatcher
  validateFragment,

  // Self Model schemas
  identityCoreSchema,
  relationalModelSchema,
  conditioningSchema,
};
