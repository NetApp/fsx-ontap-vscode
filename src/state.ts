import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import * as vscode from 'vscode';
import * as fs from 'fs';
import { keys } from 'lodash';
import path from 'path';

export type Profile = {
    profileName: string;
    error? : string;
}

class State {

    readonly onDidChangeActiveProfile = new vscode.EventEmitter<string | undefined>();
    readonly onDidChangeActiveProfileEvent = this.onDidChangeActiveProfile.event;

    readonly onDidChangeRegions = new vscode.EventEmitter<void>();
    readonly onDidChangeRegionsEvent = this.onDidChangeRegions.event;

    selectedRegions: string[] = ['us-east-1', 'us-west-2', 'us-east-2', 'eu-central-1', 'eu-west-1'];
    availableRegions: { [key: string]: { description: string } } = {};
    profiles: Profile[] = [];
    currentProfile: string = '';

    constructor() {
        this.onDidChangeActiveProfileEvent((profile => {
            console.log('Active profile changed to:', profile);
        }));
    }
    async init() {
        this.loadRegions();
        await this.loadProfiles();
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
