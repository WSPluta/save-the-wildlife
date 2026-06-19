# Notebook CTA Map

The game demo should end with practical next steps. These notebooks are the follow-on paths.

## CTA 1 - Build The Harness

Notebook: `/Users/wojtekpluta/Downloads/enterprise_data_agent_heavyweight.ipynb`

Use when the audience asks: "How do I build this for a real enterprise data agent?"

Key ideas to cite:

- **Agent = Model + Harness**
- Work backwards from concrete scenarios.
- Durable memory with Oracle AI Agent Memory Package.
- Schema scanning into institutional knowledge.
- Hybrid retrieval with vector search and Oracle Text.
- DBFS as short-term scratchpad.
- In-database deterministic compute with MLE.
- Vector-indexed toolbox and skillbox.
- Tool-output offload.
- Identity-aware authorization with Deep Data Security.

Slide CTA:

> Run the heavyweight notebook when you want the full harness: memory, tools, scratchpad, deterministic compute, retrieval, trace, and identity.

## CTA 2 - Engineer Memory And Context

Notebook: `/Users/wojtekpluta/Downloads/memory_context_engineering_agents.ipynb`

Use when the audience asks: "How do I stop my agent from forgetting or stuffing too much into context?"

Key ideas to cite:

- Conversational memory, knowledge memory, workflow memory, toolbox memory, entity memory, and summary memory.
- Memory reads should usually be programmatic.
- Some actions remain agentic: web search, expansion, summarization.
- Semantic tool retrieval solves tool registry bloat.
- Context engineering manages what enters the model window now.
- Summarize and mark messages instead of deleting them.

Slide CTA:

> Run the memory/context notebook when you want to decide what the model sees every turn and what stays in Oracle AI Database for later.

## CTA 3 - Master Long Conversations

Notebook: `/Users/wojtekpluta/Downloads/oracle_agent_memory_long_conversations (1).ipynb`

Use when the audience asks: "Which memory pattern should I use for long threads?"

Key ideas to cite:

- Bigger context windows do not replace memory architecture.
- Recent context, rolling summaries, vector retrieval, structured memory, episodic memory, and a memory manager all solve different problems.
- Evidence packages make answers reviewable.
- Scoped retrieval must be tested with conflicting facts.
- Add user, tenant, agent, and thread scoping before production.

Slide CTA:

> Run the long-conversation notebook when you need durable continuity and proof that retrieval does not leak across users or threads.

## How The Notebooks Relate To The Game

Use [continual-learning-operating-model.md](continual-learning-operating-model.md)
as the bridge between the live demo and the notebooks:

- **Token space:** what the model reads or writes in the current turn.
- **Structured space:** what Oracle AI Database stores, retrieves, governs, and
  tests.
- **Weight space:** stable behavior learned before the conversation starts.
- **Skill space:** repeated workflows promoted into governed tools or playbooks.

| Demo piece | Notebook extension |
|---|---|
| Gameplay event stream | Episodic memory and event sourcing |
| SQL session summary | Evidence package and memory manager |
| Select AI commentary draft | Controlled natural-language over governed data |
| PAF Canvas final line | Agent workflow and presentation layer |
| Prior sessions | Long-term memory and scoped retrieval |
| Fallback chain | Harness resilience and deterministic tools |
| Mobile audience play | Concrete scenario before infrastructure |

## Final Audience Assignment

Ask AI developers to do three things after the session:

1. Pick one workflow that already emits events.
2. Store those events in Oracle AI Database with enough metadata to explain what happened.
3. Build a small harness that retrieves grounded context, calls tools deterministically, and lets the model phrase the final response.
