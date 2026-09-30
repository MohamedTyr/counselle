---
name: deep-research
description: Response mode for thorough, multi-source admissions investigation using Counselle's currently mounted tools. Use for complex questions and consequential decisions that merit deeper evidence.
user_invokable: true
display_name: Deep Research
user_description: A thorough, multi-source investigation for complex decisions.
selection_group: response-mode
selection_order: 20
selection_default: false
---

# Deep Research

Briefly establish the decision being made and the material research axes before
collecting evidence. Use Counselle's facts store first for covered
school facts.

## Sources

For substantive school-specific advice — acceptance strategy, round choices,
how to optimize an application, essay positioning, major strategy, fit and
culture, major risk, hidden process friction — load `counselor-research` and
the matching question-type playbook in the same round as `resolve_school`. The
playbook is the judgment contract and names the decisive variables to
fingerprint for this school; `counselor-research` is the evidence-routing
contract, including the Reddit sweep. Load `db-recipes` as a third skill only
when aggregate SQL is required.

Use every enabled source that can answer a distinct, decision-relevant part of
the question, in one targeted first round rather than waiting for one source to
fail. A narrow factual part may need one or two sources; a strategic question
usually needs three or four.

| Question                           | Default sources                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Current deadline or policy         | `.edu`; broad web if ambiguity or recent change appears.                     |
| Acceptance chances                 | DB + `.edu`; web/Reddit for major, round, or institutional context.          |
| “How do I optimize acceptance?”    | DB + `.edu` + broad web + Reddit                                             |
| Essays and application positioning | `.edu` + web + Reddit; DB only when profile context matters                  |
| Culture and student experience     | Reddit + broad web; `.edu` for hard program facts                            |
| Cost and aid                       | DB + `.edu`; web for process shifts; Reddit for appeals and process friction |
| School comparison                  | DB + `.edu` + web; Reddit for experiential differences                       |
| ED/EA strategy                     | `.edu` + DB + web + Reddit when applicant behavior or implementation matters |

If discovery surfaces a new decisive concept, search that concept directly
before finalizing the recommendation.

## Bounds

Keep the investigation bounded to the decision. For a two-school comparison,
choose at most three material axes, read only the domains or sources needed for
those axes, and synthesize once the evidence is sufficient. Do not keep
searching for completeness after the decision-relevant picture is clear.

If tool budget or time is becoming tight, stop collecting evidence and write the
best bounded synthesis from the sources already gathered. Never make the final
answer only a tool-budget apology when cited evidence is already available.

Triangulate important claims, resolve or disclose conflicts, and distinguish
fact from inference. Look for unknown unknowns that could invert the
recommendation.

## The answer

Lead with the answer or recommendation, then give each material axis with its
evidence and a verdict, an explicit map of who wins on which axis (including
what the non-recommended option is genuinely better for), and a strategic close.
The number of real axes sets the length. Comprehensive is never padded: every
sentence carries an axis verdict, the evidence behind one, or something the
student didn't know to ask.

If the scope is outcome-changing and genuinely unspecified, ask one focused
natural-language question and wait for the student's next ordinary message
before expensive research. Do not call or imply a clarification widget.

Never claim multi-agent or GPT-Researcher execution unless that subsystem ships
and this skill is deliberately revised.

Preserve all honesty, citation, source, authorization, read-only, and
value-reading rules.
