'use strict';

/**
 * Referential framing prompt templates for three-session architecture.
 *
 * Provides mode-specific authority prompts that activate template slot 5
 * (referential_framing) in the face prompt. These templates instruct Primary
 * on how to treat injected Self Model directives relative to raw context.
 *
 * Three modes per D-10/D-11/D-12:
 *   - full: Total constraint -- defer to Self Model for all decisions
 *   - dual: Relational deference + technical autonomy (default)
 *   - soft: Minimal behavioral suggestion
 *
 * Templates loaded from modules/reverie/prompts/framing-*.md via Linotype.
 *
 * @module reverie/components/context/referential-framing
 */

const fs = require('node:fs');
const path = require('node:path');
const { ok, err } = require('../../../../lib/index.cjs');
const linotype = require('../../../../lib/linotype/linotype.cjs');

// ---------------------------------------------------------------------------
// Template Loading
// ---------------------------------------------------------------------------

const PROMPTS_DIR = path.join(__dirname, '../../prompts');

/**
 * Loads and parses a template file from the prompts directory.
 * @param {string} filename
 * @returns {Object} Linotype Matrix
 */
function _loadTemplate(filename) {
  const content = fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8');
  return linotype.parseString(content, filename);
}

const _matrices = {
  full: _loadTemplate('framing-full.md'),
  dual: _loadTemplate('framing-dual.md'),
  soft: _loadTemplate('framing-soft.md'),
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Framing mode prompt templates.
 * Each template is wrapped in <referential_frame> XML tags for slot 5 injection.
 * All templates must fit within the minimum slot 5 budget of 200 tokens (~800 chars).
 *
 * Resolved from Linotype templates (no string literals in code).
 *
 * @type {Readonly<{ full: string, dual: string, soft: string }>}
 */
const FRAMING_TEMPLATES = Object.freeze({
  full: linotype.cast(_matrices.full, {}).content,
  dual: linotype.cast(_matrices.dual, {}).content,
  soft: linotype.cast(_matrices.soft, {}).content,
});

/** @type {string[]} */
const _VALID_MODES = Object.keys(FRAMING_TEMPLATES);

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Returns the framing prompt template for the given mode.
 *
 * @param {string} mode - Framing mode ('full', 'dual', or 'soft')
 * @returns {import('../../../../lib/result.cjs').Result<string>}
 */
function getFramingPrompt(mode) {
  if (!FRAMING_TEMPLATES[mode]) {
    return err('INVALID_FRAMING_MODE', `Invalid framing mode: ${mode}`, {
      validModes: _VALID_MODES,
    });
  }
  return ok(FRAMING_TEMPLATES[mode]);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a stateful referential framing instance with dynamic mode switching.
 *
 * @param {Object} [options] - Configuration options
 * @param {string} [options.mode='dual'] - Initial framing mode
 * @returns {Readonly<{ getPrompt: Function, getMode: Function, setMode: Function }>}
 * @throws {Error} If initial mode is not a valid framing mode
 */
function createReferentialFraming(options) {
  const opts = options || {};
  const initialMode = opts.mode || 'dual';

  if (!FRAMING_TEMPLATES[initialMode]) {
    throw new Error(`Invalid initial framing mode: ${initialMode}. Valid modes: ${_VALID_MODES.join(', ')}`);
  }

  let _currentMode = initialMode;

  /**
   * Returns the current mode's template string (plain string, not Result).
   * @returns {string}
   */
  function getPrompt() {
    return FRAMING_TEMPLATES[_currentMode];
  }

  /**
   * Returns the current mode string.
   * @returns {string}
   */
  function getMode() {
    return _currentMode;
  }

  /**
   * Validates and sets the active framing mode.
   *
   * @param {string} newMode - The mode to switch to
   * @returns {import('../../../../lib/result.cjs').Result<string>}
   */
  function setMode(newMode) {
    if (!FRAMING_TEMPLATES[newMode]) {
      return err('INVALID_FRAMING_MODE', `Invalid framing mode: ${newMode}`, {
        validModes: _VALID_MODES,
      });
    }
    _currentMode = newMode;
    return ok(newMode);
  }

  return Object.freeze({
    getPrompt,
    getMode,
    setMode,
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  FRAMING_TEMPLATES,
  getFramingPrompt,
  createReferentialFraming,
};
