# Production Agent Memory Patterns For The Talk

Source material:

- *From Prompt to Persistence: Designing Multi-Tenant Agent Memory Schemas for SaaS* (source draft)
- *From RAG to Memory Systems: Building Stateful AI Architecture* (source draft)

Use this as the production-oriented pattern spine behind **From Agent Factory to Agent Harness**. The Save the Wildlife demo proves the small version: gameplay telemetry becomes SQL truth, match context, memory, commentary, traces, evals, and training examples. These documents give the grown-up enterprise version.

## The Main Argument

This is not a "bigger prompt" story.

Production agents need a memory layer with typed records, scope, provenance, deletion, lifecycle rules, retrieval policy, and evaluation. A vector index is acceleration. The structured row is truth.

For the talk:

> SQL decides what happened. The model decides how to say it. The harness decides whether it is allowed to say it.

## Pattern 1: Tenant Is The Hard Boundary

In multi-tenant SaaS, `tenant_id` is structurally different from `user_id`, `agent_id`, and `thread_id`.

- `tenant_id` is never null.
- `tenant_id` is not a relevance signal.
- `tenant_id` is not optional metadata.
- Cross-tenant rows should not exist in the agent's retrieval universe.
- User, agent, and thread scope can inherit within a tenant; tenant scope cannot.

Demo translation:

`room_id` is the toy version of a tenant boundary. The production version is enforced by database policy, not by prompt instructions.

## Pattern 2: Row-Level Policy Belongs Below The Model

Use this as the production hardening pseudocode behind the current demo's MCP + SQL evidence scope. Do not claim this exact policy is live in the current demo tenancy unless we install and verify it.

```sql
CREATE OR REPLACE FUNCTION memory_tenant_policy(
  schema_in IN VARCHAR2,
  table_in  IN VARCHAR2
) RETURN VARCHAR2 AS
BEGIN
  RETURN q'[
    tenant_id = SYS_CONTEXT('memory_ctx','tenant_id')
  ]';
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => USER,
    object_name     => 'FACT_MEMORY',
    policy_name     => 'FACT_MEMORY_TENANT_POL',
    policy_function => 'memory_tenant_policy',
    statement_types => 'SELECT, INSERT, UPDATE, DELETE',
    update_check    => TRUE
  );
END;
/
```

Stage line:

> The model does not get to remember its way around access control. The application sets context once. The database enforces the boundary every time.

## Pattern 3: Type Memory Before You Retrieve It

Use the memory taxonomy as a practical engineering checklist:

- **Working memory:** current context window and run scratchpad.
- **Semantic cache:** recent thread/user history for speed.
- **Guideline memory:** authored policies, guardrails, and instructions.
- **Entity memory:** durable facts about people, teams, systems, sessions, or objects.
- **Persona memory:** stable preferences and behavior hints.
- **Episodic memory:** completed tasks or important prior trajectories.
- **Trace memory:** inputs, context cards, outputs, evals, and promotion decisions.
- **Shared memory:** records usable by multiple agents inside the same boundary.
- **Coordination:** handoffs, event streams, and agent-to-agent work state.

Demo translation:

Save the Wildlife currently uses event facts, session summaries, replay manifests, graph-ready relationships, vector-ready memories, model traces, evals, and training examples. That is the compact game-shaped version of the same taxonomy.

## Pattern 4: Separate Truth From Acceleration

Production rule:

> If a fact exists only in an embedding index, you have lost provenance, replayability, and deletion guarantees.

Use structured rows as truth:

```sql
CREATE TABLE fact_memory (
  fact_id       VARCHAR2(128) PRIMARY KEY,
  tenant_id     VARCHAR2(128) NOT NULL,
  user_id       VARCHAR2(128),
  agent_id      VARCHAR2(128),
  thread_id     VARCHAR2(128),
  content       CLOB NOT NULL,
  source_run_id VARCHAR2(128) NOT NULL,
  confidence    NUMBER,
  status        VARCHAR2(32) DEFAULT 'active',
  embedding     VECTOR(1024, FLOAT32),
  metadata_json CLOB CHECK (metadata_json IS JSON),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP
);

CREATE INDEX fact_memory_scope_ix
  ON fact_memory (tenant_id, user_id, agent_id, thread_id, status);
```

