import * as vscode from 'vscode';
import { state } from './state';
import { addSvm, addVolume, createAndAttachS3AccessPoint } from './FileSystemApis';
import { SSHService } from './sshService';
import { select_profile, ssh_to_fs } from './telemetryReporter';
import { executeOntapCommands } from './ontap_executor';
import { FileSystem } from '@aws-sdk/client-fsx';
import { AwsCredentialsManager } from './awsCredentialsManager';

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
        await executeOntapCommands(fileSystem.fs, ['volume show'], connectionDetails);
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
        await executeOntapCommands(fs, [`volume snapshot create -vserver ${svmName} -volume ${volumeName} -snapshot ${snapshotName}`]);
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

export async function openCredentialsManager(context: vscode.ExtensionContext) {
    AwsCredentialsManager.createOrShow(context);
}