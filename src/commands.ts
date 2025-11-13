import * as vscode from 'vscode';
import { state } from './state';
import { addSvm, addVolume } from './FileSystemApis';
import { SSHService } from './sshService';
import { select_profile, ssh_to_fs } from './telemetryReporter';
import { executeOntapCommands } from './ontap_executor';
import { FileSystem } from '@aws-sdk/client-fsx';
import { ensureSsoLogin, isSsoProfile, needsSsoLogin } from './awsSsoHelper';

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
    const window = vscode.window;
    const hasActiveProfile = state.profiles.find(p => !p.error);
    if(!hasActiveProfile){
        vscode.window.showErrorMessage('No valid AWS profiles available. Please check your AWS configuration.');
        return;
    }

    const items: vscode.QuickPickItem[] = state.profiles.map(profile => {
        const isSso = profile.isSso || false;
        let description = '';
        if (profile.error) {
            description = `Error: ${profile.error}`;
        } else if (isSso) {
            description = 'SSO Profile';
        }
        return {
            label: profile.profileName,
            description: description,
            picked: profile.profileName === state.currentProfile,
        };
    });

    const result = await window.showQuickPick(items, {
        placeHolder: 'Select an AWS profile',
    });

    if (result && !result.description?.startsWith('Error:')) {
        const selectedProfile = result.label;
        const profileInfo = state.profiles.find(p => p.profileName === selectedProfile);
        
        // If it's an SSO profile, check if login is needed
        if (profileInfo?.isSso) {
            const needsLogin = await needsSsoLogin(selectedProfile);
            if (needsLogin) {
                const loginResult = await ensureSsoLogin(selectedProfile);
                if (!loginResult.success) {
                    vscode.window.showErrorMessage(`Failed to login to AWS SSO: ${loginResult.message}`);
                    // Still allow selection, user might want to retry
                } else {
                    vscode.window.showInformationMessage(loginResult.message);
                    // Reload profiles to update their status
                    await state.loadProfiles();
                }
            }
        }
        
        state.currentProfile = selectedProfile;
        state.reporter.sendTelemetryEvent(select_profile, { profile: state.currentProfile });
        state.onDidChangeActiveProfile.fire(state.currentProfile);
    } else if (result && result.description?.startsWith('Error:')) {
        vscode.window.showErrorMessage('Invalid profile selected. Please select a valid AWS profile.');
        selectProfile(); // Re-prompt if an error profile is selected
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

export async function addOntapLoginDetails(fileSystem: any)  {
    try{
        const connectionDetails = await SSHService.promptForConnectionDetails(fileSystem.fs.OntapConfiguration.Endpoints.Management.DNSName ,
         fileSystem.id, fileSystem.fs.OntapConfiguration.Endpoints.Management.IpAddresses[0], true);
        await executeOntapCommands(fileSystem.fs, ['volume show'], connectionDetails);
        await state.context.secrets.store(`sshKey-${fileSystem.id}-${fileSystem.region}`, JSON.stringify(connectionDetails));
        vscode.window.showInformationMessage(`ONTAP login details for file system ${fileSystem.id} added successfully.`);
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