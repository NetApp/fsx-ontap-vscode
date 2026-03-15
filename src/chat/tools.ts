import * as vscode from 'vscode';
import { spawn } from 'child_process';
import {
    listFileSystems, listAllVolumes, listVolumes, listAllSvms, listSvms,
    listBackups, getFileSystemMetrics, FileSystemMetrics, VolumeMetrics
} from '../FileSystemApis';
import { executeOntapCommands } from '../ontap_executor';
import { state } from '../state';
import { Logger, LogLevel } from '../logger';

export interface ChatTool {
    name: string;
    description: string;
    inputSchema: object;
    invoke(input: any, stream?: vscode.ChatResponseStream): Promise<string>;
}

export class AskUserError extends Error {
    constructor(
        public readonly question: string,
        public readonly options: Array<{ label: string; value: string }>
    ) {
        super('User input needed');
        this.name = 'AskUserError';
    }
}

async function resolveRegions(regionInput?: string): Promise<string[]> {
    if (regionInput) {
        return [regionInput];
    }
    return state.getSelectedRegions();
}

const getFilesystemsTool: ChatTool = {
    name: 'get_filesystems',
    description: 'List all Amazon FSx for NetApp ONTAP filesystems. Returns filesystem details including IDs, names (from tags), storage capacity, throughput, deployment type, endpoints, and status. Use this to discover filesystems in the user\'s AWS account.',
    inputSchema: {
        type: 'object',
        properties: {
            region: {
                type: 'string',
                description: 'AWS region to query. If omitted, queries all selected regions.'
            }
        }
    },
    async invoke(input: { region?: string }) {
        const regions = await resolveRegions(input.region);
        const allFilesystems = [];
        for (const region of regions) {
            const filesystems = await listFileSystems(region);
            allFilesystems.push(...filesystems);
        }
        return JSON.stringify(allFilesystems);
    }
};

const getVolumesTool: ChatTool = {
    name: 'get_volumes',
    description: 'List ONTAP volumes. Can list all volumes or filter by filesystem ID and/or SVM ID. Returns volume details including size, used space, junction path, tiering policy, security style, and status.',
    inputSchema: {
        type: 'object',
        properties: {
            region: {
                type: 'string',
                description: 'AWS region to query. If omitted, queries all selected regions.'
            },
            fileSystemId: {
                type: 'string',
                description: 'Filter volumes by filesystem ID (e.g. fs-0abc1234567890def). Requires svmId if specified.'
            },
            svmId: {
                type: 'string',
                description: 'Filter volumes by SVM ID. Requires fileSystemId if specified.'
            }
        }
    },
    async invoke(input: { region?: string; fileSystemId?: string; svmId?: string }) {
        const regions = await resolveRegions(input.region);
        const allVolumes = [];
        for (const region of regions) {
            if (input.fileSystemId && input.svmId) {
                const volumes = await listVolumes(input.svmId, input.fileSystemId, region);
                allVolumes.push(...volumes);
            } else {
                const volumes = await listAllVolumes(region);
                allVolumes.push(...volumes);
            }
        }
        return JSON.stringify(allVolumes);
    }
};

const getSvmsTool: ChatTool = {
    name: 'get_svms',
    description: 'List ONTAP Storage Virtual Machines (SVMs). Can list all SVMs or filter by filesystem ID. Returns SVM details including name, endpoints, active directory configuration, and status.',
    inputSchema: {
        type: 'object',
        properties: {
            region: {
                type: 'string',
                description: 'AWS region to query. If omitted, queries all selected regions.'
            },
            fileSystemId: {
                type: 'string',
                description: 'Filter SVMs by filesystem ID (e.g. fs-0abc1234567890def).'
            }
        }
    },
    async invoke(input: { region?: string; fileSystemId?: string }) {
        const regions = await resolveRegions(input.region);
        const allSvms = [];
        for (const region of regions) {
            if (input.fileSystemId) {
                const svms = await listSvms(input.fileSystemId, region);
                allSvms.push(...svms);
            } else {
                const svms = await listAllSvms(region);
                allSvms.push(...svms);
            }
        }
        return JSON.stringify(allSvms);
    }
};

const getBackupsTool: ChatTool = {
    name: 'get_backups',
    description: 'List all FSx ONTAP backups. Returns backup details including backup ID, filesystem ID, volume ID, type, status, creation time, and size.',
    inputSchema: {
        type: 'object',
        properties: {
            region: {
                type: 'string',
                description: 'AWS region to query. If omitted, queries all selected regions.'
            }
        }
    },
    async invoke(input: { region?: string }) {
        const regions = await resolveRegions(input.region);
        const allBackups = [];
        for (const region of regions) {
            const backups = await listBackups(region);
            allBackups.push(...backups);
        }
        return JSON.stringify(allBackups);
    }
};

