'use strict';

/**
 * Reverie session management hub skill.
 *
 * Conversational wrapper over existing Pulley CLI commands (per D-03).
 * Shows current operational mode, session topology, and offers
 * contextual session management actions.
 *
 * Per D-02: /reverie is a session management hub -- shows current mode,
 * session topology, and offers actions: start session, view status,
 * inspect memory, stop. Interactive entry point for everything Reverie.
 *
 * Per D-05: Registered via exciter.registerSkill() during Reverie module
 * registration.
 *
 * @module reverie/skills/reverie-skill
 */

/**
 * Markdown content body for the /reverie skill.
 *
 * Instructs Claude to run existing Pulley CLI commands and present
 * results with personality -- this is the friendly human interface.
 *
 * @type {string}
 */
const REVERIE_SKILL_CONTENT = `# Reverie Session Management

Show the user Reverie's current state and offer session management actions.

## Steps

1. Run \`bun bin/dynamo.cjs reverie status\` to get Reverie operational state
2. Present to the user:
   - Current operational mode (Active/Passive/REM/Dormant)
   - Session topology: which sessions are running (Primary/Secondary/Tertiary)
   - Triplet ID if active (e.g., "Triplet a1b2")
   - Self Model personality summary (brief identity)
   - Recent fragment count and recall stats
3. Offer contextual actions based on current state:
   - If Dormant: "Would you like to start a Reverie session?"
   - If Active: "You have an active triplet. Want to inspect memory, view status details, or stop the session?"
   - If Passive: "Running in Passive mode (Primary + Secondary only). Want to upgrade to Active mode?"
4. If user wants to start: run \`bun bin/dynamo.cjs reverie start\`
5. If user wants to inspect: run \`bun bin/dynamo.cjs reverie inspect <target>\` with appropriate target
6. If user wants to stop: run \`bun bin/dynamo.cjs reverie stop\`

Present results conversationally. This is the friendly human interface -- show personality, not just data.`;

/**
 * Registers the /reverie skill with the Exciter integration surface.
 *
 * @param {Object} exciter - Exciter service instance with registerSkill()
 * @returns {import('../../../lib/result.cjs').Result<{name: string, path: string}>}
 */
function registerReverieSkill(exciter) {
  return exciter.registerSkill('reverie', {
    description: 'Reverie session management hub. Shows current mode, session topology, offers start/stop/inspect actions. Use when interacting with Reverie memory system.',
    content: REVERIE_SKILL_CONTENT,
  });
}

module.exports = { registerReverieSkill, REVERIE_SKILL_CONTENT };
