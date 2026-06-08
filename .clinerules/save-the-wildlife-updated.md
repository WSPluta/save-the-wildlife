# Cline Rules for Save the Wildlife Project (Updated)

These rules are tailored for the "Save the Wildlife" project, a multiplayer Three.js game deployed on Oracle Cloud Infrastructure (OCI). They ensure efficient, consistent assistance when adding new features (e.g., game mechanics, services, or deployments). Follow these in addition to baseline Cline rules.

## 1. Project Structure Adherence
- **New Services**: Place in root-level folders (e.g., `/new-service/` mirroring `/score/` or `/server/`). Include `Dockerfile`, `package.json` (for JS) or `build.gradle` (for Java), and source code.
- **Frontend Changes**: Update `/web/src/` (e.g., Three.js logic in `script.js`). Rebuild with `npm run build` via Webpack in `/web/bundler/`.
- **Backend Changes**: For Node.js (server), edit `/server/server.js` or add modules. For Java (score), use JPA in `/score/src/main/java/`.
- **Deployment Extensions**: 
  - Kubernetes: Extend Kustomize in `/deploy/k8s/overlays/` (e.g., new Deployment YAML).
  - VMs/DevOps: Add Terraform resources in `/deploy/vm/terraform/` or `/deploy/devops/`.
  - Avoid altering core configs like `build_spec.yaml` or `command_spec.yaml` unless necessary; propose diffs instead.

## 2. Dependency & Version Management
- **Version Bumping**: Before changes, use `scripts/bump.mjs <service>` (e.g., `web`, `server`, `score`) for semantic versioning. Update `package.json` or `build.gradle` accordingly.
- **Dependencies**: 
  - JS: Add via `npm install` in `/server/` or `/web/`; ensure Socket.IO/Three.js compatibility.
  - Java: Use Gradle in `/score/`; prefer OCI-friendly libs (e.g., Oracle UCP for DB pooling).
  - Check `license_policy.yml` for approvals; avoid unapproved licenses to pass GitHub workflows.
- **Backends**: For features using distributed storage, toggle flags (`ENABLE_REDIS_BACKEND`/`ENABLE_COHERENCE_BACKEND` in `.env`) and verify configs in `application.properties` or server env vars.

## 3. Coding Standards
- **Patterns**: 
  - JS: Use async/await, Pino logging (`logger.info()`), and Socket.IO events (e.g., `player.trace.change` in `server.js`).
  - Java: Follow Spring Boot with JPA/Hibernate; use `@RestController` for APIs (e.g., `/api/score` in `CurrentScoreController.java`).
  - Game Logic: Sync web/server via WebSocket (e.g., item collisions update score via `score.js`).
- **Error Handling**: Add try-catch for OCI calls (e.g., Terraform/CLI in scripts); log with context (e.g., player ID).
- **Features**: For new game elements (e.g., items), update `createObject()` in `server/server.js` and rendering in `web/src/script.js`. Ensure boundary checks (e.g., `boundaries.width/height`).

## 4. Testing & Validation
- **Local Testing**:
  - Server: `npm test` in `/server/` (Vitest); start with `scripts/start_redis.mjs` + `scripts/start_coherence.mjs`.
  - Score: `./gradlew test` in `/score/`.
  - Web: `npm run dev` in `/web/`; test Three.js in browser.
- **Integration**: Run full local stack: `npm start` (server), `./gradlew bootRun` (score), check Socket.IO via browser dev tools.
- **OCI Validation**: Use `kubectl apply -k deploy/k8s/overlays/devops` for K8s; verify with `kubectl get svc`. Run GitHub workflows locally if possible.

## 5. Deployment & Infra Changes
- **Automation**: 
  - Build/Release: `scripts/build.mjs <service>` then `scripts/release.mjs <service>` to push to OCIR.
  - Deploy: `scripts/deploy.mjs` for K8s; `scripts/start_VM.sh` for VMs.
  - Terraform: Generate vars with `scripts/tfvars.mjs <env>` (e.g., `devops`), apply with `terraform apply -auto-approve`.
- **Environments**: Test in dev (overlays/devops) before prod (overlays/prod). Update secrets (e.g., ADB password in Vault) via Terraform.
- **Scaling**: For new features, adjust replicas in Kustomize (e.g., `patch_server_replicas.yaml`); monitor with OCI console.

## 6. Productivity Boosters
- **Automation Priority**: Prefer scripts (e.g., `scripts/setenv.mjs` for env setup) over manual commands. Chain with `zx` for custom tasks.
- **Cross-Service Sync**: When adding features (e.g., new API), update endpoints (`/api/score`), events (Socket.IO), and frontend rendering atomically.
- **Compliance**: Ensure changes pass Repolinter/SonarCloud (e.g., add copyright headers); avoid modifying `.github/` workflows.
- **If Unclear**: Ask via `ask_followup_question` (e.g., "Redis or Coherence for this feature?"). Use `search_files` for patterns (e.g., regex for Socket.IO handlers).
- **Tools Usage**: Leverage OCI CLI in `execute_command` for infra; `read_file` for configs before edits.
- **Adding New Features**: For game features like new items or mechanics, update server logic first (e.g., `server.js`), then sync with web rendering (`script.js`). Test locally with dev scripts before deploying.

These rules minimize setup time, reduce errors, and align with OCI best practices. Review and update as the project evolves.
