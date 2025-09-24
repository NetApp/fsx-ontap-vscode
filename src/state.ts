import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import * as vscode from 'vscode';
import * as fs from 'fs';
import { keys } from 'lodash';
import path from 'path';
import { FsxTelemetryReporter } from './telemetryReporter';

export type Profile = {
    profileName: string;
    error? : string;
}

class State {

    readonly onDidChangeActiveProfile = new vscode.EventEmitter<string | undefined>();
    readonly onDidChangeActiveProfileEvent = this.onDidChangeActiveProfile.event;

    readonly onDidChangeRegions = new vscode.EventEmitter<void>();
    readonly onDidChangeRegionsEvent = this.onDidChangeRegions.event;

    private selectedRegions: string[] = [];
    private context: vscode.ExtensionContext = {} as vscode.ExtensionContext;
    availableRegions: { [key: string]: { description: string } } = {};
    profiles: Profile[] = [];
    currentProfile: string = '';
    userId: string = '';
    sessionId: string = crypto.randomUUID();
    reporter = new FsxTelemetryReporter();

    constructor() {
        this.onDidChangeActiveProfileEvent((profile => {
            console.log('Active profile changed to:', profile);
        }));
    }

    async init(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadRegions();
        await this.loadProfiles();

        this.selectedRegions = context.globalState.get<string[]>('fsx-ontap-regions', ['us-east-1', 'us-west-2', 'us-east-2', 'eu-central-1', 'eu-west-1']);
        let user = context.globalState.get('fsx-ontap-user-id', '');
        if (user) {
            this.userId = user;
        } else {
            this.userId = crypto.randomUUID();
            context.globalState.update('fsx-ontap-user-id', this.userId);
        }

        this.reporter.activate(context);
    }

    getSelectedRegions() {
        return this.selectedRegions;
    }

    setSelectedRegions(regions: string[]) {
        this.selectedRegions = regions;
        this.context.globalState.update('fsx-ontap-regions', regions);
        this.onDidChangeRegions.fire();
    }

    async loadProfiles() {
        this.profiles = [];
        const profiles = await loadSharedConfigFiles();
        const profileKeys = keys(profiles.credentialsFile);
        console.log('Loaded profiles:', profileKeys);
        await this.checkProfiles(profileKeys);
        const hasValidDefault = this.profiles.find(profile => profile.profileName === 'default' && !profile.error);
        if (hasValidDefault) {
            this.currentProfile = hasValidDefault.profileName;
        }
    }

    private async checkProfiles(profiles: string[]) {
        
        for (const profile of profiles) {
            try {
                const stsClient = new STSClient({ region: "us-east-1", profile: profile });
                const command = new GetCallerIdentityCommand({});
                await stsClient.send(command);
                this.profiles.push({ profileName: profile });
            } catch (error) {
                this.profiles.push({ profileName: profile, error: (error as Error).message });
            }
        }

    }
    private loadRegions() {
        try {
            const regionsPath = path.resolve(__dirname, '../resources/regions.json');
            const data = fs.readFileSync(regionsPath, 'utf8');
            const regions = JSON.parse(data);
            this.availableRegions = regions.regions;
        } catch (error) {
            console.error('Error reading regions file:', error);
            this.availableRegions = {};
        }
    }
}

export const state = new State();   
