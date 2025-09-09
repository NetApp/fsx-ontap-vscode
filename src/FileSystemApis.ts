import { CreateStorageVirtualMachineCommand, CreateVolumeCommand, FileSystem, FSxClient, ListTagsForResourceCommand, paginateDescribeBackups, paginateDescribeFileSystems, paginateDescribeStorageVirtualMachines, paginateDescribeVolumes, StorageVirtualMachine, Volume } from "@aws-sdk/client-fsx";
import {CloudWatchClient, GetMetricDataCommand, GetMetricStatisticsCommand, GetMetricStatisticsCommandInput, ListMetricsCommand} from "@aws-sdk/client-cloudwatch";
import { state } from "./state";

export const FileSystemMetrics = ['NetworkThroughputUtilization', 'NetworkSentBytes', 'NetworkReceivedBytes', 'DataReadBytes', 'DataWriteBytes',
                            'DataReadOperations', 'DataWriteOperations', 'MetadataOperations', 'DataReadOperationTime', 'DataWriteOperationTime',
                            'CapacityPoolReadBytes', 'CapacityPoolReadOperations', 'CapacityPoolWriteBytes', 'CapacityPoolWriteOperations',
                            'CPUUtilization', 'FileServerDiskThroughputUtilization', 'FileServerDiskThroughputBalance', 'FileServerDiskIopsBalance',
                            'FileServerDiskIopsUtilization', 'FileServerCacheHitRatio', 'DiskReadBytes', 'DiskWriteBytes', 'DiskIopsUtilization',
                            'DiskReadOperations', 'DiskWriteOperations', 'StorageEfficiencySavings', 'StorageUsed', 'LogicalDataStored', 'StorageCapacityUtilization',
                            'StorageCapacity', 'StorageUsed'
];

export const VolumeMetrics = ['DataReadBytes', 'DataWriteBytes', 'DataReadOperations', 'DataWriteOperations', 'MetadataOperations',
        'DataReadOperationTime', 'DataWriteOperationTime', 'MetadataOperationTime', 'StorageCapacity', 'StorageUsed', 'StorageCapacityUtilization',
        'FilesUsed', 'FilesCapacity', 'StorageUsed', 'StorageCapacityUtilization'
];

export async function listFileSystems(region: string): Promise<FileSystem[]> {
    const client = new FSxClient({ region, profile: state.currentProfile });
    const fileSystems: FileSystem[] = [];
    for await (const page of paginateDescribeFileSystems({ client }, { MaxResults: 100 })) {
        if (page.FileSystems) {
            fileSystems.push(...page.FileSystems.filter(fs => fs.FileSystemType === 'ONTAP'));
        }
    }

    return fileSystems;
}

export async function listAllSvms(region: string): Promise<StorageVirtualMachine[]> {
    const client = new FSxClient({ region, profile: state.currentProfile });
    const svms: StorageVirtualMachine[] = [];
    for await (const page of paginateDescribeStorageVirtualMachines({ client }, { MaxResults: 100 })) {
        if (page.StorageVirtualMachines) {
            svms.push(...page.StorageVirtualMachines);
        }
    }
    return svms;
}


export async function listSvms(fileSystemId: string, region: string): Promise<StorageVirtualMachine[]> {
    const client = new FSxClient({ region, profile: state.currentProfile });
    const svms: StorageVirtualMachine[] = [];
    for await (const page of paginateDescribeStorageVirtualMachines({ client }, { MaxResults: 100, Filters: [{
        Name: 'file-system-id',
        Values: [fileSystemId]
    }] })) {
        if (page.StorageVirtualMachines) {
            svms.push(...page.StorageVirtualMachines);
        }
    }
    return svms;
}

export async function listAllVolumes(region: string): Promise<Volume[]> {
    const client = new FSxClient({ region, profile: state.currentProfile });
    const volumes: Volume[] = [];
    for await (const page of paginateDescribeVolumes({ client }, { MaxResults: 100 })) {
        if (page.Volumes) {
            volumes.push(...page.Volumes);
        }
    }
    return volumes;
}

