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

variable "redis_password_id" {
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

variable "paf_canvas_run_endpoint_url" {
  type        = string
  default     = ""
  description = "Published Oracle Private Agent Factory Canvas run endpoint consumed by the Save the Wildlife commentary adapter."
}

variable "paf_canvas_room_id" {
  type        = string
  default     = ""
  description = "Optional Private Agent Factory Canvas room id for continuing a published agent conversation."
}

variable "paf_canvas_timeout_ms" {
  type        = string
  default     = "8000"
  description = "Timeout in milliseconds for calls to the published Private Agent Factory Canvas run endpoint."
}

variable "paf_canvas_verify_tls" {
  type        = string
  default     = "false"
  description = "Whether the commentary adapter should verify TLS for the Private Agent Factory Canvas endpoint."
}
