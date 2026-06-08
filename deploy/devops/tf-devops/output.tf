output "devops_connection" {
  value = oci_devops_connection.devops_connection.base_url
}

output "deploy_id" {
  value = random_string.deploy_id.result
}

output "compartment" {
  value = data.oci_identity_compartment.compartment.name
}

output "devops_project_id" {
  value = oci_devops_project.devops_project.id
}

output "build_pipeline_id" {
  value = oci_devops_build_pipeline.build_pipeline.id
}

output "deploy_pipeline_id" {
  value = oci_devops_deploy_pipeline.deploy_pipeline.id
}
