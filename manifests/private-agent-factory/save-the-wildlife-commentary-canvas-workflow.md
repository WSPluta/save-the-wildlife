# Save the Wildlife PAF Canvas Workflow

This Canvas flow is the governed phrasing step for the live game commentator.
The deployed game service records events in Oracle AI Database, the in-cluster
commentary adapter reads the SQL-backed summary, and the adapter posts that
bounded telemetry to the published Oracle Private Agent Factory Canvas endpoint.

## Flow

1. Import `save-the-wildlife-commentary-canvas-flow.json` into Oracle Private Agent Factory Canvas.
2. Configure the Canvas agent LLM entry for the target OCI Generative AI model.
3. Publish the Canvas agent.
4. Copy the published run endpoint:

   ```text
   https://<paf-host>:8080/agentFactory/v1/agentBuilder/run/<published-agent-id>
   ```

5. Set the deployment variable before regenerating the DevOps command spec or
   patch the in-cluster ConfigMap:

   ```bash
   export PAF_CANVAS_RUN_ENDPOINT_URL="https://<paf-host>:8080/agentFactory/v1/agentBuilder/run/<published-agent-id>"
   export PAF_CANVAS_VERIFY_TLS=false
   ```

6. Keep any Canvas session cookie or password in a Kubernetes Secret or a secure
   deployment-time environment source. Do not commit those values.

## Runtime Contract

The adapter sends:

```json
{
  "message": "bounded SQL gameplay telemetry prompt",
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

The `/paf/api/commentary` response reports `source: "paf-canvas"` only when the
published Canvas endpoint actually produced the line. If Canvas is unavailable,
the adapter returns the deterministic Oracle SQL fallback and includes a warning.
