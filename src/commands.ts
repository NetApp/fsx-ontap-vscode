import * as vscode from 'vscode';
import { state } from './state';
import { stat } from 'fs';
import { addSvm, addVolume } from './FileSystemApis';
import { SSHService } from './sshService';
import { ssh_to_fs } from './telemetryReporter';

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
    const items: vscode.QuickPickItem[] = state.profiles.map(profile => ({
        label: profile.profileName,
        description: profile.error ? `Error: ${profile.error}` : '',
        picked: profile.profileName === state.currentProfile,
    }));

    const result = await window.showQuickPick(items, {
        placeHolder: 'Select an AWS profile',
    });

    if (result && !result.description) {
        state.currentProfile = result.label;
        state.onDidChangeActiveProfile.fire(state.currentProfile);
    } else {
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