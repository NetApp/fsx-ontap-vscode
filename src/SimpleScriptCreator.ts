import * as vscode from 'vscode';

/**
 * Simple example of creating scripts without saving to disk
 * This is the easiest approach to implement
 */

export class SimpleScriptCreator {
    
  public static async createVolumeTerraformScript(svmId: string, region: string): Promise<void> {
        const content = `# Terraform configuration for NetApp FSx ONTAP Volume
                              # Generated: ${new Date().toISOString()}

                              terraform {
                                required_providers {
                                  aws = { 
                                    source  = "hashicorp/aws"
                                    version = "~> 5.0"
                                  }
                                }
                              }

                              provider "aws" {
                                region = "${region}"
                              }

                              resource "aws_fsx_ontap_volume" "aws_volume" {
                                name                       = "vol1"
                                junction_path              = "/vol1"
                                size_in_megabytes          = 1024
                                storage_efficiency_enabled = true
                                storage_virtual_machine_id = "${svmId}"
                                tiering_policy {
                                  name           = "AUTO"
                                  cooling_period = 31
                                }
                              
                                security_style = "UNIX"
                                snapshot_policy = "default"
                                volume_style = "FLEXVOL"    
                                tags = {
                                  Name = "My Volume"
                                  Environment = "development"
                                }
                              }

                              output "volume_id" {
                                value = aws_fsx_ontap_volume.aws_volume.id
                              }

                              output "volume_uuid" {
                                value = aws_fsx_ontap_volume.aws_volume.uuid
                              }
                              `;
        await SimpleScriptCreator.showScript(content, 'terraform', 'Terraform');
  }
   
  public static async createSvmTerraformScript(fileSystemId: string, region: string): Promise<void> {
        const content = `# Terraform configuration for NetApp FSx ONTAP SVM
                              # Generated: ${new Date().toISOString()}

                              terraform {
                                required_providers {
                                  aws = {
                                    source  = "hashicorp/aws"
                                    version = "~> 5.0"
                                  }
                                }
                              }

                              provider "aws" {
                                region = "${region}"
                              }

                              resource "aws_fsx_ontap_storage_virtual_machine" "aws_svm" {
                                file_system_id = "${fileSystemId}"
                                name           = "my-svm"
                                
                                tags = {
                                  Name = "My SVM"
                                  Environment = "development"
                                }
                              }

                              output "svm_id" {
                                value = aws_fsx_ontap_storage_virtual_machine.aws_svm.id
                              }`;

        await SimpleScriptCreator.showScript(content, 'terraform', 'Terraform');
  }

  public static async createVolumeCloudFormationScript(svmId: string, region: string): Promise<void> {
    const content = `# CloudFormation template for NetApp FSx ONTAP Volume
                  # Generated: ${new Date().toISOString()}

                  AWSTemplateFormatVersion: '2010-09-09'
                  Description: 'FSx ONTAP Volume'

                  Parameters:
                    SVMId:
                      Type: String
                      Default: ${svmId}

                  Resources:
                    Volume:
                      Type: AWS::FSx::Volume
                      Properties:
                        VolumeType: ONTAP
                        Name: my-volume
                        OntapConfiguration:
                          JunctionPath: /my-volume
                          SecurityStyle: UNIX
                          SizeInBytes: 419430400
                          StorageEfficiencyEnabled: true
                          StorageVirtualMachineId: !Ref SVMId
                          TieringPolicy:
                            CoolingPeriod: 31
                            Name: AUTO
                  Outputs:
                    VolumeId:
                      Value: !Ref Volume`;

    await SimpleScriptCreator.showScript(content, 'yaml', 'CloudFormation');
  }

  public static async createSvmCloudFormationScript(fileSystemId: string, region: string): Promise<void> {
        const content = `# CloudFormation template for NetApp FSx ONTAP SVM
                              # Generated: ${new Date().toISOString()}

                              AWSTemplateFormatVersion: '2010-09-09'
                              Description: 'FSx ONTAP Storage Virtual Machine'

                              Parameters:
                                FileSystemId:
                                  Type: String
                                  Default: ${fileSystemId}

                              Resources:
                                StorageVirtualMachine:
                                  Type: AWS::FSx::StorageVirtualMachine
                                  Properties:
                                    FileSystemId: !Ref FileSystemId
                                    Name: my-svm
                                    Tags:
                                      - Key: Name
                                        Value: My SVM
                                      - Key: Environment
                                        Value: development

                              Outputs:
                                SVMId:
                                  Value: !Ref StorageVirtualMachine`;

        await SimpleScriptCreator.showScript(content, 'yaml', 'CloudFormation');
  }

