'use strict';

/**
 * Shared constants for the Reverie module.
 *
 * All values are derived from the Reverie specification (reverie-spec-v2.md)
 * and the Phase 7 implementation decisions (07-CONTEXT.md).
 *
 * These constants are referenced across multiple Reverie components
 * and provide a single source of truth for type enumerations,
 * directory layouts, decay parameters, and naming patterns.
 *
 * @module reverie/lib/constants
 */

/**
 * Fragment types per spec Section 3.5.
 *
 * - experiential: Direct interaction experience
 * - meta-recall: Reflection on previous memories
 * - sublimation: Subconscious pattern recognition
 * - consolidation: REM-produced merged fragments
 * - source-reference: External content references
 *
 * @type {ReadonlyArray<string>}
 */
const FRAGMENT_TYPES = Object.freeze([
  'experiential',
  'meta-recall',
  'sublimation',
  'consolidation',
  'source-reference',
]);

/**
 * Fragment lifecycle directories per D-09.
 *
 * - working: Pre-REM fragments (current session)
 * - active: Post-REM consolidated fragments
 * - archive: Decayed below threshold (soft-delete per Pitfall 4)
 *
 * @type {Readonly<{ working: string, active: string, archive: string }>}
 */
const LIFECYCLE_DIRS = Object.freeze({
  working: 'working',
  active: 'active',
  archive: 'archive',
});

/**
 * Self Model aspects per spec Section 2.1.
 *
 * - identity-core: Stable foundation, changes slowly via REM
 * - relational-model: User relationship state
 * - conditioning: Behavioral patterns and environmental adaptation
 *
 * @type {ReadonlyArray<string>}
 */
const SM_ASPECTS = Object.freeze([
  'identity-core',
  'relational-model',
  'conditioning',
]);

/**
 * Decay function default parameters per spec Section 3.9.
 *
 * The decay function determines how fragment weights diminish over time.
 * These defaults can be overridden via configuration.
 *
 * @type {Readonly<{
 *   base_decay_rate: number,
 *   consolidation_protection: number,
 *   access_weight: number,
 *   relevance_weights: Readonly<{ identity: number, relational: number, conditioning: number }>,
 *   archive_threshold: number
 * }>}
 */
const DECAY_DEFAULTS = Object.freeze({
  base_decay_rate: 0.05,
  consolidation_protection: 0.3,
  access_weight: 0.1,
  relevance_weights: Object.freeze({
    identity: 0.3,
    relational: 0.5,
    conditioning: 0.2,
  }),
  archive_threshold: 0.1,
});

/**
 * Composite scoring weight defaults for recall ranking per Phase 9.
 *
 * Six factors weighted to sum to 1.0:
 * - domain_overlap: How many of the fragment's domains match active query domains
 * - entity_cooccurrence: How many of the fragment's entities match active query entities
 * - attention_tag_match: How many attention tags overlap
 * - decay_weight: Pre-computed fragment survival weight (from decay.cjs lifecycle)
 * - self_model_relevance: Weighted average of identity/relational/conditioning scores
 * - temporal_proximity: Exponential decay by days since fragment creation
 *
 * @type {Readonly<{
 *   domain_overlap: number,
 *   entity_cooccurrence: number,
 *   attention_tag_match: number,
 *   decay_weight: number,
 *   self_model_relevance: number,
 *   temporal_proximity: number
 * }>}
 */
const SCORING_DEFAULTS = Object.freeze({
  domain_overlap: 0.25,
  entity_cooccurrence: 0.20,
  attention_tag_match: 0.15,
  decay_weight: 0.15,
  self_model_relevance: 0.15,
  temporal_proximity: 0.10,
});

/**
 * Formation pipeline defaults per Phase 9.
 *
 * - min_prompt_length: Minimum user prompt character count to trigger formation
 * - max_fragments_per_stimulus: Cap on fragments produced per turn
 * - target_fragments_per_session: Expected fragments for a ~50-turn session
 * - formation_group_prefix: Prefix for formation group IDs
 *
 * @type {Readonly<{
 *   min_prompt_length: number,
 *   max_fragments_per_stimulus: number,
 *   target_fragments_per_session: number,
 *   formation_group_prefix: string
 * }>}
 */
const FORMATION_DEFAULTS = Object.freeze({
  min_prompt_length: 20,
  max_fragments_per_stimulus: 3,
  target_fragments_per_session: 15,
  formation_group_prefix: 'fg-',
});

/**
 * Nudge file coordination defaults per Phase 9.
 *
 * Nudges are the filesystem-based coordination bus between the formation
 * subagent and the Context Manager (per Pattern 2: Filesystem as Coordination Bus).
 *
 * - nudge_dir: Relative path from data root to nudge directory
 * - latest_nudge_filename: Well-known filename for the most recent nudge
 * - max_nudge_age_ms: Staleness threshold -- nudges older than this are ignored
 * - max_nudge_tokens: Token budget cap for passive nudge injection
 *
 * @type {Readonly<{
 *   nudge_dir: string,
 *   latest_nudge_filename: string,
 *   max_nudge_age_ms: number,
 *   max_nudge_tokens: number
 * }>}
 */
