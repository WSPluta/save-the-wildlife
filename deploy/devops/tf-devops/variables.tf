variable "config_file_profile" {
  type    = string
  default = "DEFAULT"
}

variable "tenancy_ocid" {
  type = string
}

variable "region" {
  type = string
}

variable "compartment_ocid" {
  type = string
}

variable "namespace" {
  type = string
}

variable "region_key" {
  type = string
}

variable "github_repo_url" {
  type = string
}

variable "github_user" {
  type = string
}

variable "github_access_token_secret_id" {
  type = string
}

variable "ocir_user" {
  type = string
}

variable "devops_ons_topic_ocid" {
  type = string
}

variable "oke_cluster_ocid" {
  type = string
}

variable "user_auth_token_id" {
  type = string
}

variable "adb_admin_password_id" {
  type = string
}

variable "adb_service" {
  type = string
}

variable "adb_id" {
  type = string
}

variable "paf_version" {
  type    = string
  default = "latest"
}

variable "paf_image_repository" {
  type        = string
  default     = "AUTO"
  description = "Container image repository for Oracle Private Agent Factory. AUTO resolves to the workshop OCIR path."
}

variable "genai_model_id" {
  type        = string
  default     = "cohere.command-r-08-2024"
  description = "OCI Generative AI model id used by the Oracle Private Agent Factory deployment."
}

variable "paf_mcp_enabled" {
  type        = string
  default     = "true"
  description = "Whether the Save the Wildlife PAF deployment exposes a read-only MCP server backed by Oracle AI Database telemetry."
}

variable "paf_mcp_public_url" {
  type        = string
  default     = ""
  description = "Public MCP endpoint URL to register in PAF Canvas, for example http://PUBLIC_IP/paf/mcp."
}

variable "paf_canvas_run_endpoint_url" {
  type        = string
  default     = ""
  description = "Published Oracle Private Agent Factory Canvas run endpoint consumed by the Save the Wildlife commentary adapter."
}

variable "paf_canvas_import_enabled" {
  type        = string
  default     = "false"
  description = "When true, the deploy command imports and publishes the Save the Wildlife Canvas flow into a Private Agent Factory host."
}

variable "paf_canvas_host" {
  type        = string
  default     = ""
  description = "Private Agent Factory host/IP used for automated Canvas flow import."
}

variable "paf_canvas_ssh_user" {
  type        = string
  default     = "opc"
  description = "SSH user for the Private Agent Factory host used by the Canvas import script."
}

variable "paf_canvas_ssh_key_secret_id" {
  type        = string
  default     = ""
  description = "Vault secret OCID containing the SSH private key for the Private Agent Factory host."
  sensitive   = true
}

variable "paf_canvas_flow_name" {
  type        = string
  default     = "Save the Wildlife Commentator"
  description = "Canvas flow name to create or update in Private Agent Factory."
}

variable "paf_canvas_agent_factory_user" {
  type        = string
  default     = ""
  description = "Optional Private Agent Factory user id that owns the imported Canvas flow."
}

variable "paf_canvas_llm_config_name" {
  type        = string
  default     = "llm_model_entry"
  description = "Registered Private Agent Factory LLM config name used by the imported Canvas flow."
}

variable "paf_canvas_require_llm_config" {
  type        = string
  default     = "false"
  description = "When true, Canvas import fails if the configured PAF LLM entry does not exist."
}

variable "paf_canvas_room_id" {
  type        = string
  default     = ""
  description = "Optional Private Agent Factory Canvas room id for continuing a published agent conversation."
}

variable "paf_canvas_timeout_ms" {
  type        = string
  default     = "1000"
  description = "Timeout in milliseconds for calls to the published Private Agent Factory Canvas run endpoint."
}

variable "paf_commentary_deadline_ms" {
  type        = string
  default     = "60000"
  description = "End-to-end commentary budget in milliseconds before optional PAF polish is skipped."
}

variable "paf_canvas_return_reserve_ms" {
  type        = string
  default     = "750"
  description = "Milliseconds reserved for returning a DB-grounded commentary response after Canvas polish."
}