  public static async createVolumeCliScript(svmId: string, region: string): Promise<void> {
    const content = `#!/bin/bash
                  # AWS CLI script for NetApp FSx ONTAP Volume
                  # Generated: ${new Date().toISOString()}

                  set -e  # Exit on any error

                  # Configuration
                  SVM_ID="${svmId}"
                  REGION="${region}"
                  VOLUME_NAME="my-volume"
                  JUNCTION_PATH="/\${VOLUME_NAME}"
                  SIZE_IN_MEGABYTES="1024"  # 1 GB

                  # Colors for output
                  GREEN='\\033[0;32m'
                  YELLOW='\\033[1;33m'
                  NC='\\033[0m' # No Color

                  echo -e "\${GREEN}Creating FSx ONTAP Volume...\${NC}"
                  echo "SVM ID: \$SVM_ID"
                  echo "Region: \$REGION"
                  echo "Volume Name: \$VOLUME_NAME"
                  echo "Size: \$SIZE_IN_MEGABYTES MB"
                  echo ""

                  # Check if AWS CLI is installed
                  if ! command -v aws &> /dev/null; then
                      echo "ERROR: AWS CLI is not installed or not in PATH"
                      exit 1
                  fi

                  # Create the volume
                  echo -e "\${YELLOW}Creating volume...\${NC}"
                  VOLUME_RESPONSE=\$(aws fsx create-volume \\
                      --volume-type "ONTAP" \\
                      --name "\$VOLUME_NAME" \\
                      --ontap-configuration "JunctionPath=\$JUNCTION_PATH,SizeInMegabytes=\$SIZE_IN_MEGABYTES,StorageVirtualMachineId=\$SVM_ID,SecurityStyle=UNIX,StorageEfficiencyEnabled=true,TieringPolicy={Name=AUTO,CoolingPeriod=31}" \\
                      --tags "Key=Name,Value=\$VOLUME_NAME" "Key=Environment,Value=development" \\
                      --region "\$REGION" \\
                      --output json)

                  # Check if creation was successful
                  if [ \$? -eq 0 ]; then
                      # Extract Volume ID from response
                      VOLUME_ID=\$(echo "\$VOLUME_RESPONSE" | jq -r '.Volume.VolumeId')
                      echo -e "\${GREEN}Volume creation initiated successfully!\${NC}"
                      echo "Volume ID: \$VOLUME_ID"
                      echo "Junction Path: \$JUNCTION_PATH"
                      echo ""
                  else
                      echo "Failed to create volume"
                      exit 1
                  fi

                  echo -e "\${GREEN}Volume creation completed!\${NC}"
                  echo "You can now mount this volume using the junction path: \$JUNCTION_PATH"`;

    await SimpleScriptCreator.showScript(content, 'shellscript', 'CLI');
  }
  public static async createSvmCliScript(fileSystemId: string, region: string): Promise<void> {
        const content = `#!/bin/bash
                          # AWS CLI script for NetApp FSx ONTAP SVM
                          # Generated: ${new Date().toISOString()}

                          # Create the SVM
                          aws fsx create-storage-virtual-machine \\
                              --file-system-id "${fileSystemId}" \\
                              --name "my-svm" \\
                              --region "${region}" \\
                              --tags Key=Name,Value="My SVM" Key=Environment,Value=development

                          echo "SVM creation initiated for file system: ${fileSystemId}"`;

        await SimpleScriptCreator.showScript(content, 'shellscript', 'CLI');
  }

 
  private static async showScript(content: string, language: string, scriptType: string): Promise<void> {
        try {
            // Create untitled document
            const document = await vscode.workspace.openTextDocument({
                content: content,
                language: language
            });

            // Show the document
            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.Active
            });

            // Show informational message
            vscode.window.showInformationMessage(
                `${scriptType} script created! Use Ctrl+S (Cmd+S) to save it.`,
                'Got it'
            );

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create ${scriptType} script: ${error}`);
        }
  }

  
  public static async showScriptInWebview(content: string, title: string): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'scriptViewer',
            title,
            vscode.ViewColumn.Active,
            {
                enableScripts: true
            }
        );

        panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: monospace; padding: 20px; }
                pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
                .copy-btn { margin: 10px 0; padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 3px; cursor: pointer; }
            </style>
        </head>
        <body>
            <h2>${title}</h2>
            <button class="copy-btn" onclick="copyToClipboard()">Copy to Clipboard</button>
            <pre><code>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
            
            <script>
                function copyToClipboard() {
                    navigator.clipboard.writeText(\`${content.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`);
                    alert('Script copied to clipboard!');
                }
            </script>
        </body>
        </html>`;
  }
}
