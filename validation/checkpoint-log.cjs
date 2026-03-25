'use strict';

/**
 * Checkpoint log writer for structured validation results.
 *
 * Writes JSON files with pass/fail per success criterion per D-15.
 * Output path: {outputDir}/checkpoint-{timestamp}.json
 *
 * Per D-17: Go-live gate requires all 6 criteria green. The checkpoint
 * log persists evidence for human review.
 *
 * @module reverie/validation/checkpoint-log
 */

const fs = require('node:fs');
const path = require('node:path');
const { ok, err } = require('../../../lib/result.cjs');

/**
 * Schema descriptor for checkpoint log JSON structure.
 * Documents the expected shape for consumers and validators.
 *
 * @type {Readonly<{ timestamp: string, criteria: string, overall: string }>}
 */
const CHECKPOINT_SCHEMA = Object.freeze({
  timestamp: 'string',
  criteria: 'array of { id: string, name: string, passed: boolean, evidence: string, duration_ms: number }',
  overall: 'pass | fail | partial',
});

/**
 * Writes a structured checkpoint log to a JSON file.
 *
 * Computes the overall result from individual criteria:
 * - 'pass': all criteria passed
 * - 'fail': all criteria failed
 * - 'partial': mix of passed and failed criteria
 *
 * @param {Object} results - Validation results
 * @param {Array<{ id: string, name: string, passed: boolean, evidence: string, duration_ms: number }>} results.criteria - Per-criterion results
 * @param {string} outputDir - Directory to write the checkpoint file
 * @returns {import('../../../lib/result.cjs').Result<{ path: string, overall: string }>}
 */
function writeCheckpointLog(results, outputDir) {
  const timestamp = new Date().toISOString();
  const criteria = results.criteria || [];

  const passCount = criteria.filter(function (c) { return c.passed; }).length;
  const failCount = criteria.filter(function (c) { return !c.passed; }).length;

  let overall = 'pass';
  if (failCount > 0 && passCount > 0) {
    overall = 'partial';
  } else if (failCount > 0 && passCount === 0) {
    overall = 'fail';
  }

  const log = { timestamp, criteria, overall };

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const fileName = 'checkpoint-' + timestamp.replace(/[:.]/g, '-') + '.json';
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(log, null, 2));
    return ok({ path: filePath, overall });
  } catch (e) {
    return err('CHECKPOINT_WRITE_FAILED', 'Failed to write checkpoint log: ' + e.message);
  }
}

module.exports = { writeCheckpointLog, CHECKPOINT_SCHEMA };
