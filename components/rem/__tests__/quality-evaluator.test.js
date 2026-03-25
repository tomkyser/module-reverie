'use strict';

const { describe, it, expect } = require('bun:test');
const { createQualityEvaluator } = require('../quality-evaluator.cjs');

// ---------------------------------------------------------------------------
// computeBehavioralScore
// ---------------------------------------------------------------------------

describe('computeBehavioralScore', () => {
  it('returns 0.0-1.0 based on engagement metrics', () => {
    const evaluator = createQualityEvaluator();
    const score = evaluator.computeBehavioralScore({
      turn_count: 30,
      avg_turn_length: 200,
      session_duration_ms: 1800000,
      recall_events: 5,
      recall_incorporated: 5,
      directive_compliance_rate: 1.0,
      friction_signals: 0,
    });
    expect(score).toBeGreaterThanOrEqual(0.0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('weighs turn count, avg turn length, session duration, recall usage, directive compliance', () => {
    const evaluator = createQualityEvaluator();
    // High engagement session
    const high = evaluator.computeBehavioralScore({
      turn_count: 40,
      avg_turn_length: 300,
      session_duration_ms: 3600000,
      recall_events: 10,
      recall_incorporated: 9,
      directive_compliance_rate: 0.95,
      friction_signals: 0,
    });
    // Low engagement session
    const low = evaluator.computeBehavioralScore({
      turn_count: 2,
      avg_turn_length: 10,
      session_duration_ms: 60000,
      recall_events: 0,
      recall_incorporated: 0,
      directive_compliance_rate: 0.0,
      friction_signals: 5,
    });
    expect(high).toBeGreaterThan(low);
  });

  it('returns 0.5 for minimal/default session data', () => {
    const evaluator = createQualityEvaluator();
    const score = evaluator.computeBehavioralScore({
      turn_count: 15,
      avg_turn_length: 100,
      session_duration_ms: 900000,
      recall_events: 1,
      recall_incorporated: 1,
      directive_compliance_rate: 0.5,
      friction_signals: 2,
    });
    // Should be roughly in the middle range
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.8);
  });

  it('returns higher for longer sessions with more engagement', () => {
    const evaluator = createQualityEvaluator();
    const short = evaluator.computeBehavioralScore({
      turn_count: 5,
      avg_turn_length: 50,
      session_duration_ms: 120000,
      recall_events: 1,
      recall_incorporated: 0,
      directive_compliance_rate: 0.5,
      friction_signals: 1,
    });
    const long = evaluator.computeBehavioralScore({
      turn_count: 50,
      avg_turn_length: 250,
      session_duration_ms: 2400000,
      recall_events: 8,
      recall_incorporated: 7,
      directive_compliance_rate: 0.9,
      friction_signals: 0,
    });
    expect(long).toBeGreaterThan(short);
  });
});

// ---------------------------------------------------------------------------
// composeLlmReflectionPrompt
// ---------------------------------------------------------------------------

describe('composeLlmReflectionPrompt', () => {
  it('creates a structured prompt with session summary', () => {
    const evaluator = createQualityEvaluator();
    const prompt = evaluator.composeLlmReflectionPrompt(
      'User discussed coding patterns for 30 minutes.',
      { attention_biases: { coding: 0.8 } }
    );
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain('coding patterns');
    // Should ask about quality assessment
    expect(prompt.toLowerCase()).toContain('quality');
  });
});

// ---------------------------------------------------------------------------
// parseLlmScore
// ---------------------------------------------------------------------------

describe('parseLlmScore', () => {
  it('extracts numeric score from "score: 0.7" format', () => {
    const evaluator = createQualityEvaluator();
    expect(evaluator.parseLlmScore('Session quality score: 0.7')).toBeCloseTo(0.7, 2);
  });

  it('extracts numeric score from "0.8/1.0" format', () => {
    const evaluator = createQualityEvaluator();
    expect(evaluator.parseLlmScore('Rating: 0.8/1.0')).toBeCloseTo(0.8, 2);
  });

  it('extracts a plain decimal', () => {
    const evaluator = createQualityEvaluator();
    expect(evaluator.parseLlmScore('Overall I would rate this session 0.65 out of 1.0')).toBeCloseTo(0.65, 2);
  });

  it('returns null for unparseable response', () => {
    const evaluator = createQualityEvaluator();
    expect(evaluator.parseLlmScore('This was a great session!')).toBeNull();
  });

  it('clamps extracted values to 0.0-1.0 range', () => {
    const evaluator = createQualityEvaluator();
    expect(evaluator.parseLlmScore('score: 1.5')).toBeLessThanOrEqual(1.0);
    expect(evaluator.parseLlmScore('score: -0.3')).toBeGreaterThanOrEqual(0.0);
  });
});

// ---------------------------------------------------------------------------
// evaluateSession
// ---------------------------------------------------------------------------

describe('evaluateSession', () => {
  const defaultMetrics = {
    turn_count: 20,
    avg_turn_length: 150,
    session_duration_ms: 1200000,
    recall_events: 4,
    recall_incorporated: 3,
    directive_compliance_rate: 0.8,
    friction_signals: 1,
  };

  it('combines behavioral (weight 0.4) and LLM reflection (weight 0.6) scores', () => {
    const evaluator = createQualityEvaluator();
    const result = evaluator.evaluateSession(defaultMetrics, 0.9);
    // behavioral ~= some value, llm = 0.9
    // composite = behavioral * 0.4 + 0.9 * 0.6 = behavioral * 0.4 + 0.54
    expect(result.quality_score).toBeGreaterThan(0);
    expect(result.quality_score).toBeLessThanOrEqual(1);
    expect(result.behavioral_score).toBeGreaterThan(0);
    expect(result.llm_score).toBe(0.9);
  });

  it('with null LLM score falls back to behavioral-only (weight 1.0)', () => {
    const evaluator = createQualityEvaluator();
    const result = evaluator.evaluateSession(defaultMetrics, null);
    expect(result.quality_score).toBe(result.behavioral_score);
    expect(result.llm_score).toBeNull();
  });

  it('calls entropyEngine.evolve with the final quality score', () => {
    let evolvedWith = null;
    const mockEntropy = {
      evolve: (outcome) => { evolvedWith = outcome; },
    };
    const evaluator = createQualityEvaluator({ entropyEngine: mockEntropy });
    evaluator.evaluateSession(defaultMetrics, 0.7);
    expect(evolvedWith).toBeTruthy();
    expect(typeof evolvedWith.quality).toBe('number');
  });

  it('returns { quality_score, behavioral_score, llm_score, entropy_evolved }', () => {
    const mockEntropy = { evolve: () => {} };
    const evaluator = createQualityEvaluator({ entropyEngine: mockEntropy });
    const result = evaluator.evaluateSession(defaultMetrics, 0.8);
    expect(typeof result.quality_score).toBe('number');
    expect(typeof result.behavioral_score).toBe('number');
    expect(result.llm_score).toBe(0.8);
    expect(result.entropy_evolved).toBe(true);
  });

  it('sets entropy_evolved to false when no entropyEngine provided', () => {
    const evaluator = createQualityEvaluator();
    const result = evaluator.evaluateSession(defaultMetrics, 0.7);
    expect(result.entropy_evolved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createQualityEvaluator
// ---------------------------------------------------------------------------

describe('createQualityEvaluator', () => {
  it('returns frozen object', () => {
    const evaluator = createQualityEvaluator();
    expect(Object.isFrozen(evaluator)).toBe(true);
  });

  it('exposes expected API surface', () => {
    const evaluator = createQualityEvaluator();
    expect(typeof evaluator.evaluateSession).toBe('function');
    expect(typeof evaluator.computeBehavioralScore).toBe('function');
    expect(typeof evaluator.composeLlmReflectionPrompt).toBe('function');
    expect(typeof evaluator.parseLlmScore).toBe('function');
  });
});
