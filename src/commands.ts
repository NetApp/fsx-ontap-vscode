import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { state } from './state';
import { addSvm, addVolume, createAndAttachS3AccessPoint, detacheAndDeleteS3AccessPoint } from './FileSystemApis';
import { SSHService } from './sshService';
import { select_profile, ssh_to_fs } from './telemetryReporter';
import { executeOntapCommands, OntapCommandResult } from './ontap_executor';
import { FileSystem, StorageVirtualMachine, Volume } from '@aws-sdk/client-fsx';
import { AwsCredentialsManager } from './awsCredentialsManager';
import { getObject, putObject, resolveS3Bucket } from './S3Apis';
import { ObjectItem, S3AccessPointItem } from './TreeItems';

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

export async function uploadS3Object(
    accessPoint: S3AccessPointItem,
    refreshFunc: (element?: vscode.TreeItem) => void,
    invalidateCache: (resourceArn: string) => void
) {
    const s3AccessPoint = accessPoint.accessPoint.S3AccessPoint;
    const resourceArn = s3AccessPoint?.ResourceARN || '';
    if (!resolveS3Bucket(s3AccessPoint)) {
        vscode.window.showErrorMessage('S3 access point has no alias or resource ARN.');
        return;
    }

    const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Upload',
    });
    if (!fileUris?.length) {
        return;
    }

    const filePath = fileUris[0].fsPath;
    const defaultKey = path.basename(filePath);
    const key = await vscode.window.showInputBox({
        prompt: 'S3 object key',
        value: defaultKey,
        placeHolder: 'e.g. folder/my-file.txt',
        validateInput: (value) => (value.trim() ? undefined : 'Key is required'),
    });
    if (!key?.trim()) {
        return;
    }

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Uploading ${defaultKey} to ${accessPoint.name}`,
                cancellable: false,
            },
            async () => {
                const body = fs.readFileSync(filePath);
                await putObject(s3AccessPoint!, key.trim(), accessPoint.region, body);
            }
        );
        invalidateCache(resourceArn);
        refreshFunc(accessPoint);
        vscode.window.showInformationMessage(`Uploaded "${key.trim()}" to access point ${accessPoint.name}.`);
    } catch (error: any) {
        const hint = error.name === 'ServiceUnavailable'
            ? ' The file system may be overloaded, or the access point may be misconfigured — try refreshing the tree and confirm the access point is AVAILABLE.'
            : '';
        vscode.window.showErrorMessage(`Error uploading to S3 access point "${accessPoint.name}": ${error.message}${hint}`);
    }
}

export async function openS3Object(item: ObjectItem) {
    const s3AccessPoint = item.accessPoint.S3AccessPoint;
    const key = item.object.Key || '';
    try {
        const content = await getObject(s3AccessPoint ?? {}, key, item.region);
        const tmpDir = path.join(os.tmpdir(), 'fsx-ontap-s3');
        fs.mkdirSync(tmpDir, { recursive: true });
        const safeKey = key.replace(/[/\\]/g, '__');
        const tmpFile = path.join(tmpDir, safeKey);
        fs.writeFileSync(tmpFile, content, 'utf-8');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tmpFile));
        await vscode.window.showTextDocument(doc, {
            preview: false,
            viewColumn: vscode.ViewColumn.Active,
        });
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error opening S3 object "${key}": ${error.message}`);
    }
}

export async function showMountPoint(volume: Volume, svm: StorageVirtualMachine) {
    const junctionPath = volume.OntapConfiguration?.JunctionPath;
    if (!junctionPath) {
        vscode.window.showWarningMessage(`No junction path configured for volume "${volume.Name}".`);
        return;
    }

    const nfsDns = svm.Endpoints?.Nfs?.DNSName;
    const smbDns = svm.Endpoints?.Smb?.DNSName;

    const items: vscode.QuickPickItem[] = [];

    if (nfsDns) {
        const nfsMount = `sudo mount -t nfs ${nfsDns}:${junctionPath} /mount/point`;
        items.push({ label: '$(terminal) NFS Mount Command', detail: nfsMount, description: 'Copy to clipboard' });
    }
    if (smbDns) {
        const smbPath = `\\\\${smbDns}\\${volume.Name}`;
        items.push({ label: '$(terminal) SMB Mount Path', detail: smbPath, description: 'Copy to clipboard' });
    }

    if (items.length === 0) {
        vscode.window.showWarningMessage(`No NFS or SMB endpoints found for SVM "${svm.Name}".`);
        return;
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Mount point for volume "${volume.Name}" (${junctionPath})`,
    });

    if (selected?.detail) {
        await vscode.env.clipboard.writeText(selected.detail);
        vscode.window.showInformationMessage('Mount command copied to clipboard.');
    }
}
