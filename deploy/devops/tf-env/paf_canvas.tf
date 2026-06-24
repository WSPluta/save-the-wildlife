locals {
  paf_canvas_tags = {
    app   = "save-the-wildlife"
    phase = "private-agent-factory-canvas"
  }

  paf_canvas_is_arm              = contains(var.paf_canvas_arm_shapes, var.paf_canvas_shape)
  paf_canvas_marketplace_image   = local.paf_canvas_is_arm ? var.paf_canvas_marketplace_arm_image_ocid : var.paf_canvas_marketplace_x86_image_ocid
  paf_canvas_marketplace_version = local.paf_canvas_is_arm ? var.paf_canvas_marketplace_arm_package_version : var.paf_canvas_marketplace_x86_package_version
  paf_canvas_image_id = var.paf_canvas_image_ocid != "" ? var.paf_canvas_image_ocid : (
    var.paf_canvas_use_marketplace_image ? local.paf_canvas_marketplace_image : try(data.oci_core_images.paf_canvas[0].images[0].id, "")
  )
}

data "oci_core_images" "paf_canvas" {
  count                    = var.paf_canvas_enabled && var.paf_canvas_image_ocid == "" && !var.paf_canvas_use_marketplace_image && (var.paf_canvas_install_script_url != "" || var.paf_canvas_container_image_uri != "") ? 1 : 0
  compartment_id           = var.compartment_ocid
  operating_system         = "Oracle Linux"
  shape                    = var.paf_canvas_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
  operating_system_version = "8"
}

resource "oci_core_app_catalog_listing_resource_version_agreement" "paf_canvas" {
  count                    = var.paf_canvas_enabled && var.paf_canvas_use_marketplace_image && var.paf_canvas_accept_marketplace_terms ? 1 : 0
  listing_id               = var.paf_canvas_marketplace_listing_id
  listing_resource_version = local.paf_canvas_marketplace_version
}

resource "oci_core_app_catalog_subscription" "paf_canvas" {
  count                    = var.paf_canvas_enabled && var.paf_canvas_use_marketplace_image && var.paf_canvas_accept_marketplace_terms ? 1 : 0
  compartment_id           = var.compartment_ocid
  eula_link                = oci_core_app_catalog_listing_resource_version_agreement.paf_canvas[0].eula_link
  listing_id               = oci_core_app_catalog_listing_resource_version_agreement.paf_canvas[0].listing_id
  listing_resource_version = oci_core_app_catalog_listing_resource_version_agreement.paf_canvas[0].listing_resource_version
  oracle_terms_of_use_link = oci_core_app_catalog_listing_resource_version_agreement.paf_canvas[0].oracle_terms_of_use_link
  signature                = oci_core_app_catalog_listing_resource_version_agreement.paf_canvas[0].signature
  time_retrieved           = oci_core_app_catalog_listing_resource_version_agreement.paf_canvas[0].time_retrieved

  timeouts {
    create = "20m"
  }
}

resource "oci_core_network_security_group" "paf_canvas" {
  count          = var.paf_canvas_enabled ? 1 : 0
  compartment_id = var.compartment_ocid
  vcn_id         = module.oke.vcn_id
  display_name   = "stwl-paf-canvas-${random_string.deploy_id.result}"
  freeform_tags  = local.paf_canvas_tags
}

resource "oci_core_network_security_group_security_rule" "paf_canvas_ssh_ingress" {
  for_each                  = var.paf_canvas_enabled ? toset(var.paf_canvas_allowed_cidrs) : toset([])
  network_security_group_id = oci_core_network_security_group.paf_canvas[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = each.value
  source_type               = "CIDR_BLOCK"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

resource "oci_core_network_security_group_security_rule" "paf_canvas_https_ingress" {
  for_each                  = var.paf_canvas_enabled ? toset(var.paf_canvas_allowed_cidrs) : toset([])
  network_security_group_id = oci_core_network_security_group.paf_canvas[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = each.value
  source_type               = "CIDR_BLOCK"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = 8080
      max = 8080
    }
  }
}

resource "oci_core_network_security_group_security_rule" "paf_canvas_egress_all" {
  count                     = var.paf_canvas_enabled ? 1 : 0
  network_security_group_id = oci_core_network_security_group.paf_canvas[0].id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  stateless                 = false
}

resource "oci_core_instance" "paf_canvas" {
  count               = var.paf_canvas_enabled ? 1 : 0
  availability_domain = try(data.oci_identity_availability_domains.ads.availability_domains[0].name, "")
  compartment_id      = var.compartment_ocid
  display_name        = "stwl-paf-canvas-${random_string.deploy_id.result}"
  shape               = var.paf_canvas_shape
  freeform_tags       = local.paf_canvas_tags

  shape_config {
    ocpus         = var.paf_canvas_ocpus
    memory_in_gbs = var.paf_canvas_memory_in_gbs
  }

  create_vnic_details {
    assign_public_ip = true
    display_name     = "stwl-paf-canvas"
    nsg_ids          = [oci_core_network_security_group.paf_canvas[0].id]
    subnet_id        = module.oke.pub_lb_subnet_id
  }

  metadata = merge(
    {
      user_data = base64encode(templatefile("${path.module}/templates/paf-canvas-cloud-init.yaml.tftpl", {
        adb_admin_password_secret_id = oci_vault_secret.adb_admin_password.id
        adb_id                       = oci_database_autonomous_database.adb.id
        adb_service                  = oci_database_autonomous_database.adb.db_name
        compartment_ocid             = var.compartment_ocid
        container_image_uri          = var.paf_canvas_container_image_uri
        container_name               = var.paf_canvas_container_name
        container_port               = var.paf_canvas_container_port
        genai_model_id               = var.paf_canvas_genai_model_id
        install_script_url           = var.paf_canvas_install_script_url
        region                       = var.region
        select_ai_agent_team         = var.paf_canvas_select_ai_agent_team
        select_ai_profile            = var.paf_canvas_select_ai_profile
        tenancy_ocid                 = var.tenancy_ocid
      }))
    },
    var.paf_canvas_ssh_public_key != "" ? {
      ssh_authorized_keys = var.paf_canvas_ssh_public_key
    } : {}
  )

  source_details {
    source_type             = "image"
    source_id               = local.paf_canvas_image_id
    boot_volume_size_in_gbs = var.paf_canvas_boot_volume_size_in_gbs
  }

  lifecycle {
    precondition {
      condition     = local.paf_canvas_image_id != ""
      error_message = "paf_canvas_image_id is empty. Set paf_canvas_image_ocid or use a shape with a matching Oracle Linux image."
    }
    precondition {
      condition     = var.paf_canvas_use_marketplace_image || var.paf_canvas_image_ocid != "" || var.paf_canvas_install_script_url != "" || var.paf_canvas_container_image_uri != ""
      error_message = "paf_canvas_enabled=true requires paf_canvas_use_marketplace_image=true, paf_canvas_image_ocid for a prebuilt Private Agent Factory image, paf_canvas_install_script_url for an installer, or paf_canvas_container_image_uri for a PAF container."
    }
    precondition {
      condition     = var.paf_canvas_ssh_public_key != ""
      error_message = "paf_canvas_ssh_public_key must be set when paf_canvas_enabled=true."
    }
  }

  depends_on = [
    oci_core_app_catalog_subscription.paf_canvas
  ]
}