variable "paf_canvas_min_timeout_ms" {
  type        = string
  default     = "100"
  description = "Minimum useful Canvas polish timeout before the adapter skips Canvas for the request."
}

variable "paf_canvas_verify_tls" {
  type        = string
  default     = "false"
  description = "Whether the commentary adapter should verify TLS for the Private Agent Factory Canvas endpoint."
}

variable "paf_model_route_mode" {
  type        = string
  default     = "primary"
  description = "PAF model router mode: off, primary, or shadow."
}

variable "paf_primary_model_provider" {
  type        = string
  default     = "oci-base"
  description = "Primary PAF model provider."
}

variable "paf_candidate_model_provider" {
  type        = string
  default     = "oci-fine-tuned"
  description = "Candidate PAF model provider used in shadow mode."
}

variable "oci_base_model_endpoint_url" {
  type        = string
  default     = ""
  description = "Private OCI base model endpoint URL consumed by PAF."
}

variable "oci_ft_model_endpoint_url" {
  type        = string
  default     = ""
  description = "Private OCI fine-tuned model endpoint URL consumed by PAF."
}

variable "model_ai_base_upstream_url" {
  type        = string
  default     = "http://stwl-ollama-fallback:11434/api/chat"
  description = "Ollama/OpenAI-compatible upstream URL consumed by the base private model adapter."
}

variable "model_ai_ft_upstream_url" {
  type        = string
  default     = "http://stwl-ollama-fallback:11434/api/chat"
  description = "Ollama/OpenAI-compatible upstream URL consumed by the fine-tuned private model adapter."
}

variable "model_ai_base_upstream_format" {
  type        = string
  default     = "ollama"
  description = "Upstream contract for the base private model adapter: ollama, openai, or internal."
}

variable "model_ai_ft_upstream_format" {
  type        = string
  default     = "ollama"
  description = "Upstream contract for the fine-tuned private model adapter: ollama, openai, or internal."
}

variable "model_ai_base_upstream_model_id" {
  type        = string
  default     = "llama3.2:1b"
  description = "Model id passed to the base private model adapter upstream."
}

variable "model_ai_ft_upstream_model_id" {
  type        = string
  default     = "llama3.2:1b-stwl"
  description = "Model id passed to the fine-tuned private model adapter upstream."
}

variable "model_ai_require_upstream_ready" {
  type        = string
  default     = "false"
  description = "When true, the deploy command verifies configured model upstream URLs from inside OKE before applying Kustomize."
}

variable "model_ai_require_private_ollama" {
  type        = string
  default     = "false"
  description = "When true, the deploy command rejects the in-cluster fallback Ollama URL for model adapters."
}

variable "oci_model_endpoint_auth_secret_id" {
  type        = string
  default     = ""
  description = "Vault secret OCID containing the bearer token for private model endpoints."
  sensitive   = true
}

variable "oci_model_endpoint_timeout_ms" {
  type        = string
  default     = "50000"
  description = "Timeout in milliseconds for private model endpoint calls."
}

variable "oci_model_endpoint_verify_tls" {
  type        = string
  default     = "true"
  description = "Whether PAF should verify TLS for private model endpoint calls."
}

variable "paf_trace_persist" {
  type        = string
  default     = "true"
  description = "Whether PAF persists model learning traces to Oracle AI Database."
}

variable "paf_eval_enabled" {
  type        = string
  default     = "true"
  description = "Whether PAF evaluates base vs fine-tuned outputs."
}

variable "paf_model_fast_path_enabled" {
  type        = string
  default     = "true"
  description = "Whether PAF may route directly to private OCI model endpoints before Oracle AI Database in-db agent enrichment."
}

variable "paf_eval_rubric_version" {
  type        = string
  default     = "stwl-commentary-v1"
  description = "Rubric version persisted with PAF model evaluations."
}

variable "paf_training_capture_enabled" {
  type        = string
  default     = "true"
  description = "Whether PAF captures accepted behavior traces as training examples."
}
