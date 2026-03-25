'use strict';

/**
 * Triplet ID utilities for multi-triplet Wire isolation.
 *
 * Each triplet gets a unique ID with 4-char hex suffix (D-06).
 * Session IDs use the triplet prefix namespace: triplet-a1b2:primary.
 * Utilities extract triplet ID, identity, and short hash from composite session IDs.
 *
 * @module reverie/components/session/triplet
 */

const crypto = require('node:crypto');

/**
 * Generates a unique triplet ID with 4-char hex suffix.
 * Format: triplet-{4-hex-char} (e.g., triplet-a1b2)
 *
 * @returns {string} Unique triplet ID
 */
function generateTripletId() {
  return 'triplet-' + crypto.randomBytes(2).toString('hex');
}

/**
 * Creates a composite session ID from triplet ID and identity.
 * Format: triplet-xxxx:identity (e.g., triplet-a1b2:primary)
 *
 * @param {string} tripletId - Triplet ID (e.g., triplet-a1b2)
 * @param {string} identity - Session identity (primary|secondary|tertiary)
 * @returns {string} Composite session ID
 */
function makeTripletSessionId(tripletId, identity) {
  return tripletId + ':' + identity;
}

/**
 * Extracts the triplet ID portion from a composite session ID.
 *
 * @param {string} sessionId - Composite session ID (e.g., triplet-a1b2:primary)
 * @returns {string|null} Triplet ID or null if no colon found
 */
function extractTripletId(sessionId) {
  const idx = sessionId.indexOf(':');
  return idx >= 0 ? sessionId.slice(0, idx) : null;
}

/**
 * Extracts the identity portion from a composite session ID.
 *
 * @param {string} sessionId - Composite session ID (e.g., triplet-a1b2:secondary)
 * @returns {string|null} Identity string or null if no colon found
 */
function extractIdentity(sessionId) {
  const idx = sessionId.indexOf(':');
  return idx >= 0 ? sessionId.slice(idx + 1) : null;
}

/**
 * Extracts the short hash suffix from a triplet ID or composite session ID.
 * Works on both 'triplet-a1b2' and 'triplet-a1b2:primary'.
 *
 * @param {string} tripletOrSessionId - Triplet ID or composite session ID
 * @returns {string|null} Short hash (e.g., 'a1b2') or null if no dash found
 */
function extractShortHash(tripletOrSessionId) {
  const tripletPart = tripletOrSessionId.indexOf(':') >= 0
    ? tripletOrSessionId.slice(0, tripletOrSessionId.indexOf(':'))
    : tripletOrSessionId;
  const dashIdx = tripletPart.indexOf('-');
  return dashIdx >= 0 ? tripletPart.slice(dashIdx + 1) : null;
}

module.exports = { generateTripletId, makeTripletSessionId, extractTripletId, extractIdentity, extractShortHash };
