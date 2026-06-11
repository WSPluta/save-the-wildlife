# Save the Wildlife PAF Canvas Workflow

This Canvas flow is the governed phrasing step for the live game commentator.
The deployed game service records events in Oracle AI Database, the in-cluster
commentary adapter reads the SQL-backed summary, asks the Oracle AI Database
in-database commentary package for a bounded Select AI or agent draft, and then
posts that bounded telemetry to the published Oracle Private Agent Factory
Canvas endpoint.

The demo message is Canvas plus harness. Business users can shape the final
agent experience in Canvas; AI engineers keep the production harness around it.
Here, the harness is the endpoint adapter connected to the live 3D game,
Oracle AI Database SQL telemetry, Select AI or in-database agent drafts, replay
context, safety checks, and the commentary broadcast back into the experience.

## Flow

1. Import `save-the-wildlife-commentary-canvas-flow.json` into Oracle Private Agent Factory Canvas.
2. Configure the Canvas agent LLM entry for the target OCI Generative AI model.
3. Publish the Canvas agent.
4. Install the database telemetry objects and in-database commentary package:

   ```bash
   sql ADMIN/<password>@<adb-service> @deploy/db/stwl_game_events.sql
   sql ADMIN/<password>@<adb-service> @deploy/db/stwl_commentary_pkg.sql
   ```

5. Configure Select AI for presenter exploration and optional in-database
   phrasing:

   ```bash
   sql ADMIN/<password>@<adb-service> @deploy/db/select_ai_profile_template.sql
   sql ADMIN/<password>@<adb-service> @deploy/db/select_ai_agent_team_template.sql
   ```

   The runtime remains deterministic if the Select AI profile or agent team is
   not available; those failures are caught and reported as warnings.

6. Copy the published run endpoint:

   ```text
   https://<paf-host>:8080/agentFactory/v1/agentBuilder/run/<published-agent-id>
   ```

7. Set the deployment variable before regenerating the DevOps command spec or
   patch the in-cluster ConfigMap:

   ```bash
   export PAF_CANVAS_RUN_ENDPOINT_URL="https://<paf-host>:8080/agentFactory/v1/agentBuilder/run/<published-agent-id>"
   export PAF_CANVAS_VERIFY_TLS=false
   ```

8. Keep any Canvas session cookie or password in a Kubernetes Secret or a secure
   deployment-time environment source. Do not commit those values.

## Runtime Contract

The adapter sends:

```json
{
  "message": "bounded SQL gameplay telemetry prompt plus optional Oracle AI Database draft",
  "roomId": null
}
```

The adapter accepts common Canvas response shapes such as `message`, `answer`,
`text`, or nested `payload.message`. The returned commentator script is still
clamped to 200 characters and passed through the profanity guard before the game
shows it.

The `/paf/healthz` response reports:

- `canvas_configured`
- `canvas_endpoint`
- `canvas_auth_configured`
- `indb_agent_enabled`
- `indb_agent_package`
- `select_ai_profile`
- `select_ai_agent_team_configured`

The `/paf/api/commentary` response reports `source: "paf-canvas"` only when the
published Canvas endpoint actually produced the line. The response also includes
`in_db_agent` when the Oracle AI Database package produced a draft. If Canvas,
Select AI, or the in-database agent team is unavailable, the adapter returns the
best deterministic Oracle SQL fallback and includes a warning.