The embedding can be rebuilt. The row cannot be reverse-engineered from the embedding.

## Pattern 5: One Query Plan Beats Glue Code

The production win is not just vector search. It is vector search joined with policy, preferences, and operational data under one security model.

```sql
SELECT  f.fact_id,
        f.content,
        f.source_run_id,
        VECTOR_DISTANCE(f.embedding, :query_embedding, COSINE) AS distance
FROM    fact_memory f
JOIN    preference_memory p
  ON    p.tenant_id = f.tenant_id
 AND    p.user_id   = :user_id
JOIN    policy_memory pol
  ON    pol.tenant_id  = f.tenant_id
 AND    pol.policy_key = 'fact_retrieval'
WHERE   f.status = 'active'
AND     f.confidence >= JSON_VALUE(pol.policy_value, '$.min_confidence')
ORDER BY distance
FETCH FIRST 8 ROWS ONLY;
```

Stage line:

> The expensive join is not a SQL join. The expensive join is a trust boundary between five separate stores.

## Pattern 6: Promotion Is A Gate, Not A Side Effect

Do not let every transcript fragment become durable memory. Promotion decides type, scope, provenance, retention, and verification.

```python
def promote_memory(candidate, scope, source):
    assert scope.tenant_id
    assert source.run_id

    if candidate.type == "policy":
        return reject("policy_requires_authoring")

    if candidate.type == "fact":
        if candidate.confidence < 0.70:
            return reject("low_confidence")
        if not candidate.source_run_id:
            return reject("missing_provenance")

    if candidate.type == "preference":
        if candidate.confidence < 0.50 or not candidate.key:
            return reject("weak_preference")

    return write_memory(
        type=candidate.type,
        scope=scope,
        content=candidate.content,
        provenance=source,
        retention=candidate.retention_policy,
    )
```

Demo translation:

`STWL_MODEL_TRACES`, `STWL_MODEL_EVALS`, and `STWL_TRAINING_EXAMPLES` should be described as the beginning of this gate. A trace is not training data until the harness and evaluation policy promote it.

## Pattern 7: Reassemble Context Every Turn

Do not keep appending conversation history forever.

Each turn should rebuild the prompt from:

- applicable policies
- user and agent preferences
- retrieved facts
- retrieved episodes
- recent short summary
- current request
- tool outputs and citations

```python
def build_context_card(scope, query):
    return {
        "policies": load_guidelines(scope),
        "preferences": load_preferences(scope),
        "facts": retrieve_facts(scope, query, k=8),
        "episodes": retrieve_episodes(scope, query, k=4),
        "recent": summarize_recent_thread(scope.thread_id),
        "provenance": current_citations(),
    }
```

Stage line:

> The transcript is source material. The prompt is a reconstruction.

## How This Lands In The Demo

The game is the signal generator. Oracle AI Database is the memory and evidence plane. PAF Canvas is the visual agent surface. The harness turns them into a production loop:

1. Capture events.
2. Store structured truth.
3. Retrieve bounded context.
4. Generate inside policy.
5. Persist trace and output.
6. Evaluate quality.
7. Promote only accepted traces into memory or training examples.

## Claim Guardrails

Safe to claim live:

- PAF Canvas is deployed and reachable.
- Public MCP exposes match-intelligence tools.
- Oracle AI Database holds gameplay events, memories, traces, evals, and training examples.
- Select AI profile `STWL_GAMEPLAY_AI` is enabled.
- `STWL_COMMENTARY_PKG` is valid and returns deterministic SQL-grounded commentary.

Frame as production pattern unless separately installed and verified:

- VPD/RLS tenant isolation policies on game telemetry.
- Kubeflow `PyTorchJob` or FSDP distributed training.
- Candidate fine-tuned model beating the base model live.
- Full video ingestion; current demo proves telemetry plus replay metadata.