export async function listVolumes(svmId: string, fileSystemId: string, region: string): Promise<Volume[]> {
    const client = new FSxClient({ region, profile: state.currentProfile });
    const volumes: Volume[] = [];
    for await (const page of paginateDescribeVolumes({ client }, { MaxResults: 100, Filters: [{
        Name: 'storage-virtual-machine-id',
        Values: [svmId]
    }, {
        Name: 'file-system-id',
        Values: [fileSystemId]
    }] })) {
        if (page.Volumes) {
            volumes.push(...page.Volumes);
        }
    }
    return volumes;
}

export async function listBackups(region: string): Promise<any[]> {
    const client = new FSxClient({ region, profile: state.currentProfile });
    const backups: any[] = [];
    for await (const page of paginateDescribeBackups({ client }, { MaxResults: 100 })) {
        if (page.Backups) {
            backups.push(...page.Backups);
        }
    }
    return backups;
}

export async function getFileSystemMetrics(region: string, fsMetrics: string[], volMetrics: string[]): Promise<any> {

    const client = new CloudWatchClient({ region, profile: state.currentProfile });
    const results: Record<string, any[]> = {};
    for(const key of fsMetrics) {

        const result = await client.send(new GetMetricDataCommand({
            StartTime: new Date(Date.now() - 3600 * 1000 * 12), // 12 hours ago
            EndTime: new Date(),
            MetricDataQueries: [{
                Id: 'm1',
                Expression: `SELECT AVG(${key})
                                FROM SCHEMA("AWS/FSx", FileSystemId)
                                GROUP BY FileSystemId
                                ORDER BY AVG() DESC`,
                ReturnData: true,
                Period: 1 * 60 * 60, // 1 hour
            }]
        }));
        results[`filesystem-${key}`] = result.MetricDataResults || [];
    }

    for(const key of volMetrics) {

        const result = await client.send(new GetMetricDataCommand({
            StartTime: new Date(Date.now() - 3600 * 1000 * 12), // 12 hours ago
            EndTime: new Date(),
            MetricDataQueries: [{
                Id: 'm1',
                Expression: `SELECT AVG(${key})
                                FROM SCHEMA("AWS/FSx", FileSystemId, VolumeId)
                                GROUP BY VolumeId
                                ORDER BY AVG() DESC`,
                ReturnData: true,
                Period: 1 * 60 * 60, // 1 hour
            }]
        }));
        results[`volume-${key}`] = result.MetricDataResults || [];
    }
    return results;
    
}

export async function addSvm(fileSystemId: string, name: string, region: string) {
    const client = new FSxClient({ region: region, profile: state.currentProfile });
    const command = new CreateStorageVirtualMachineCommand({
        FileSystemId: fileSystemId,
        Name: name
    });
    await client.send(command);
}

export async function addVolume(svmId: string, name: string, sizeInMB: number, region: string) {
    const client = new FSxClient({ region: region, profile: state.currentProfile });
    const command = new CreateVolumeCommand({
        VolumeType: 'ONTAP',
        Name: name,
        OntapConfiguration: {
            SizeInMegabytes: sizeInMB,
            StorageVirtualMachineId: svmId,
            StorageEfficiencyEnabled: true,
            JunctionPath: `/${name}`,
            SecurityStyle: 'UNIX',
            TieringPolicy: {
                Name: 'AUTO',
            }
        }
    });
    try {
        const res = await client.send(command);
        return res;
    } catch (error) {
        console.error("Error creating volume:", error);
        throw error;
    }
}

export async function getEntities(entities: string[], extraData?: {fsMetrics: string[], volMetrics: string[]}): Promise<{[key: string]: any[]}> {
    const results: any = {
        filesystems: [],
        svms: [],
        volumes: [],
        backups: [],
        metrics: {},
    };
    const regions = state.selectedRegions;
    for (const entity of entities) {
        for (const region of regions) {
            switch (entity.toLowerCase()) {
                case "filesystems":
                    const fileSystems = await listFileSystems(region);
                    results.filesystems.push(...fileSystems);
                    break;
                case "svms":
                    const svms = await listAllSvms(region);
                    results.svms.push(...svms);
                    break;
                case "backups":
                    const backups = await listBackups(region);
                    results.backups.push(...backups);
                    break;
                case "volumes":
                    const volumes = await listAllVolumes(region);
                    results.volumes.push(...volumes);
                    break;
                case "metrics":
                    const metrics = await getFileSystemMetrics(region, extraData?.fsMetrics || [], extraData?.volMetrics || []);
                    results.metrics = metrics;
            }
        }
    }

    return results;
}

   