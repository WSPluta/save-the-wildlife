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

variable "paf_canvas_enabled" {
  type        = bool
  default     = false
  description = "Create an optional public Private Agent Factory Canvas host for the Save the Wildlife demo. Bill-impacting when enabled."
}

variable "paf_canvas_use_marketplace_image" {
  type        = bool
  default     = true
  description = "Use the Oracle AI Database Private Agent Factory Marketplace image when paf_canvas_image_ocid is empty."
}

variable "paf_canvas_accept_marketplace_terms" {
  type        = bool
  default     = true
  description = "Accept Oracle AI Database Private Agent Factory Marketplace terms before launching the image. Required for first-time marketplace use."
}

variable "paf_canvas_marketplace_listing_id" {
  type        = string
  default     = "ocid1.appcataloglisting.oc1..aaaaaaaatzpebex5ocjaj33xkt6o2qxvcbvsb3fmcd2ypa74yogfj37246ba"
  description = "Oracle AI Database Private Agent Factory Marketplace listing OCID."
}

variable "paf_canvas_marketplace_x86_image_ocid" {
  type        = string
  default     = "ocid1.image.oc1..aaaaaaaamsa27joy3ad3mjsbsfjgsddqmx6qtynqtx3hjumg6bmj5lwqnwma"
  description = "Oracle AI Database Private Agent Factory Marketplace x86 image OCID for uk-london-1."
}

variable "paf_canvas_marketplace_x86_package_version" {
  type        = string
  default     = "25.3.0.0.9.X86"
  description = "Oracle AI Database Private Agent Factory Marketplace x86 package version."
}

variable "paf_canvas_marketplace_arm_image_ocid" {
  type        = string
  default     = "ocid1.image.oc1..aaaaaaaadhoxm6n2vfbzxrzsnfsvuaai64jrgiv6j5vahuhbuxzcdxauot5a"
  description = "Oracle AI Database Private Agent Factory Marketplace Arm image OCID."
}

variable "paf_canvas_marketplace_arm_package_version" {
  type        = string
  default     = "25.3.0.0.9.ARM"
  description = "Oracle AI Database Private Agent Factory Marketplace Arm package version."
}

variable "paf_canvas_arm_shapes" {
  type        = list(string)
  description = "Compute shapes that should use the Arm Oracle AI Database Private Agent Factory Marketplace image."
  default = [
    "BM.Standard.A1.160",
    "BM.Standard.A4.48",
    "VM.Standard.A1.Flex",
    "VM.Standard.A2.Flex",
    "VM.Standard.A4.Flex"
  ]
}

variable "paf_canvas_shape" {
  type        = string
  default     = "VM.Standard.E4.Flex"
  description = "Compute shape for the optional Private Agent Factory Canvas host."
}

variable "paf_canvas_ocpus" {
  type        = number
  default     = 2
  description = "OCPUs for the optional Private Agent Factory Canvas flexible shape."
}

variable "paf_canvas_memory_in_gbs" {
  type        = number
  default     = 16
  description = "Memory in GB for the optional Private Agent Factory Canvas flexible shape."
}

variable "paf_canvas_boot_volume_size_in_gbs" {
  type        = number
  default     = 120
  description = "Boot volume size for the optional Private Agent Factory Canvas host."
}

variable "paf_canvas_image_ocid" {
  type        = string
  default     = ""
  description = "Optional prebuilt Private Agent Factory image OCID. If omitted, paf_canvas_install_script_url must install PAF on the latest matching Oracle Linux 8 image."
}

variable "paf_canvas_ssh_public_key" {
  type        = string
  default     = ""
  description = "SSH public key for the optional Private Agent Factory Canvas host."
}

variable "paf_canvas_allowed_cidrs" {
  type        = list(string)
  default     = ["0.0.0.0/0"]
  description = "CIDR blocks allowed to access PAF Canvas SSH and HTTPS/8080. Restrict this for production."
}

variable "paf_canvas_install_script_url" {
  type        = string
  default     = ""
  description = "Optional HTTPS/Object Storage URL to a PAF installer script run by cloud-init. Required unless paf_canvas_image_ocid points to a prebuilt PAF image."
}

variable "paf_canvas_container_image_uri" {
  type        = string
  default     = ""
  description = "Optional PAF Canvas container image URI. When set, cloud-init starts it with Podman and passes the Oracle AI Database/Select AI env file."
}

variable "paf_canvas_container_name" {
  type        = string
  default     = "oracle-applied-ai-label"
  description = "Container name for the optional PAF Canvas container image."
}

variable "paf_canvas_container_port" {
  type        = number
  default     = 8080
  description = "Internal HTTP port exposed by the optional PAF Canvas container image."
}

variable "paf_canvas_select_ai_profile" {
  type        = string
  default     = "STWL_GAMEPLAY_AI"
  description = "Select AI profile name the Terraform-managed PAF Canvas installer should configure against the Oracle AI Database."
}

variable "paf_canvas_select_ai_agent_team" {
  type        = string
  default     = "STWL_GAMEPLAY_COMMENTARY_TEAM"
  description = "Select AI agent team name the Terraform-managed PAF Canvas installer should configure when supported."
}

variable "paf_canvas_genai_model_id" {
  type        = string
  default     = "cohere.command-r-08-2024"
  description = "OCI Generative AI model id the Terraform-managed PAF Canvas installer should register for Canvas workflows."
}
