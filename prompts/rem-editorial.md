---
{
  "name": "rem-editorial",
  "version": "1.0",
  "description": "Editorial pass prompt for LLM review of the association index -- 4 core tasks plus optional governance sections",
  "tags": ["rem", "editorial", "association-index"],
  "token_estimate": 300,
  "slots": {
    "entity_section": { "required": true, "type": "string" },
    "domain_section": { "required": true, "type": "string" },
    "assoc_section": { "required": true, "type": "string" },
    "has_split_candidates": { "required": false, "type": "string", "default": "" },
    "split_section": { "required": false, "type": "string", "default": "" },
    "has_retire_candidates": { "required": false, "type": "string", "default": "" },
    "retire_section": { "required": false, "type": "string", "default": "" },
    "has_cap_pressure": { "required": false, "type": "string", "default": "" },
    "cap_pressure_text": { "required": false, "type": "string", "default": "" },
    "has_governance": { "required": false, "type": "string", "default": "" }
  }
}
---
You are reviewing the association index for data quality. Four tasks:

## 1. ENTITY DEDUP
Review these entities for near-duplicates. Merge entities that refer to the same concept.
Entities:
{{entity_section}}

## 2. DOMAIN BOUNDARY REVIEW
Review these domain pairs that have high entity overlap. Suggest merge, keep separate, or flag.
Domain pairs:
{{domain_section}}

## 3. ASSOCIATION WEIGHT UPDATE
Review these association usage stats. Strengthen frequently used, weaken unused.
Stats:
{{assoc_section}}

## 4. TAXONOMY NARRATIVE UPDATES
For any domains you decide to merge, write a brief merge_narrative note (2-3 sentences) describing:
the merge rationale, the scope of the surviving domain after merge, and any semantic nuance lost or preserved.
These narratives will be stored as consolidation fragments in Journal for provenance tracking.

{{#if has_split_candidates}}
## 5. DOMAIN SPLIT REVIEW
These domains have high fragment density. Identify distinct sub-clusters within each.
If sub-clusters exist, propose child domain names and which fragments belong to each.
Domains:
{{split_section}}
{{/if}}
{{#if has_retire_candidates}}
## 6. DOMAIN RETIREMENT REVIEW
These domains have had no active (non-decayed) fragments for multiple REM cycles.
Confirm retirement (archived=true, stops appearing in formation and recall).
Domains:
{{retire_section}}
{{/if}}
{{#if has_cap_pressure}}
## 7. CAP PRESSURE
{{cap_pressure_text}}
{{/if}}
## Response Format
Respond in JSON:
{
  "entity_merges": [{ "keep": "entity_name", "merge": ["duplicate1", "duplicate2"] }],
  "domain_decisions": [{ "domain_a": "...", "domain_b": "...", "action": "merge"|"keep"|"flag", "reason": "...", "merge_narrative": "..." }],
{{#if has_governance}}
  "weight_updates": [{ "association_id": "...", "new_weight": 0.0-1.0 }],
  "domain_splits": [{ "parent_domain": "...", "children": [{ "name": "...", "description": "...", "fragment_ids": [...] }], "split_narrative": "..." }],
  "domain_retirements": [{ "domain_id": "...", "domain_name": "...", "retire_narrative": "..." }]
{{else}}
  "weight_updates": [{ "association_id": "...", "new_weight": 0.0-1.0 }]
{{/if}}
}