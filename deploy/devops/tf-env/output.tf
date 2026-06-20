output "devops_ons_topic_ocid" {
  value = oci_ons_notification_topic.devops_ons_topic.id
}

output "kubeconfig" {
  value     = module.oke.cluster_kubeconfig
  sensitive = true
}

output "oke_cluster_ocid" {
  value = module.oke.cluster_id
}

output "oke_vcn_id" {
  value = module.oke.vcn_id
}

output "oke_worker_subnet_id" {
  value = module.oke.worker_subnet_id
}

output "oke_worker_nsg_id" {
  value = module.oke.worker_nsg_id
}

output "github_access_token_secret_ocid" {
  value = oci_vault_secret.github_access_token_secret.id
}

output "deploy_id" {
  value = random_string.deploy_id.result
}

output "compartment_id" {
  value = data.oci_identity_compartment.compartment.id
}

output "user_ocid" {
  value = oci_identity_user.oke_ocir_user.id
}

output "user_name" {
  value = oci_identity_user.oke_ocir_user.name
}

output "user_auth_token_id" {
  sensitive = false
  value     = oci_vault_secret.user_auth_token.id
}

output "adb_admin_password_id" {
  sensitive = true
  value     = oci_vault_secret.adb_admin_password.id
}

output "adb_service" {
  sensitive = false
  value     = oci_database_autonomous_database.adb.db_name
}

output "adb_id" {
  sensitive = false
  value     = oci_database_autonomous_database.adb.id
}

output "oci_model_endpoint_auth_secret_id" {
  sensitive = true
  value     = try(oci_vault_secret.model_endpoint_auth_secret[0].id, "")
}

output "model_ai_project_id" {
  sensitive = false
  value     = try(oci_datascience_project.model_ai[0].id, "")
}

output "model_ai_artifacts_bucket" {
  sensitive = false
  value     = try(oci_objectstorage_bucket.model_ai_artifacts[0].name, "")
}

output "model_ai_nsg_id" {
  sensitive = false
  value     = try(oci_core_network_security_group.model_ai[0].id, "")
}

output "model_ai_base_endpoint_url" {
  sensitive = false
  value = try(
    format("http://%s:%d", oci_container_instances_container_instance.base_inference[0].vnics[0].private_ip, var.model_ai_endpoint_port),
    try(oci_datascience_model_deployment.base_commentary[0].model_deployment_url, "")
  )
}

output "model_ai_ft_endpoint_url" {
  sensitive = false
  value = try(
    format("http://%s:%d", oci_container_instances_container_instance.ft_inference[0].vnics[0].private_ip, var.model_ai_endpoint_port),
    try(oci_datascience_model_deployment.ft_commentary[0].model_deployment_url, "")
  )
}

output "model_ollama_instance_id" {
  sensitive = false
  value     = try(oci_core_instance.model_ollama[0].id, "")
}

output "model_ollama_private_ip" {
  sensitive = false
  value     = try(oci_core_instance.model_ollama[0].private_ip, "")
}

output "model_ollama_chat_url" {
  sensitive = false
  value     = try(format("http://%s:%d/api/chat", oci_core_instance.model_ollama[0].private_ip, var.model_ollama_port), "")
}

output "model_ollama_model_id" {
  sensitive = false
  value     = var.model_ollama_custom_model_id
}
