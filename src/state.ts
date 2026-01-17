
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import * as vscode from 'vscode';
import * as fs from 'fs';
import path from 'path';
import { FsxTelemetryReporter } from './telemetryReporter';
import { Logger, LogLevel } from './logger';
import { readAwsCredentialsFile } from './awsCredentialsFileManager';

export type Profile = {
    profileName: string;
    error? : string;
}

class State {

    readonly onDidChangeActiveProfile = new vscode.EventEmitter<string | undefined>();
    readonly onDidChangeActiveProfileEvent = this.onDidChangeActiveProfile.event;

    readonly onDidChangeRegions = new vscode.EventEmitter<void>();
    readonly onDidChangeRegionsEvent = this.onDidChangeRegions.event;

    readonly onDidChangeProfiles = new vscode.EventEmitter<void>();
    readonly onDidChangeProfilesEvent = this.onDidChangeProfiles.event;

    private selectedRegions: string[] = [];
    public context: vscode.ExtensionContext = {} as vscode.ExtensionContext;
    availableRegions: { [key: string]: { description: string } } = {};
    profiles: Profile[] = [];
    currentProfile: string = '';
    currentAccessKeyId: string = '';
    currentSecretAccessKey: string = '';
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
        const profiles = readAwsCredentialsFile();
        
        // Get profiles from both config file and credentials file
        const credentialsFileKeys = (profiles|| {}).keys();
        
        // Merge and deduplicate profile names
        const allProfileKeys = Array.from(credentialsFileKeys);
        
        Logger.log(`All profiles: ${allProfileKeys.join(', ')}`, LogLevel.Info);
        console.log('All profiles:', allProfileKeys);
        
        await this.checkProfiles(allProfileKeys);
        
        // Try to load saved profile from configuration
        const savedProfile = this.context.globalState.get<string>('fsx-ontap-selected-profile', '');
        
        if (savedProfile) {
            // Check if saved profile exists and is valid
            const savedProfileInfo = this.profiles.find(p => p.profileName === savedProfile);
            if (savedProfileInfo && !savedProfileInfo.error) {
                this.setCurrentProfile(savedProfile);
                Logger.log(`Restored saved profile: ${savedProfile}`, LogLevel.Info);
            } else {
                // Saved profile is invalid or doesn't exist, clear it
                Logger.log(`Saved profile "${savedProfile}" is invalid or doesn't exist, clearing it`, LogLevel.Info);
                this.context.globalState.update('fsx-ontap-selected-profile', undefined);
                this.setCurrentProfile('');
            }
        }
        
        // If no profile is set, try to use the first valid profile
        if (!this.currentProfile) {
            const firstValidProfile = this.profiles.find(profile => !profile.error);
            if (firstValidProfile) {
                this.setCurrentProfile(firstValidProfile.profileName);
                // Save it for next time
                this.context.globalState.update('fsx-ontap-selected-profile', this.currentProfile);
                Logger.log(`Using first valid profile: ${this.currentProfile}`, LogLevel.Info);
            } else {
                // Fallback to 'default' if it exists and is valid
                const hasValidDefault = this.profiles.find(profile => profile.profileName === 'default' && !profile.error);
                if (hasValidDefault) {
                    this.setCurrentProfile(hasValidDefault.profileName);
                    this.context.globalState.update('fsx-ontap-selected-profile', this.currentProfile);
                }
            }
        }
        
        // Fire profile change event
        this.onDidChangeProfiles.fire();
    }
    
    setCurrentProfile(profileName: string) {
        this.currentProfile = profileName;
        const credentialsSections = readAwsCredentialsFile();
        const profileSection = credentialsSections.get(profileName);
        if (!profileSection) {
            this.currentAccessKeyId = '';
            this.currentSecretAccessKey = '';
            return;
        }
        this.currentAccessKeyId = profileSection.get('aws_access_key_id') || '';
        this.currentSecretAccessKey = profileSection.get('aws_secret_access_key') || '';
        // Save to configuration
        if (this.context && this.context.globalState) {
            this.context.globalState.update('fsx-ontap-selected-profile', profileName);
            Logger.log(`Saved selected profile to configuration: ${profileName}`, LogLevel.Info);
        }
        this.onDidChangeActiveProfile.fire(profileName);
    }

    private async checkProfiles(profiles: string[]) {
        // Read credentials file directly to bypass AWS SDK credential provider cache
        const credentialsSections = readAwsCredentialsFile();
        
        for (const profile of profiles) {
            try {
                // Get credentials directly from the file to bypass SDK caching
                const profileSection = credentialsSections.get(profile);
                if (!profileSection) {
                    // Profile not found in credentials file
                    this.profiles.push({ profileName: profile, error: 'Profile not found in credentials file' });
                    continue;
                }
                
                const accessKeyId = profileSection.get('aws_access_key_id');
                const secretAccessKey = profileSection.get('aws_secret_access_key');
                
                if (!accessKeyId || !secretAccessKey) {
                    this.profiles.push({ profileName: profile, error: 'Missing access key ID or secret access key' });
                    continue;
                }
                
                // Use explicit credentials to bypass credential provider cache
                const stsClient = new STSClient({
                    region: "us-east-1",
                    credentials: {
                        accessKeyId: accessKeyId,
                        secretAccessKey: secretAccessKey
                    }
                });
                
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
            Logger.log('Error reading regions file:', LogLevel.Error, error as Error);
            console.error('Error reading regions file:', error);
            this.availableRegions = {};
        }
    }
}

export const state = new State();   
