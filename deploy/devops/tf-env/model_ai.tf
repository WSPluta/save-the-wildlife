locals {
  model_ai_tags = {
    app   = "save-the-wildlife"
    phase = "model-ai"
  }

  model_ai_base_model_id = var.model_ai_base_model_ocid != "" ? var.model_ai_base_model_ocid : try(oci_datascience_model.base_commentary[0].id, "")
  model_ai_ft_model_id   = var.model_ai_ft_model_ocid != "" ? var.model_ai_ft_model_ocid : try(oci_datascience_model.ft_commentary[0].id, "")

  model_ai_create_base_deployment = var.model_ai_enabled && local.model_ai_base_model_id != "" && var.model_ai_inference_image_uri != ""
  model_ai_create_ft_deployment   = var.model_ai_enabled && local.model_ai_ft_model_id != "" && var.model_ai_inference_image_uri != ""
}

resource "random_password" "model_endpoint_auth_secret" {
  count            = var.model_ai_enabled ? 1 : 0
  length           = 32
  special          = true
  min_numeric      = 4
  min_special      = 4
  min_lower        = 4
  min_upper        = 4
  override_special = "-_"
}

resource "oci_vault_secret" "model_endpoint_auth_secret" {
  count          = var.model_ai_enabled ? 1 : 0
  compartment_id = var.compartment_ocid
  secret_content {
    name         = "model_endpoint_auth_secret_${random_string.deploy_id.result}"
    content      = base64encode(random_password.model_endpoint_auth_secret[0].result)
    content_type = "BASE64"
    stage        = "CURRENT"
  }
  vault_id = oci_kms_vault.vault_devops.id
  key_id   = oci_kms_key.key_devops.id

  secret_name = "model_endpoint_auth_secret_${random_string.deploy_id.result}"
  description = "Bearer token shared by PAF and private model endpoints for ${random_string.deploy_id.result}"

  depends_on = [random_password.model_endpoint_auth_secret]
}

resource "oci_objectstorage_bucket" "model_ai_artifacts" {
  count          = var.model_ai_enabled ? 1 : 0
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.objectstorage_namespace.namespace
  name           = "stwl-model-ai-${lower(random_string.deploy_id.result)}"
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  freeform_tags  = local.model_ai_tags
}

resource "oci_core_network_security_group" "model_ai" {
  count          = var.model_ai_enabled ? 1 : 0
  compartment_id = var.compartment_ocid
  vcn_id         = module.oke.vcn_id
  display_name   = "model-ai-${random_string.deploy_id.result}"
  freeform_tags  = local.model_ai_tags
}

resource "oci_core_network_security_group_security_rule" "model_ai_ingress_from_workers" {
  count                     = var.model_ai_enabled ? 1 : 0
  network_security_group_id = oci_core_network_security_group.model_ai[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = module.oke.worker_nsg_id
  source_type               = "NETWORK_SECURITY_GROUP"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = var.model_ai_endpoint_port
      max = var.model_ai_endpoint_port
    }
  }
}

resource "oci_core_network_security_group_security_rule" "model_ai_egress_all" {
  count                     = var.model_ai_enabled ? 1 : 0
  network_security_group_id = oci_core_network_security_group.model_ai[0].id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  stateless                 = false
}

resource "oci_datascience_project" "model_ai" {
  count          = var.model_ai_enabled ? 1 : 0
  compartment_id = var.compartment_ocid
  display_name   = "stwl-model-ai-${random_string.deploy_id.result}"
  description    = "Save the Wildlife base vs fine-tuned private commentary model project."
  freeform_tags  = local.model_ai_tags
}

resource "oci_datascience_job" "fine_tune_commentary" {
  count                   = var.model_ai_enabled ? 1 : 0
  compartment_id          = var.compartment_ocid
  project_id              = oci_datascience_project.model_ai[0].id
  display_name            = "stwl-commentary-lora-${random_string.deploy_id.result}"
  description             = "Behavior-only LoRA/QLoRA fine-tuning job. Durable facts stay in Oracle AI Database memory."
  delete_related_job_runs = true
  freeform_tags           = local.model_ai_tags

  job_configuration_details {
    job_type                   = "DEFAULT"
    maximum_runtime_in_minutes = var.model_ai_training_max_runtime_minutes
    command_line_arguments     = "--dataset-uri ${var.model_ai_dataset_uri} --adapter-uri ${var.model_ai_adapter_uri}"
    environment_variables = {
      TRAINING_IMAGE_URI        = var.model_ai_training_image_uri
      STWL_DATASET_URI          = var.model_ai_dataset_uri
      STWL_ADAPTER_URI          = var.model_ai_adapter_uri
      STWL_RUBRIC_VERSION       = "stwl-commentary-v1"
      STWL_TRAINING_DISCIPLINE  = "behavior-only"
      STWL_FACTS_STORAGE_POLICY = "database-memory"
    }
  }

  job_infrastructure_configuration_details {
    job_infrastructure_type   = "STANDALONE"
    shape_name                = var.model_ai_shape
    block_storage_size_in_gbs = 256
    subnet_id                 = module.oke.worker_subnet_id

    job_shape_config_details {
      ocpus         = var.model_ai_training_ocpus
      memory_in_gbs = var.model_ai_training_memory_gbs
    }
  }

  job_log_configuration_details {
    enable_auto_log_creation = true
    enable_logging           = true
  }
}

