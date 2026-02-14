import * as vscode from 'vscode';
import { _Object } from '@aws-sdk/client-s3';
import { state } from './state';
import { listFileSystems, listSvms, listVolumeAccessPoints, listVolumes } from './FileSystemApis';
import { FileSystemsItem, ObjectItem, S3AccessPointItem, S3NextPageItem, SVMItem, VolumeItem } from './TreeItems';
import { listObjects } from './S3Apis';

interface S3ObjectCacheEntry {
    objects: _Object[];
    nextContinuationToken?: string;
}

export class FileSystemsTree implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    /** Cache of listed S3 objects per access point (key = resourceArn) so we can append on "Next Page". */
    private s3ObjectCache = new Map<string, S3ObjectCacheEntry>();
    /** Parent access point tree item by resourceArn, so we can refresh the right node after loading next page. */
    private accessPointByArn = new Map<string, S3AccessPointItem>();

    constructor() {
        state.onDidChangeActiveProfile.event(() => this.profileChanged());
        state.onDidChangeRegions.event(() => this._onDidChangeTreeData.fire());
    }

    refresh(element?: vscode.TreeItem) {
        if (element === undefined) {
            this.s3ObjectCache.clear();
        }
        this._onDidChangeTreeData.fire(element);
    }

    /** Fetches the next page of S3 objects, appends to cache, and refreshes the access point node. */
    async loadNextPage(nextPageItem: S3NextPageItem): Promise<void> {
        const result = await listObjects(nextPageItem.resourceArn, nextPageItem.region, nextPageItem.continuationToken);
        const key = nextPageItem.resourceArn;
        const existing = this.s3ObjectCache.get(key);
        const objects = existing ? [...existing.objects, ...result.objects] : result.objects;
        this.s3ObjectCache.set(key, {
            objects,
            nextContinuationToken: result.nextContinuationToken,
        });
        const parent = this.accessPointByArn.get(key);
        this._onDidChangeTreeData.fire(parent);
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
                return Promise.all(fileSystems.map(async fs => {
                    const name = fs.Tags?.find(tag => tag.Key === 'Name')?.Value || fs.FileSystemId;
                    const sshInfoStr = await state.context.secrets.get(`sshKey-${fs.FileSystemId}-${element.id || 'us-east-1'}`);
                    const fsItem = new FileSystemsItem(name || '', fs.FileSystemId || '', fs, element.id || 'us-east-1',
                         vscode.TreeItemCollapsibleState.Collapsed, !!sshInfoStr);
                    return fsItem;
                }));
            }
            if(element.contextValue === 'filesystem' || element.contextValue === 'filesystem-withLoginDetails') {
                const e = element as FileSystemsItem;
                const items: vscode.TreeItem[] = [];
                const svms = await listSvms(element.id || '', e.region);
                items.push(...svms.map(svm => {
                    const svmItem = new SVMItem(svm.Name || '', svm.StorageVirtualMachineId || '', svm, e.region, e.fs,vscode.TreeItemCollapsibleState.Collapsed);
                    return svmItem; 
                }));
                return items;
            }

            if(element.contextValue === 'svm') {
                const e = element as SVMItem;
               
                const items: vscode.TreeItem[] = [];
                const volumes = await listVolumes(e.svm.StorageVirtualMachineId || '', e.svm.FileSystemId || '', e.region);
                items.push(...volumes.map(volume => {
                    const volumeItem = new VolumeItem(volume.Name || '', volume.VolumeId || '', e.region, volume, e.svm, e.fs, vscode.TreeItemCollapsibleState.Collapsed);
                    return volumeItem;
                }));
                return items;
            }

            if(element.contextValue === 'volume') {
                try {
                    const e = element as VolumeItem;
                    const volumeAccessPoints = await listVolumeAccessPoints(e.volume.VolumeId || '', e.region);
                    return volumeAccessPoints.map(accessPoint => {
                        const accessPointItem = new S3AccessPointItem(accessPoint.Name || '', accessPoint.S3AccessPoint?.ResourceARN || '',
                             e.region, accessPoint, e.volume, e.svm, e.fs, vscode.TreeItemCollapsibleState.Collapsed);
                        return accessPointItem;
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(`Error listing volume access points: ${error}`);
                    return [];
                }
                
            }

            if (element.contextValue === 's3-access-point') {
                try {
                    const e = element as S3AccessPointItem;
                    const resourceArn = e.accessPoint.S3AccessPoint?.ResourceARN || '';
                    this.accessPointByArn.set(resourceArn, e);

                    let entry = this.s3ObjectCache.get(resourceArn);
                    if (!entry) {
                        const result = await listObjects(resourceArn, e.region);
                        entry = { objects: result.objects, nextContinuationToken: result.nextContinuationToken };
                        this.s3ObjectCache.set(resourceArn, entry);
                    }

                    const objectItems: vscode.TreeItem[] = entry.objects.map(object =>
                        new ObjectItem(
                            object.Key || '',
                            object.LastModified?.toISOString() || '',
                            e.region,
                            object,
                            e.accessPoint,
                            e.volume,
                            e.svm,
                            e.fs,
                            vscode.TreeItemCollapsibleState.None
                        )
                    );
                    if (entry.nextContinuationToken) {
                        objectItems.push(new S3NextPageItem(resourceArn, e.region, entry.nextContinuationToken, e.accessPoint, e.volume, e.svm, e.fs));
                    }
                    return objectItems;
                } catch (error) {
                    vscode.window.showErrorMessage(`Error listing volume access points: ${error}`);
                    return [];
                }
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