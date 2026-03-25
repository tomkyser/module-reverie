'use strict';

/**
 * Visual session markers for multi-triplet distinction.
 *
 * Provides terminal title escape sequences (D-10) and color-coded output
 * prefixes (D-10/D-11/D-12) for Face, Mind, and Subconscious session roles.
 * Colors use ANSI 256-color codes that work on both dark and light terminal
 * backgrounds.
 *
 * @module reverie/components/session/visual-markers
 */

/**
 * ANSI 256-color codes for each session role.
 * Selected for readability on both dark and light terminal backgrounds (D-11).
 *
 * @type {Readonly<{ Face: string, Mind: string, Subconscious: string }>}
 */
const ROLE_COLORS = Object.freeze({
  Face: '\x1b[38;5;39m',         // Bright blue -- user-facing, trustworthy
  Mind: '\x1b[38;5;214m',        // Amber/orange -- cognitive, warm
  Subconscious: '\x1b[38;5;141m', // Soft purple -- subliminal, ethereal
});

/** ANSI reset sequence */
const RESET = '\x1b[0m';

/**
 * Maps session identity strings to human-readable role labels.
 *
 * @type {Readonly<{ primary: string, secondary: string, tertiary: string }>}
 */
const ROLE_LABELS = Object.freeze({
  primary: 'Face',
  secondary: 'Mind',
  tertiary: 'Subconscious',
});

/**
 * Sets the terminal title using an OSC escape sequence.
 * Format: Dynamo {roleLabel} {shortHash}
 *
 * @param {string} roleLabel - Role display name (Face|Mind|Subconscious)
 * @param {string} shortHash - 4-char hex hash from triplet ID
 */
function setTerminalTitle(roleLabel, shortHash) {
  const title = 'Dynamo ' + roleLabel + ' ' + shortHash;
  process.stdout.write('\x1b]0;' + title + '\x07');
}

/**
 * Formats a color-coded output prefix for session identification.
 * Format: [roleLabel shortHash] with ANSI color wrapping.
 *
 * @param {string} roleLabel - Role display name (Face|Mind|Subconscious)
 * @param {string} shortHash - 4-char hex hash from triplet ID
 * @returns {string} Color-coded prefix string
 */
function formatPrefix(roleLabel, shortHash) {
  const color = ROLE_COLORS[roleLabel] || '';
  return color + '[' + roleLabel + ' ' + shortHash + ']' + RESET;
}

module.exports = { ROLE_COLORS, ROLE_LABELS, RESET, setTerminalTitle, formatPrefix };