resource "oci_datascience_model" "base_commentary" {
  count                   = var.model_ai_enabled && var.model_ai_create_registry_models ? 1 : 0
  compartment_id          = var.compartment_ocid
  project_id              = oci_datascience_project.model_ai[0].id
  display_name            = "stwl-base-commentary-${random_string.deploy_id.result}"
  description             = "Base private commentary model metadata package."
  model_artifact          = var.model_ai_base_model_artifact_path
  artifact_content_length = tostring(length(file(var.model_ai_base_model_artifact_path)))
  freeform_tags           = local.model_ai_tags
}

resource "oci_datascience_model" "ft_commentary" {
  count                   = var.model_ai_enabled && var.model_ai_create_registry_models ? 1 : 0
  compartment_id          = var.compartment_ocid
  project_id              = oci_datascience_project.model_ai[0].id
  display_name            = "stwl-ft-commentary-${random_string.deploy_id.result}"
  description             = "Fine-tuned private commentary model metadata package."
  model_artifact          = var.model_ai_ft_model_artifact_path
  artifact_content_length = tostring(length(file(var.model_ai_ft_model_artifact_path)))
  freeform_tags           = local.model_ai_tags
}

resource "oci_datascience_model_deployment" "base_commentary" {
  count          = local.model_ai_create_base_deployment ? 1 : 0
  compartment_id = var.compartment_ocid
  project_id     = oci_datascience_project.model_ai[0].id
  display_name   = "stwl-base-commentary"
  description    = "Private base model deployment for PAF shadow routing."
  freeform_tags  = local.model_ai_tags

  model_deployment_configuration_details {
    deployment_type = "SINGLE_MODEL"

    model_configuration_details {
      model_id       = local.model_ai_base_model_id
      bandwidth_mbps = 100

      instance_configuration {
        instance_shape_name = var.model_ai_shape

        model_deployment_instance_shape_config_details {
          ocpus         = var.model_ai_inference_ocpus
          memory_in_gbs = var.model_ai_inference_memory_gbs
        }
      }

      scaling_policy {
        policy_type    = "FIXED_SIZE"
        instance_count = 1
      }
    }

    environment_configuration_details {
      environment_configuration_type = "OCIR_CONTAINER"
      image                          = var.model_ai_inference_image_uri
      server_port                    = var.model_ai_endpoint_port
      health_check_port              = var.model_ai_endpoint_port
      environment_variables = {
        STWL_PROVIDER        = "oci-base"
        STWL_UPSTREAM_URL    = var.model_ai_base_upstream_url
        STWL_REQUIRED_BEARER = random_password.model_endpoint_auth_secret[0].result
        STWL_FACTS_POLICY    = "facts-in-memory-behavior-in-weights"
      }
    }
  }
}

resource "oci_datascience_model_deployment" "ft_commentary" {
  count          = local.model_ai_create_ft_deployment ? 1 : 0
  compartment_id = var.compartment_ocid
  project_id     = oci_datascience_project.model_ai[0].id
  display_name   = "stwl-ft-commentary"
  description    = "Private fine-tuned model deployment for PAF shadow routing."
  freeform_tags  = local.model_ai_tags

  model_deployment_configuration_details {
    deployment_type = "SINGLE_MODEL"

    model_configuration_details {
      model_id       = local.model_ai_ft_model_id
      bandwidth_mbps = 100

      instance_configuration {
        instance_shape_name = var.model_ai_shape

        model_deployment_instance_shape_config_details {
          ocpus         = var.model_ai_inference_ocpus
          memory_in_gbs = var.model_ai_inference_memory_gbs
        }
      }

      scaling_policy {
        policy_type    = "FIXED_SIZE"
        instance_count = 1
      }
    }

    environment_configuration_details {
      environment_configuration_type = "OCIR_CONTAINER"
      image                          = var.model_ai_inference_image_uri
      server_port                    = var.model_ai_endpoint_port
      health_check_port              = var.model_ai_endpoint_port
      environment_variables = {
        STWL_PROVIDER        = "oci-fine-tuned"
        STWL_UPSTREAM_URL    = var.model_ai_ft_upstream_url
        STWL_REQUIRED_BEARER = random_password.model_endpoint_auth_secret[0].result
        STWL_FACTS_POLICY    = "facts-in-memory-behavior-in-weights"
      }
    }
  }
}

