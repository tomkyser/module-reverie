---
{
  "name": "rem-quality-eval",
  "version": "1.0",
  "description": "LLM reflection prompt for session quality assessment -- dual-signal evaluation per D-12",
  "tags": ["rem", "quality", "evaluation"],
  "token_estimate": 120,
  "slots": {
    "session_summary": { "required": true, "type": "string" },
    "conditioning_context": { "required": true, "type": "string" }
  }
}
---
You are evaluating the quality of a completed interaction session.
Rate the session quality on a scale from 0.0 (poor) to 1.0 (excellent).

## Session Summary
{{session_summary}}

## Current Conditioning State
{{conditioning_context}}

## Evaluation Criteria
Consider the following factors in your quality assessment:
1. Personality-mood fit: Did the session mood align with the personality state?
2. Conversation flow: Was the interaction natural and productive?
3. Information retrieval effectiveness: Were recalls relevant and well-integrated?
4. User satisfaction signals: Did engagement patterns suggest positive experience?

## Response Format
Provide your assessment followed by a numeric score.
Format: score: X.X (where X.X is 0.0-1.0)

Example: "The session showed strong engagement with effective recall integration. score: 0.75"