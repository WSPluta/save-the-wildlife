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

variable "model_ollama_enabled" {
  type        = bool
  default     = false
  description = "Create a private OCI compute host running Ollama for the model AI upstream. Bill-impacting."
}

variable "model_ollama_shape" {
  type        = string
  default     = "VM.GPU.A10.1"
  description = "Compute shape for the private Ollama host."
}

variable "model_ollama_ocpus" {
  type        = number
  default     = 0
  description = "OCPUs for flexible-shape private Ollama fallback hosts. Use 0 for fixed shapes."
}

variable "model_ollama_memory_in_gbs" {
  type        = number
  default     = 0
  description = "Memory in GB for flexible-shape private Ollama fallback hosts."
}

variable "model_ollama_availability_domain" {
  type        = string
  default     = ""
  description = "Availability domain for the private Ollama host. Defaults to the third AD when present."
}

variable "model_ollama_image_ocid" {
  type        = string
  default     = ""
  description = "Optional Oracle Linux GPU image OCID for the private Ollama host. Defaults to the newest Gen2 GPU Oracle Linux image for the shape."
}

variable "model_ollama_model_id" {
  type        = string
  default     = "llama3.1:8b"
  description = "Base Ollama model to pull on the private A10 host."
}

variable "model_ollama_custom_model_id" {
  type        = string
  default     = "llama3.1:8b-stwl"
  description = "Stage-facing Ollama model name created from the base model and Save the Wildlife system prompt."
}

variable "model_ollama_adapter_uri" {
  type        = string
  default     = ""
  description = "Optional Object Storage oci:// bucket URI prefix containing a LoRA adapter to apply in the Ollama Modelfile."
}

variable "model_ollama_port" {
  type        = number
  default     = 11434
  description = "Private Ollama HTTP port."
}

variable "model_ollama_boot_volume_size_in_gbs" {
  type        = number
  default     = 250
  description = "Boot volume size for Ollama model cache and future adapter packaging."
}

variable "model_ollama_ssh_public_key" {
  type        = string
  default     = ""
  description = "Optional SSH public key for break-glass access to the private Ollama host."
}