resource "oci_container_instances_container_instance" "base_inference" {
  count                                = var.model_ai_enabled && var.model_ai_inference_image_uri != "" ? 1 : 0
  compartment_id                       = var.compartment_ocid
  availability_domain                  = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name                         = "stwl-base-commentary-private-${random_string.deploy_id.result}"
  shape                                = var.model_ai_shape
  container_restart_policy             = "ALWAYS"
  graceful_shutdown_timeout_in_seconds = "30"
  freeform_tags                        = local.model_ai_tags

  shape_config {
    ocpus         = var.model_ai_inference_ocpus
    memory_in_gbs = var.model_ai_inference_memory_gbs
  }

  vnics {
    subnet_id             = module.oke.worker_subnet_id
    nsg_ids               = [oci_core_network_security_group.model_ai[0].id]
    is_public_ip_assigned = false
    display_name          = "stwl-base-commentary-private"
  }

  containers {
    display_name                   = "stwl-base-commentary"
    image_url                      = var.model_ai_inference_image_uri
    is_resource_principal_disabled = false
    environment_variables = {
      STWL_PROVIDER        = "oci-base"
      STWL_MODEL_ID        = local.model_ai_base_model_id
      STWL_UPSTREAM_URL    = var.model_ai_base_upstream_url
      STWL_REQUIRED_BEARER = random_password.model_endpoint_auth_secret[0].result
      STWL_FACTS_POLICY    = "facts-in-memory-behavior-in-weights"
      PORT                 = tostring(var.model_ai_endpoint_port)
    }

    health_checks {
      name                     = "healthz"
      health_check_type        = "HTTP"
      path                     = "/healthz"
      port                     = var.model_ai_endpoint_port
      initial_delay_in_seconds = 20
      interval_in_seconds      = 15
      timeout_in_seconds       = 5
      failure_threshold        = 3
      success_threshold        = 1
      failure_action           = "KILL"
    }
  }
}

resource "oci_container_instances_container_instance" "ft_inference" {
  count                                = var.model_ai_enabled && var.model_ai_inference_image_uri != "" ? 1 : 0
  compartment_id                       = var.compartment_ocid
  availability_domain                  = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name                         = "stwl-ft-commentary-private-${random_string.deploy_id.result}"
  shape                                = var.model_ai_shape
  container_restart_policy             = "ALWAYS"
  graceful_shutdown_timeout_in_seconds = "30"
  freeform_tags                        = local.model_ai_tags

  shape_config {
    ocpus         = var.model_ai_inference_ocpus
    memory_in_gbs = var.model_ai_inference_memory_gbs
  }

  vnics {
    subnet_id             = module.oke.worker_subnet_id
    nsg_ids               = [oci_core_network_security_group.model_ai[0].id]
    is_public_ip_assigned = false
    display_name          = "stwl-ft-commentary-private"
  }

  containers {
    display_name                   = "stwl-ft-commentary"
    image_url                      = var.model_ai_inference_image_uri
    is_resource_principal_disabled = false
    environment_variables = {
      STWL_PROVIDER        = "oci-fine-tuned"
      STWL_MODEL_ID        = local.model_ai_ft_model_id
      STWL_UPSTREAM_URL    = var.model_ai_ft_upstream_url
      STWL_ADAPTER_URI     = var.model_ai_adapter_uri
      STWL_REQUIRED_BEARER = random_password.model_endpoint_auth_secret[0].result
      STWL_FACTS_POLICY    = "facts-in-memory-behavior-in-weights"
      PORT                 = tostring(var.model_ai_endpoint_port)
    }

    health_checks {
      name                     = "healthz"
      health_check_type        = "HTTP"
      path                     = "/healthz"
      port                     = var.model_ai_endpoint_port
      initial_delay_in_seconds = 20
      interval_in_seconds      = 15
      timeout_in_seconds       = 5
      failure_threshold        = 3
      success_threshold        = 1
      failure_action           = "KILL"
    }
  }
}
