resource "oci_devops_deploy_pipeline" "deploy_pipeline" {
  project_id   = oci_devops_project.devops_project.id
  display_name = "deploy_pipeline_${random_string.deploy_id.result}"
  description  = "Deploy Pipeline for ${random_string.deploy_id.result}"
}

resource "oci_devops_deploy_stage" "shellstage_ci_deploy_stage" {
  deploy_stage_type               = "SHELL"
  display_name                    = "Deploy with Kustomize"
  command_spec_deploy_artifact_id = oci_devops_deploy_artifact.command_spec_deploy.id
  deploy_pipeline_id              = oci_devops_deploy_pipeline.deploy_pipeline.id

  container_config {
    availability_domain   = data.oci_identity_availability_domains.ads.availability_domains[0].name
    container_config_type = "CONTAINER_INSTANCE_CONFIG"
    shape_name            = "CI.Standard.E4.Flex"

    network_channel {
      network_channel_type = "SERVICE_VNIC_CHANNEL"
      subnet_id            = oci_core_subnet.publicsubnet.id
    }

    shape_config {
      memory_in_gbs = 8
      ocpus         = 1
    }
  }

  deploy_stage_predecessor_collection {
    items {
      id = oci_devops_deploy_pipeline.deploy_pipeline.id
    }
  }

  timeouts {}
}

resource "oci_devops_deploy_artifact" "command_spec_deploy" {
  argument_substitution_mode = "NONE"
  deploy_artifact_type       = "COMMAND_SPEC"
  display_name               = "Commnad spec deploy for ${random_string.deploy_id.result}"
  project_id                 = oci_devops_project.devops_project.id

  deploy_artifact_source {
    deploy_artifact_source_type = "INLINE"
    base64encoded_content = templatefile("${path.module}/../../../command_spec.yaml", {
      region                            = var.region
      region_key                        = var.region_key
      github_repo_url                   = var.github_repo_url
      cluster                           = var.oke_cluster_ocid
      oci_namespace                     = var.namespace
      ocir_user                         = var.ocir_user
      user_auth_token_id                = var.user_auth_token_id
      adb_admin_password_id             = var.adb_admin_password_id
      adb_service                       = var.adb_service
      adb_id                            = var.adb_id
      compartment_id                    = var.compartment_ocid
      paf_image_repository              = var.paf_image_repository
      paf_version                       = var.paf_version
      genai_model_id                    = var.genai_model_id
      paf_canvas_run_endpoint_url       = var.paf_canvas_run_endpoint_url
      paf_canvas_room_id                = var.paf_canvas_room_id
      paf_canvas_timeout_ms             = var.paf_canvas_timeout_ms
      paf_canvas_verify_tls             = var.paf_canvas_verify_tls
      paf_model_route_mode              = var.paf_model_route_mode
      paf_primary_model_provider        = var.paf_primary_model_provider
      paf_candidate_model_provider      = var.paf_candidate_model_provider
      oci_base_model_endpoint_url       = var.oci_base_model_endpoint_url
      oci_ft_model_endpoint_url         = var.oci_ft_model_endpoint_url
      oci_model_endpoint_auth_secret_id = var.oci_model_endpoint_auth_secret_id
      oci_model_endpoint_timeout_ms     = var.oci_model_endpoint_timeout_ms
      oci_model_endpoint_verify_tls     = var.oci_model_endpoint_verify_tls
      paf_trace_persist                 = var.paf_trace_persist
      paf_eval_enabled                  = var.paf_eval_enabled
      paf_eval_rubric_version           = var.paf_eval_rubric_version
      paf_training_capture_enabled      = var.paf_training_capture_enabled
    })
  }

}