const getCloudwatchMetricsTool: ChatTool = {
    name: 'get_cloudwatch_metrics',
    description: `Get CloudWatch metrics for FSx ONTAP filesystems or volumes. Returns the last 12 hours of metric data with 1-hour granularity, grouped by filesystem or volume ID.

Available filesystem metrics: ${FileSystemMetrics.join(', ')}
Available volume metrics: ${VolumeMetrics.join(', ')}

Use filesystem metrics for cluster-level performance (CPU, network, disk, storage capacity).
Use volume metrics for volume-level usage (data read/write, storage used, files used).`,
    inputSchema: {
        type: 'object',
        properties: {
            metricType: {
                type: 'string',
                enum: ['filesystem', 'volume'],
                description: 'Whether to query filesystem-level or volume-level metrics.'
            },
            metrics: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of metric names to query. Must be from the available metrics list.'
            },
            region: {
                type: 'string',
                description: 'AWS region to query. If omitted, queries all selected regions.'
            }
        },
        required: ['metricType', 'metrics']
    },
    async invoke(input: { metricType: 'filesystem' | 'volume'; metrics: string[]; region?: string }) {
        const regions = await resolveRegions(input.region);
        const validMetrics = input.metricType === 'filesystem' ? FileSystemMetrics : VolumeMetrics;
        const filteredMetrics = input.metrics.filter(m => validMetrics.includes(m));
        if (filteredMetrics.length === 0) {
            return JSON.stringify({ error: 'No valid metrics specified', availableMetrics: validMetrics });
        }

        const results: Record<string, any> = {};
        const fsMetrics = input.metricType === 'filesystem' ? filteredMetrics : [];
        const volMetrics = input.metricType === 'volume' ? filteredMetrics : [];

        for (const region of regions) {
            const metrics = await getFileSystemMetrics(region, fsMetrics, volMetrics);
            results[region] = metrics;
        }
        return JSON.stringify(results);
    }
};

const runOntapCliTool: ChatTool = {
    name: 'run_ontap_cli',
    description: `Execute ONTAP CLI commands on a specific filesystem via SSH. Use this for deep ONTAP-level inspection that the AWS APIs don't expose (e.g. aggregate details, network interfaces, snapmirror status, export policies, qtrees, quotas).
The commands must be read-only ONTAP CLI commands (show/list commands). Do NOT use commands that modify state.
Refer to https://docs.netapp.com/us-en/ontap-cli/ for available CLI commands (version 9.16.1).
Do NOT use the filesystem ID as a parameter in CLI commands. Use * for wildcards instead of <placeholders>.`,
    inputSchema: {
        type: 'object',
        properties: {
            fileSystemId: {
                type: 'string',
                description: 'The filesystem ID to connect to (e.g. fs-0abc1234567890def).'
            },
            commands: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of ONTAP CLI commands to execute. Must be read-only commands.'
            }
        },
        required: ['fileSystemId', 'commands']
    },
    async invoke(input: { fileSystemId: string; commands: string[] }, stream?: vscode.ChatResponseStream) {
        const allFilesystems = [];
        for (const region of state.getSelectedRegions()) {
            const filesystems = await listFileSystems(region);
            allFilesystems.push(...filesystems);
        }
        const fileSystem = allFilesystems.find(fs => fs.FileSystemId === input.fileSystemId);
        if (!fileSystem) {
            return JSON.stringify({ error: `Filesystem ${input.fileSystemId} not found` });
        }
        try {
            const results = await executeOntapCommands(fileSystem, input.commands, undefined, stream);
            return JSON.stringify(results.result);
        } catch (error) {
            return JSON.stringify({ error: `Failed to execute commands on ${input.fileSystemId}: ${(error as Error).message}` });
        }
    }
};

const runTerminalCommandTool: ChatTool = {
    name: 'run_terminal_command',
    description: 'Execute a shell command in the terminal. Useful for running AWS CLI commands, scripts, or inspecting the local environment. Only read-only commands are allowed. The command runs with the user\'s current shell environment and AWS credentials.',
    inputSchema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The shell command to execute.'
            }
        },
        required: ['command']
    },
    async invoke(input: { command: string }) {
        const blockedPatterns = [
            /\brm\s/, /\bdel\s/, /\brmdir\s/, /\bmkdir\s/,
            /\bmv\s/, /\bcp\s/, /\bchmod\s/, /\bchown\s/,
            /\bkill\s/, /\bpkill\s/, /\breboot\b/, /\bshutdown\b/,
            /\bdd\s/, /\bmkfs\b/, /\bformat\b/,
            />\s*\//, />\s*~/, /\bsudo\s/
        ];

        for (const pattern of blockedPatterns) {
            if (pattern.test(input.command)) {
                return JSON.stringify({ error: 'Command blocked: only read-only commands are allowed.' });
            }
        }

        return new Promise<string>((resolve) => {
            const child = spawn('sh', ['-c', input.command], {
                env: process.env,
                timeout: 30000
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });

            child.on('close', (code) => {
                resolve(JSON.stringify({
                    exitCode: code,
                    stdout: stdout.substring(0, 10000),
                    stderr: stderr.substring(0, 5000)
                }));
            });

            child.on('error', (err) => {
                resolve(JSON.stringify({ error: `Command execution failed: ${err.message}` }));
            });
        });
    }
};

const askUserTool: ChatTool = {
    name: 'ask_user',
    description: `Ask the user a clarifying question when you need more information to answer their request. Use this when the user's question is ambiguous or when you need them to choose between multiple options (e.g. which filesystem, which region, which metric).
Provide 2-5 clear options for the user to choose from. Each option should have a short label and a value that you can use to continue.`,
    inputSchema: {
        type: 'object',
        properties: {
            question: {
                type: 'string',
                description: 'The clarifying question to ask the user.'
            },
            options: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        label: { type: 'string', description: 'Short display label for this option.' },
                        value: { type: 'string', description: 'The value to use when the user selects this option. This will be sent back as the user\'s follow-up message.' }
                    },
                    required: ['label', 'value']
                },
                description: 'List of options for the user to choose from.'
            }
        },
        required: ['question', 'options']
    },
    async invoke(input: { question: string; options: Array<{ label: string; value: string }> }) {
        throw new AskUserError(input.question, input.options);
    }
};

export function getAllTools(): ChatTool[] {
    return [
        getFilesystemsTool,
        getVolumesTool,
        getSvmsTool,
        getBackupsTool,
        getCloudwatchMetricsTool,
        runOntapCliTool,
        runTerminalCommandTool,
        askUserTool
    ];
}
