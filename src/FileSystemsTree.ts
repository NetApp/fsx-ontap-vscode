import * as vscode from 'vscode';
import { state } from './state';
import { stat } from 'fs';
import { listFileSystems, listSvms, listVolumes } from './FileSystemApis';
import { FileSystemsItem, SVMItem, VolumeItem } from './TreeItems';
import { add, keys } from 'lodash';

export class FileSystemsTree implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor() {
        state.onDidChangeActiveProfile.event(() => this.profileChanged());
        state.onDidChangeRegions.event(() => this._onDidChangeTreeData.fire());
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    async profileChanged() {
        if(state.currentProfile) {
           this._onDidChangeTreeData.fire();
        }
    }

    async getTreeItem(element: vscode.TreeItem): Promise<vscode.TreeItem> {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if(!element) {
            if (!state.currentProfile) {
                vscode.window.showInformationMessage('Please select an AWS profile first.');
                const item = new vscode.TreeItem('No profile selected', vscode.TreeItemCollapsibleState.None);
                item.contextValue = 'noProfile';
                item.command = {
                    command: 'netapp-fsx-ontap.aws-login',
                    title: 'Select AWS Profile (click to select)',
                };
                return [item];
            } else {
                
                return state.getSelectedRegions().map(region => {
                    const item = new vscode.TreeItem(`${state.availableRegions[region].description} - ${region}`, vscode.TreeItemCollapsibleState.Collapsed);
                    item.contextValue = 'region';
                    item.id = region;
                    return item;
                });
            }
        } else {
            if(element.contextValue === 'region') {
                const fileSystems = await listFileSystems(element.id || 'us-east-1');
                return fileSystems.map(fs => {
                    const name = fs.Tags?.find(tag => tag.Key === 'Name')?.Value || fs.FileSystemId;
                    const fsItem = new FileSystemsItem(name || '', fs.FileSystemId || '', fs, element.id || 'us-east-1', vscode.TreeItemCollapsibleState.Collapsed);
                    return fsItem;
                });
            }
            if(element.contextValue === 'filesystem') {
                const e = element as FileSystemsItem;
                const items: vscode.TreeItem[] = [];
                const svms = await listSvms(element.id || '', e.region);
                items.push(...svms.map(svm => {
                    const svmItem = new SVMItem(svm.Name || '', svm.StorageVirtualMachineId || '', svm, e.region, vscode.TreeItemCollapsibleState.Collapsed);
                    return svmItem; 
                }));
                return items;
            }

            if(element.contextValue === 'svm') {
                const e = element as SVMItem;
               
                const items: vscode.TreeItem[] = [];
                const volumes = await listVolumes(e.svm.StorageVirtualMachineId || '', e.svm.FileSystemId || '', e.region);
                items.push(...volumes.map(volume => {
                    const volumeItem = new VolumeItem(volume.Name || '', volume.VolumeId || '', e.region, volume, vscode.TreeItemCollapsibleState.None);
                    return volumeItem;
                }));
                return items;
            }
            
        }
        return [];
    }

    async getParent(element: vscode.TreeItem): Promise<vscode.TreeItem | null> {
        // Implement logic to return the parent of the element
        // For now, returning null
        return null;
    }


}