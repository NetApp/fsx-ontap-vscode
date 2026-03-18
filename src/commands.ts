import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { state } from './state';
import { addSvm, addVolume, createAndAttachS3AccessPoint, detacheAndDeleteS3AccessPoint } from './FileSystemApis';
import { SSHService } from './sshService';
import { select_profile, ssh_to_fs } from './telemetryReporter';
import { executeOntapCommands, OntapCommandResult } from './ontap_executor';
import { FileSystem } from '@aws-sdk/client-fsx';
import { AwsCredentialsManager } from './awsCredentialsManager';
import { getObject } from './S3Apis';
import { ObjectItem } from './TreeItems';

function getOntapErrorMessage(results: OntapCommandResult[]): string | null {
    const failed = results.find(r => !r.success);
    if (!failed) { return null; }
    return failed.error || failed.output || `Command "${failed.command}" failed with exit code ${failed.exitCode}`;
}

export async function selectRegion() {
     const window = vscode.window;
     const items: vscode.QuickPickItem[] = [];
     const regions = Object.entries(state.availableRegions) || {};
     for (const [key, value] of regions) {
         items.push({
             detail: key,
             label: (typeof value === 'object' && value !== null && 'description' in value) ? (value as { description: string }).description : '',
             picked: state.getSelectedRegions().includes(key),
         });
     }
     const result = await window.showQuickPick(items, {
         placeHolder: 'Select a region',
         canPickMany: true,
         matchOnDetail: true,
     });

     if (result) {
         const selectedRegions = result.map(item => item.detail || '');
         state.setSelectedRegions(selectedRegions);
     }
}

export async function selectProfile() {
    // Open the credentials manager webview for profile selection
    if (state.context) {
        openCredentialsManager(state.context);
    } else {
        vscode.window.showErrorMessage('Extension context not available. Please reload the extension.');
    }
}

export async function addSvmCommand(fileSystem: any, region: string, refreshFunc: () => void) {
    const window = vscode.window;
    const name = await window.showInputBox({
        placeHolder: 'Enter SVM name',
    });

    if (name) {
        addSvm(fileSystem.id, name, region).then(() => {
            window.showInformationMessage(`SVM ${name} added successfully.`);
            refreshFunc();
        }).catch(error => {
                window.showErrorMessage(`Error creating SVM ${name}: ${error.message}`);
        });
    }       
}



export async function sshToFileSystem(item: any) {
    state.reporter.sendTelemetryEvent(ssh_to_fs, { region: item.region, fsId: item.id });
    await SSHService.sshToFileSystem(item.id, item.name, item.region, item.fs.OntapConfiguration.Endpoints.Management.IpAddresses[0]);
}


export async function addOntapLoginDetails(fileSystem: any, refreshFunc: () => void)  {
    try{
        const connectionDetails = await SSHService.promptForConnectionDetails(fileSystem.fs.OntapConfiguration.Endpoints.Management.DNSName ,
         fileSystem.id, fileSystem.fs.OntapConfiguration.Endpoints.Management.IpAddresses[0], true);
        const { result } = await executeOntapCommands(fileSystem.fs, ['volume show'], connectionDetails);
        const ontapError = getOntapErrorMessage(result);
        if (ontapError) {
            vscode.window.showErrorMessage(`ONTAP login validation failed: ${ontapError}`);
            return;
        }
        await state.context.secrets.store(`sshKey-${fileSystem.id}-${fileSystem.region}`, JSON.stringify(connectionDetails));
        vscode.window.showInformationMessage(`ONTAP login details for file system ${fileSystem.id} added successfully.`);
        refreshFunc();
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error adding ONTAP login details: ${error.message}`);   
    }
   
}

export async function createSnapshot(fs: FileSystem, svmName: string, volumeName: string, region: string) {
    const snapshotName = await vscode.window.showInputBox({
                prompt: 'Enter snapshot name',
                value: `${volumeName}-snapshot-${new Date().toISOString().replace(/[:.-]/g, '')}`, 
                placeHolder: 'e.g., snapshot1'
            });
    try {
        if (!snapshotName) {
            vscode.window.showWarningMessage('Snapshot creation cancelled: No name provided.');
            return;
        }
        vscode.window.showInformationMessage(`Creating snapshot ${snapshotName} on volume ${volumeName}...`);
        const { result } = await executeOntapCommands(fs, [`volume snapshot create -vserver ${svmName} -volume ${volumeName} -snapshot ${snapshotName}`]);
        const ontapError = getOntapErrorMessage(result);
        if (ontapError) {
            vscode.window.showErrorMessage(`Error creating snapshot ${snapshotName}: ${ontapError}`);
            return;
        }
        state.reporter.sendTelemetryEvent('create_snapshot', { region: region, volumeName: volumeName, svmName: svmName, snapshotName: snapshotName });
        vscode.window.showInformationMessage(`Snapshot ${snapshotName} created successfully on volume ${volumeName}.`);
    } catch (error) {
        vscode.window.showErrorMessage(`Error creating snapshot ${snapshotName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function createVolume(svmId: string, region: string, refreshFunc: () => void) {
    const window = vscode.window;
    const name = await window.showInputBox({
        placeHolder: 'Enter Volume name',
    });

    if (name) {
        const size = await window.showInputBox({
            placeHolder: 'Enter Volume size in GB',
        });

        if (size) {
            const sizeInMB = parseInt(size) * 1024;
            addVolume(svmId, name, sizeInMB, region).then(() => {
                window.showInformationMessage(`Volume ${name} created successfully.`);
                refreshFunc();
            }).catch(error => {
                window.showErrorMessage(`Error creating volume ${name}: ${error.message}`);
            });
        }
       
    }
}

export async function createS3VolumeAccessPoint(volumeId: string, region: string, refreshFunc: () => void) {
    const window = vscode.window;
    const name = await window.showInputBox({
        placeHolder: 'Enter Access Point name',
    });
    const unixUserName = await window.showInputBox({
        placeHolder: 'Enter unix user name',
    });
    if (name && unixUserName) {
        createAndAttachS3AccessPoint(volumeId, region, name, unixUserName).then(() => {
            window.showInformationMessage(`S3 volume access point created successfully.`);
            refreshFunc();
        }).catch(error => {
            window.showErrorMessage(`Error creating S3 volume access point: ${error.message}`);
        });
    }
}

export async function deleteS3VolumeAccessPoint(name: string, region: string, refreshFunc: () => void) {
    const window = vscode.window;
    const confirm = await window.showWarningMessage(`Are you sure you want to delete the S3 volume access point ${name}?`, { modal: true }, 'Delete');
    if (confirm === 'Delete') {
        detacheAndDeleteS3AccessPoint(name, region).then(() => {
            window.showInformationMessage(`S3 volume access point deleted successfully.`);
            refreshFunc();
        }).catch(error => {
            window.showErrorMessage(`Error deleting S3 volume access point: ${error.message}`);
        });
    }
}

export async function openCredentialsManager(context: vscode.ExtensionContext) {
    AwsCredentialsManager.createOrShow(context);
}

export async function openS3Object(item: ObjectItem) {
    const bucketName = item.accessPoint.S3AccessPoint?.ResourceARN || '';
    const key = item.object.Key || '';
    try {
        const content = await getObject(bucketName, key, item.region);
        const fileName = key.split('/').pop() || key;
        const tmpDir = path.join(os.tmpdir(), 'fsx-ontap-s3');
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, fileName);
        fs.writeFileSync(tmpFile, content, 'utf-8');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tmpFile));
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error opening S3 object "${key}": ${error.message}`);
    }
}