const NUDGE_DEFAULTS = Object.freeze({
  nudge_dir: 'data/formation/nudges',
  latest_nudge_filename: 'latest-nudge.md',
  max_nudge_age_ms: 60000,
  max_nudge_tokens: 200,
});

/**
 * Default data directory path per D-03.
 * Outside the repo -- keeps data separate from code, survives module updates.
 *
 * @type {string}
 */
const DATA_DIR_DEFAULT = '~/.dynamo/reverie';

/**
 * Fragment ID naming pattern per D-10.
 * Format: frag-YYYY-MM-DD-{8 hex chars}
 *
 * @type {RegExp}
 */
const FRAGMENT_ID_PATTERN = /^frag-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/;

/**
 * REM consolidation default parameters per Phase 11.
 *
 * - heartbeat_timeout_ms: Time before Secondary detects dead Primary (Tier 2 trigger)
 * - tier2_check_interval_ms: Polling interval for Tier 2 heartbeat checks
 * - rem_time_budget_ms: Maximum time budget for a full REM cycle
 * - max_consolidated_per_session: Cap on fragments promoted per session
 * - meta_recall_min_significance: Minimum significance for recall meta-fragment creation
 * - sublimation_triage_cap: Maximum sublimation fragments promoted per session
 *
 * @type {Readonly<{
 *   heartbeat_timeout_ms: number,
 *   tier2_check_interval_ms: number,
 *   rem_time_budget_ms: number,
 *   max_consolidated_per_session: number,
 *   meta_recall_min_significance: number,
 *   sublimation_triage_cap: number
 * }>}
 */
const REM_DEFAULTS = Object.freeze({
  heartbeat_timeout_ms: 90000,
  tier2_check_interval_ms: 5000,
  rem_time_budget_ms: 120000,
  max_consolidated_per_session: 20,
  meta_recall_min_significance: 0.6,
  sublimation_triage_cap: 5,
});

/**
 * Conditioning update default parameters per Phase 11 (SM-04).
 *
 * - ema_alpha: Exponential moving average alpha for conditioning field updates (D-10)
 * - identity_floor: Minimum value for identity core trait dimensions (D-11)
 * - identity_min_sessions: Sessions required before identity core can shift
 * - diversity_threshold: Minimum diversity score for entropy distribution adjustment
 * - max_error_history: Maximum error history entries retained in conditioning
 *
 * @type {Readonly<{
 *   ema_alpha: number,
 *   identity_floor: number,
 *   identity_min_sessions: number,
 *   diversity_threshold: number,
 *   max_error_history: number
 * }>}
 */
const CONDITIONING_DEFAULTS = Object.freeze({
  ema_alpha: 0.15,
  identity_floor: 0.1,
  identity_min_sessions: 5,
  diversity_threshold: 0.05,
  max_error_history: 50,
});

/**
 * Taxonomy governance default parameters per Phase 12 (FRG-07).
 *
 * Controls self-organizing taxonomy caps, pressure thresholds, and lifecycle rules:
 * - max_domains: Hard cap on total domain count (D-06)
 * - max_entities_per_domain: Hard cap on entities within a single domain (D-06)
 * - max_association_edges: Hard cap on total association graph edges (D-06)
 * - pressure_threshold: Fraction (0-1) at which REM prioritizes merge/retire (D-06)
 * - split_fragment_threshold: Fragment count triggering domain split evaluation (D-07)
 * - retire_inactive_cycles: Consecutive REM cycles with no active fragments before domain retirement (D-08)
 *
 * @type {Readonly<{
 *   max_domains: number,
 *   max_entities_per_domain: number,
 *   max_association_edges: number,
 *   pressure_threshold: number,
 *   split_fragment_threshold: number,
 *   retire_inactive_cycles: number
 * }>}
 */
const TAXONOMY_DEFAULTS = Object.freeze({
  max_domains: 100,
  max_entities_per_domain: 200,
  max_association_edges: 10000,
  pressure_threshold: 0.8,
  split_fragment_threshold: 50,
  retire_inactive_cycles: 3,
});

/**
 * Historical data backfill default parameters per Phase 12 (FRG-10).
 *
 * Controls batch processing and safety caps for conversation import:
 * - default_batch_size: Conversations processed per batch
 * - max_fragments_per_conversation: Safety cap per Pitfall 5
 * - origin_marker: String used in fragment origin field for provenance tracking (D-14)
 *
 * @type {Readonly<{
 *   default_batch_size: number,
 *   max_fragments_per_conversation: number,
 *   origin_marker: string
 * }>}
 */
const BACKFILL_DEFAULTS = Object.freeze({
  default_batch_size: 10,
  max_fragments_per_conversation: 50,
  origin_marker: 'backfill',
});

module.exports = {
  FRAGMENT_TYPES,
  LIFECYCLE_DIRS,
  SM_ASPECTS,
  DECAY_DEFAULTS,
  SCORING_DEFAULTS,
  FORMATION_DEFAULTS,
  NUDGE_DEFAULTS,
  DATA_DIR_DEFAULT,
  FRAGMENT_ID_PATTERN,
  REM_DEFAULTS,
  CONDITIONING_DEFAULTS,
  TAXONOMY_DEFAULTS,
  BACKFILL_DEFAULTS,
};
