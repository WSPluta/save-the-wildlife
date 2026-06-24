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

1. Import `save-the-wildlife-commentary-canvas-flow.json` into Oracle Private Agent Factory Canvas. The preferred path is the Terraform/OCI DevOps deploy variable `paf_canvas_import_enabled=true`, which runs `scripts/import_paf_canvas_flow.py` during deployment.
2. Configure the Canvas agent LLM entry for the target OCI Generative AI model.
3. Register the deployed game MCP endpoint in the Canvas flow. The flow contains a `mcpServer` node, and the import script injects the deployment value from `PAF_MCP_PUBLIC_URL`, for example `http://130.162.174.167/paf/mcp`.
4. Publish the Canvas agent.
5. Install the database telemetry objects and in-database commentary package:

   ```bash
   sql ADMIN/<password>@<adb-service> @deploy/db/stwl_game_events.sql
   sql ADMIN/<password>@<adb-service> @deploy/db/stwl_commentary_pkg.sql
   ```

6. Configure Select AI for presenter exploration and optional in-database
   phrasing:

   ```bash
   sql ADMIN/<password>@<adb-service> @deploy/db/select_ai_profile_template.sql
   sql ADMIN/<password>@<adb-service> @deploy/db/select_ai_agent_team_template.sql
   ```

   The runtime remains deterministic if the Select AI profile or agent team is
   not available; those failures are caught and reported as warnings.

7. Copy the published run endpoint:

   ```text
   https://<paf-host>:8080/agentFactory/v1/agentBuilder/run/<published-agent-id>
   ```

8. Set the deployment variable before regenerating the DevOps command spec or
   patch the in-cluster ConfigMap:

   ```bash
   export PAF_CANVAS_RUN_ENDPOINT_URL="https://<paf-host>:8080/agentFactory/v1/agentBuilder/run/<published-agent-id>"
   export PAF_CANVAS_VERIFY_TLS=false
   ```

9. Keep any Canvas session cookie or password in a Kubernetes Secret or a secure
   deployment-time environment source. Do not commit those values.

## Terraform/DevOps Import Contract

Set these before generating `deploy/devops/tf-devops/terraform.tfvars` or provide
equivalent values directly in Terraform:

```bash
export PAF_MCP_ENABLED=true
export PAF_MCP_PUBLIC_URL="http://<game-public-ip>/paf/mcp"
export PAF_CANVAS_IMPORT_ENABLED=true
export PAF_CANVAS_HOST="<paf-canvas-host-or-ip>"
export PAF_CANVAS_SSH_USER="opc"
export PAF_CANVAS_SSH_KEY_SECRET_ID="<vault-secret-ocid-containing-private-key>"
export PAF_CANVAS_FLOW_NAME="Save the Wildlife Commentator"
export PAF_CANVAS_LLM_CONFIG_NAME="llm_model_entry"
```

To print the values that can be inferred from the current repo and Terraform
state, run:

```bash
npm run print:paf-canvas-deploy-env
```

The helper infers the current public game URL, the previous Canvas host, the
default MCP URL, and the flow name. It intentionally fails until
`PAF_CANVAS_SSH_KEY_SECRET_ID` is set to the Vault secret OCID containing the
SSH private key for the PAF Canvas host.

To create that Vault secret from a local private key without committing the key
or putting it in Terraform state:

```bash
npm run create:paf-canvas-ssh-secret -- --key-file ~/.ssh/<paf-canvas-private-key>
```

The helper reads `deploy/devops/tf-env` outputs for the DevOps Vault, KMS key,
and compartment. It prints:

```bash
export PAF_CANVAS_SSH_KEY_SECRET_ID='<created-secret-ocid>'
```

If the helper reports missing `devops_vault_id` or `devops_vault_key_id`, apply
the updated `deploy/devops/tf-env` outputs first:

```bash
terraform -chdir=deploy/devops/tf-env apply -auto-approve
```

The import step:

1. pulls the SSH private key from Vault
2. injects `PAF_MCP_PUBLIC_URL` into the Canvas `mcpServer` node
3. creates or updates the `Save the Wildlife Commentator` flow
4. publishes the flow
5. captures the generated `/agentFactory/v1/agentBuilder/run/<agent-id>` endpoint
6. regenerates the in-cluster PAF config so the game adapter calls that published Canvas endpoint

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
