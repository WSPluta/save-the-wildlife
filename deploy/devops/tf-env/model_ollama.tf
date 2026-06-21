locals {
  model_ollama_tags = {
    app   = "save-the-wildlife"
    phase = "model-ai-ollama"
  }

  model_ollama_availability_domain = var.model_ollama_availability_domain != "" ? var.model_ollama_availability_domain : try(data.oci_identity_availability_domains.ads.availability_domains[2].name, data.oci_identity_availability_domains.ads.availability_domains[0].name)

  model_ollama_image_id = var.model_ollama_image_ocid != "" ? var.model_ollama_image_ocid : try(data.oci_core_images.model_ollama_gpu[0].images[0].id, "")

  model_ollama_metadata = merge(
    {
      user_data = base64encode(templatefile("${path.module}/templates/ollama-cloud-init.yaml.tftpl", {
        adapter_uri      = var.model_ollama_adapter_uri
        base_model       = var.model_ollama_model_id
        custom_model     = var.model_ollama_custom_model_id
        object_namespace = data.oci_objectstorage_namespace.objectstorage_namespace.namespace
        port             = var.model_ollama_port
      }))
    },
    var.model_ollama_ssh_public_key != "" ? {
      ssh_authorized_keys = var.model_ollama_ssh_public_key
    } : {}
  )
}

data "oci_core_images" "model_ollama_gpu" {
  count                    = var.model_ollama_enabled && var.model_ollama_image_ocid == "" ? 1 : 0
  compartment_id           = var.compartment_ocid
  operating_system         = "Oracle Linux"
  shape                    = var.model_ollama_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
  operating_system_version = "8"

  filter {
    name   = "display_name"
    values = [".*Gen2-GPU.*"]
    regex  = true
  }
}

resource "oci_core_network_security_group" "model_ollama" {
  count          = var.model_ollama_enabled ? 1 : 0
  compartment_id = var.compartment_ocid
  vcn_id         = module.oke.vcn_id
  display_name   = "stwl-ollama-a10-${random_string.deploy_id.result}"
  freeform_tags  = local.model_ollama_tags
}

resource "oci_core_network_security_group_security_rule" "model_ollama_ingress_from_workers" {
  count                     = var.model_ollama_enabled ? 1 : 0
  network_security_group_id = oci_core_network_security_group.model_ollama[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = module.oke.worker_nsg_id
  source_type               = "NETWORK_SECURITY_GROUP"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = var.model_ollama_port
      max = var.model_ollama_port
    }
  }
}

resource "oci_core_network_security_group_security_rule" "model_ollama_ingress_from_worker_subnet" {
  count                     = var.model_ollama_enabled ? 1 : 0
  network_security_group_id = oci_core_network_security_group.model_ollama[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = local.workers_subnet_cidr
  source_type               = "CIDR_BLOCK"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = var.model_ollama_port
      max = var.model_ollama_port
    }
  }
}

resource "oci_core_network_security_group_security_rule" "model_ollama_ingress_from_pods" {
  count                     = var.model_ollama_enabled ? 1 : 0
  network_security_group_id = oci_core_network_security_group.model_ollama[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = local.pods_cidr
  source_type               = "CIDR_BLOCK"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = var.model_ollama_port
      max = var.model_ollama_port
    }
  }
}

resource "oci_core_network_security_group_security_rule" "model_ollama_egress_all" {
  count                     = var.model_ollama_enabled ? 1 : 0
  network_security_group_id = oci_core_network_security_group.model_ollama[0].id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  stateless                 = false
}

resource "oci_core_instance" "model_ollama" {
  count               = var.model_ollama_enabled ? 1 : 0
  availability_domain = local.model_ollama_availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "stwl-ollama-a10-${random_string.deploy_id.result}"
  shape               = var.model_ollama_shape
  freeform_tags       = local.model_ollama_tags
  metadata            = local.model_ollama_metadata

  launch_options {
    firmware                            = "UEFI_64"
    is_consistent_volume_naming_enabled = true
    network_type                        = "VFIO"
    remote_data_volume_type             = "PARAVIRTUALIZED"
  }

  dynamic "shape_config" {
    for_each = var.model_ollama_ocpus > 0 ? [1] : []
    content {
      ocpus         = var.model_ollama_ocpus
      memory_in_gbs = var.model_ollama_memory_in_gbs
    }
  }

  create_vnic_details {
    assign_public_ip = false
    display_name     = "stwl-ollama-a10"
    nsg_ids          = [oci_core_network_security_group.model_ollama[0].id]
    subnet_id        = module.oke.worker_subnet_id
  }

  source_details {
    source_type             = "image"
    source_id               = local.model_ollama_image_id
    boot_volume_size_in_gbs = var.model_ollama_boot_volume_size_in_gbs
  }

  lifecycle {
    precondition {
      condition     = local.model_ollama_image_id != ""
      error_message = "model_ollama_image_id is empty. Set model_ollama_image_ocid or use a GPU shape with a matching Oracle Linux Gen2-GPU image."
    }
  }
}
