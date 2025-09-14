terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

variable "fsxn_name" {
  description = "fsxn filesystem name"
  type        = string
  default    = "Fill name"
}

variable "deployment_type" {
  description = "filesystem deployment type (SINGLE_AZ_1, MULTI_AZ_1, SINGLE_AZ_2, MULTI_AZ_2)"
  type        = string
  default     = "SINGLE_AZ_2"
}

variable "subnet_ids" {
  description = "list of subnet IDs where vpc endpoints will be placed (1 or 2 list items depending on deployment_type var)"
  type        = list(string)
}

variable "preferred_subnet_id" {
  description = "subnet where primary instance will reside"
  type        = string
}

variable "fsx_admin_password" {
  description = "password for the FSxN admin user"
  type        = string
}

variable "storage_capacity" {
  description = "storage capacity in GiB of the file system. Valid values between 1024 and 196608"
  type        = number
  default     = 1024
}

variable "throughput_capacity" {
  description = "Sets the throughput capacity (in MBps) for the file system that you're creating. Valid values are 128, 256, 512, 1024, 2048 and 4096"
  type        = number
  default     = 384
}

variable "automatic_backup_retention_days" {
  description = "The number of days to retain automatic backups. Setting this to 0 disables automatic backups. You can retain automatic backups for a maximum of 90 days."
  type        = number
  default     = 30
}

variable "kms_key_id" {
  description = "The ID of the AWS Key Management Service (AWS KMS) key used to encrypt the file system's data for Amazon FSx for ONTAP."
  type        = string
}

variable "svm_name" {
  description = "The name of the storage virtual machine (SVM) that you are creating."
  type        = string
  default     = ""
}

variable "vpc_id" {
  description = "The VPC ID where the security group will be created"
  type        = string
}

variable "fsx_security_group_cidr_block" {
  description = "The CIDR block for the security group"
  type        = string
}

variable "sg_name" {
  description = "The name of the security group"
  type        = string
  default     = ""
}

resource "aws_security_group" "WF_TF_FSxN_SG" {
  description = "FSxN Cloud firewall rules for management and data interface"
  vpc_id = var.vpc_id
  name = var.sg_name
}

resource "aws_vpc_security_group_ingress_rule" "r1" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = -1
  ip_protocol = "icmp"
  to_port     = -1
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r2" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 22
  ip_protocol = "tcp"
  to_port     = 22
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r3" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 80
  ip_protocol = "tcp"
  to_port     = 80
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r4" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 111
  ip_protocol = "udp"
  to_port     = 111
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r5" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 111
  ip_protocol = "tcp"
  to_port     = 111
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r6" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 139
  ip_protocol = "tcp"
  to_port     = 139
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r7" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 161
  ip_protocol = "tcp"
  to_port     = 162
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r8" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 161
  ip_protocol = "udp"
  to_port     = 162
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r9" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 443
  ip_protocol = "tcp"
  to_port     = 443
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r10" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 445
  ip_protocol = "tcp"
  to_port     = 445
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r11" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 635
  ip_protocol = "tcp"
  to_port     = 635
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r12" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 635
  ip_protocol = "udp"
  to_port     = 635
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r13" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 749
  ip_protocol = "tcp"
  to_port     = 749
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r14" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 2049
  ip_protocol = "tcp"
  to_port     = 2049
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r15" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 2049
  ip_protocol = "udp"
  to_port     = 2049
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r16" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 3260
  ip_protocol = "tcp"
  to_port     = 3260
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r17" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 4045
  ip_protocol = "tcp"
  to_port     = 4046
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r18" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 4045
  ip_protocol = "udp"
  to_port     = 4046
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r19" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 10000
  ip_protocol = "tcp"
  to_port     = 10000
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_ingress_rule" "r20" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  from_port   = 11104
  ip_protocol = "tcp"
  to_port     = 11105
  cidr_ipv4   = var.fsx_security_group_cidr_block
}

resource "aws_vpc_security_group_egress_rule" "r21" {
  security_group_id = aws_security_group.WF_TF_FSxN_SG.id
  ip_protocol = -1
  cidr_ipv4   = "0.0.0.0/0"
}

resource "aws_fsx_ontap_file_system" "WF_TF_FSxN" {
    tags = {
        Name = var.fsxn_name
    }
    storage_capacity    = var.storage_capacity
    subnet_ids          = var.subnet_ids
    deployment_type     = var.deployment_type
    fsx_admin_password  = var.fsx_admin_password
    security_group_ids  = [aws_security_group.WF_TF_FSxN_SG.id]
    throughput_capacity = var.throughput_capacity
    preferred_subnet_id = var.preferred_subnet_id
    automatic_backup_retention_days = var.automatic_backup_retention_days
    kms_key_id = var.kms_key_id
}

resource "aws_fsx_ontap_storage_virtual_machine" "WF_TF_FSxN_SVM" {
    file_system_id = aws_fsx_ontap_file_system.WF_TF_FSxN.id
    name           = var.svm_name
}

output "fsxn_arn" {
  value = aws_fsx_ontap_file_system.WF_TF_FSxN.id
}

output "fsxn_dns_name" {
  value = aws_fsx_ontap_file_system.WF_TF_FSxN.dns_name
}

output "fsxn_endpoints" {
  value = aws_fsx_ontap_file_system.WF_TF_FSxN.endpoints
}