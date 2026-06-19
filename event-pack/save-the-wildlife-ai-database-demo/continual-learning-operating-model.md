# Continual Learning Operating Model

Use this when AI engineers ask how the demo moves beyond one-off prompting.
The answer is not "let the model remember everything." Production continual
learning separates what the model sees now, what the system has organized, what
belongs in weights, and what becomes a reusable skill.

## The Four Learning Surfaces

| Surface | Meaning | Demo evidence | Production rule |
|---|---|---|---|
| **Token space** | What the model is currently reading or writing: prompt, context card, evidence excerpt, draft, final line. | `STWL_MODEL_TRACES.prompt_text`, `STWL_MODEL_TRACES.evidence_json`, `STWL_MODEL_OUTPUTS.output_text`, `STWL_MODEL_OUTPUTS.tokens` | Keep it bounded, inspectable, and traceable. Do not treat the prompt as durable memory. |
| **Structured space** | What the system has explicitly organized and can operate on: SQL facts, JSON event docs, graph edges, memory cards, traces, evals, tool manifests. | `STWL_GAME_EVENTS`, `STWL_EVENT_DOCUMENTS`, `STWL_GRAPH_EDGES`, `STWL_AGENT_MEMORIES`, `STWL_MODEL_EVALS`, `STWL_TRAINING_EXAMPLES` | Put changing facts, identity, evidence, policy, and tool state here. This is where governance lives. |
| **Weight space** | What the model has already learned before the conversation starts: general language behavior, style, rubric-following, compact phrasing. | model-router shadow route `oci-base -> oci-fine-tuned`, training capture, adapter handoff, promotion gate | Move stable behavior into weights only after evals. Do not train changing match facts into the model. |
| **Skill space** | Programmatic skills, tools, and playbooks induced from repeated traces or recurring tasks. | Notebook CTA: vector-indexed toolbox/skillbox; harness skill retrieval pattern; source metadata and eval traces | Promote skills through tests and manifests. Do not let a model silently self-install new authority. |

## The Loop

1. **Observe in token space.** Capture prompts, evidence packages, outputs,
   token counts, warnings, route metadata, and trace IDs.
2. **Promote facts into structured space.** Store gameplay events, summaries,
   graph causality, replay manifests, memory cards, traces, evals, and training
   examples in Oracle AI Database.
3. **Retrieve deliberately.** Build bounded context from SQL, JSON, graph,
   vector-ready memory, and tool results.
4. **Evaluate behavior.** Score outputs for evidence use, no hallucinated game
   facts, confidence calibration, stage safety, and token efficiency.
5. **Induce candidate skills.** When traces show a repeated workflow, generate a
   skill or tool proposal: name, scenario, inputs, deterministic checks,
   authorization boundary, and eval cases.
6. **Train stable behavior.** Export accepted examples only when the behavior is
   stable enough for weight space: concise phrasing, evidence discipline,
   citation shape, safety, and fallback style.
7. **Promote with gates.** A candidate model or skill moves forward only when
   evals pass, traces are persisted, and the strict runtime proof agrees.

## Stage Talk Track

Say:

> Continual learning is not one giant prompt that keeps getting longer. It has
> different spaces. Token space is what the model sees right now. Structured
> space is what the system has organized and can operate on. Weight space is
> what the model learned before this turn. Skill space is where repeated
> workflows become governed tools or playbooks.

Then connect it to the game:

> In this demo, scores and powerups stay in structured space because they change
> every match. The model output stays in token space and gets traced. Stable
> commentary behavior can be exported for training. Repeated workflows can
> become skills, but only after tests and authorization boundaries.

## Proof Handles

- `deploy/db/stwl_model_learning.sql`: trace, output, eval, training, and
  promotion tables.
- `private-agent-factory/index.js`: model route, eval, trace persistence,
  training capture, and promotion gate logic.
- `.codex_tmp/model-ai-readiness/proof-bundle.md`: adapter-mode proof, strict
  upstream blocker, tier-1000 canary, training export, and promotion boundary.
- [notebook-cta-map.md](notebook-cta-map.md): harness, memory/context, and
  long-conversation learning paths.

## Boundaries

- Do not say the system autonomously updates model weights in production.
- Do not say skills self-install without review.
- Do not train changing facts into the model.
- Do not treat vectors as the whole memory system.
- Do not claim strict upstream promotion until both model routes report
  `runtime_mode=upstream-llm`.

## The Line To Land

> Facts live in structured space. Current reasoning lives in token space. Stable
> behavior can move into weight space. Repeated workflows graduate into skills
> only when the harness can test and govern them.
