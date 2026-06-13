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

variable "subscription_email" {
  type = string
}

variable "github_token" {
  type = string
}

variable "model_ai_enabled" {
  type        = bool
  default     = false
  description = "Create OCI Model AI resources for private base vs fine-tuned PAF endpoints. This is bill-impacting when enabled."
}

variable "model_ai_shape" {
  type        = string
  default     = "VM.GPU.A10.1"
  description = "Primary GPU shape for model training and inference. Use VM.GPU.A10.2 when capacity or VRAM requires it."
}

variable "model_ai_inference_ocpus" {
  type        = number
  default     = 15
  description = "OCPU shape config for private model inference adapters when using flexible-capable shapes."
}

variable "model_ai_inference_memory_gbs" {
  type        = number
  default     = 240
  description = "Memory in GB for private model inference adapters when using flexible-capable shapes."
}

variable "model_ai_training_ocpus" {
  type        = number
  default     = 15
  description = "OCPU shape config for the fine-tuning job when using flexible-capable shapes."
}

variable "model_ai_training_memory_gbs" {
  type        = number
  default     = 240
  description = "Memory in GB for the fine-tuning job when using flexible-capable shapes."
}

variable "model_ai_training_image_uri" {
  type        = string
  default     = ""
  description = "OCIR image URI for the BYOC LoRA/QLoRA training image."
}

variable "model_ai_inference_image_uri" {
  type        = string
  default     = ""
  description = "OCIR image URI for the BYOC inference adapter image."
}

variable "model_ai_base_model_ocid" {
  type        = string
  default     = ""
  description = "Optional existing OCI Data Science model OCID for the private base endpoint."
}

variable "model_ai_ft_model_ocid" {
  type        = string
  default     = ""
  description = "Optional existing OCI Data Science model OCID for the private fine-tuned endpoint."
}

variable "model_ai_create_registry_models" {
  type        = bool
  default     = false
  description = "Register Data Science model artifacts from local paths. Requires non-empty artifact path variables."
}

variable "model_ai_base_model_artifact_path" {
  type        = string
  default     = ""
  description = "Local artifact path for registering the base model metadata package."
}

variable "model_ai_ft_model_artifact_path" {
  type        = string
  default     = ""
  description = "Local artifact path for registering the fine-tuned model metadata package."
}

variable "model_ai_endpoint_port" {
  type        = number
  default     = 8080
  description = "Private inference adapter HTTP port."
}

variable "model_ai_training_max_runtime_minutes" {
  type        = string
  default     = "240"
  description = "Maximum runtime for the Data Science fine-tuning job."
}

variable "model_ai_dataset_uri" {
  type        = string
  default     = ""
  description = "Object Storage URI for behavior-only training examples."
}

variable "model_ai_adapter_uri" {
  type        = string
  default     = ""
  description = "Object Storage URI where LoRA/QLoRA adapters are written."
}

variable "model_ai_base_upstream_url" {
  type        = string
  default     = ""
  description = "Optional upstream model server URL used by the base private inference adapter."
}

variable "model_ai_ft_upstream_url" {
  type        = string
  default     = ""
  description = "Optional upstream model server URL used by the fine-tuned private inference adapter."
}
