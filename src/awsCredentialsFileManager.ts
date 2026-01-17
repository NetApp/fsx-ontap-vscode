import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { Logger, LogLevel } from './logger';

const AWS_DIR = path.join(os.homedir(), '.aws');
const CREDENTIALS_FILE = path.join(AWS_DIR, 'credentials');
const CONFIG_FILE = path.join(AWS_DIR, 'config');

export interface AccessKeyProfile {
    profileName: string;
    awsAccessKeyId: string;
    awsSecretAccessKey: string;
    region?: string;
}

export interface ValidationResult {
    valid: boolean;
    accountId?: string;
    arn?: string;
    userId?: string;
    error?: string;
}

/**
 * Parse INI file content into a map
 * Supports [profile name] sections
 */
function parseIniFile(content: string): Map<string, Map<string, string>> {
    const sections = new Map<string, Map<string, string>>();
    let currentSection = '';
    let currentSectionMap = new Map<string, string>();

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        // Section header: [section-name] or [profile section-name]
        const sectionMatch = trimmed.match(/^\[(?:profile\s+)?(.+)\]$/);
        if (sectionMatch) {
            // Save previous section
            if (currentSection) {
                sections.set(currentSection, currentSectionMap);
            }
            currentSection = trimmed; // Keep full section name including prefix
            currentSectionMap = new Map<string, string>();
            continue;
        }

        // Key-value pair
        const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
        if (kvMatch) {
            const key = kvMatch[1].trim();
            const value = kvMatch[2].trim();
            currentSectionMap.set(key, value);
        }
    }

    // Save last section
    if (currentSection) {
        sections.set(currentSection, currentSectionMap);
    }

    return sections;
}

/**
 * Convert INI map back to file content
 */
function serializeIniFile(sections: Map<string, Map<string, string>>, isConfigFile: boolean = false): string {
    const lines: string[] = [];
    
    for (const [sectionName, sectionMap] of sections.entries()) {
        // Config file uses [profile name], credentials file uses [name]
        if (isConfigFile && !sectionName.startsWith('profile ')) {
            lines.push(`[profile ${sectionName}]`);
        } else {
            lines.push(`[${sectionName}]`);
        }
        
        for (const [key, value] of sectionMap.entries()) {
            lines.push(`${key} = ${value}`);
        }
        
        lines.push(''); // Empty line between sections
    }

    return lines.join('\n');
}

/**
 * Ensure AWS directory exists
 */
function ensureAwsDir(): void {
    if (!fs.existsSync(AWS_DIR)) {
        fs.mkdirSync(AWS_DIR, { mode: 0o700 });
    }
}

/**
 * Read AWS credentials file
 * Keys are normalized (just the name, not the full [name] format)
 */
export function readAwsCredentialsFile(): Map<string, Map<string, string>> {
    try {
        if (!fs.existsSync(CREDENTIALS_FILE)) {
            return new Map();
        }
        const content = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
        const rawSections = parseIniFile(content);
        const normalizedSections = new Map<string, Map<string, string>>();
        
        // Normalize section names (remove brackets)
        for (const [sectionName, sectionData] of rawSections.entries()) {
            const normalizedName = normalizeSectionName(sectionName);
            normalizedSections.set(normalizedName, sectionData);
        }
        
        return normalizedSections;
    } catch (error) {
        Logger.log(`Error reading credentials file: ${(error as Error).message}`, LogLevel.Error, error as Error);
        throw error;
    }
}

/**
 * Write AWS credentials file
 */
export function writeAwsCredentialsFile(sections: Map<string, Map<string, string>>): void {
    try {
        ensureAwsDir();
        const content = serializeIniFile(sections, false);
        Logger.log(`Writing credentials file with ${sections.size} sections. Content preview: ${content.substring(0, 200)}`, LogLevel.Debug);
        fs.writeFileSync(CREDENTIALS_FILE, content, { mode: 0o600 });
        Logger.log(`Successfully wrote credentials file: ${CREDENTIALS_FILE}`, LogLevel.Info);
    } catch (error) {
        Logger.log(`Error writing credentials file: ${(error as Error).message}`, LogLevel.Error, error as Error);
        throw error;
    }
}

/**
 * Normalize section name - extract profile name from [profile name]
 */
function normalizeSectionName(sectionName: string): string {
    // Handle [profile name] or [name]
    const match = sectionName.match(/^\[(?:profile\s+)?(.+)\]$/);
    return match ? match[1] : sectionName;
}

/**
 * Read AWS config file
 * Keys are normalized (just the name, not the full [profile name] format)
 */
export function readAwsConfigFile(): Map<string, Map<string, string>> {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return new Map();
        }
        const content = fs.readFileSync(CONFIG_FILE, 'utf8');
        const rawSections = parseIniFile(content);
        const normalizedSections = new Map<string, Map<string, string>>();
        
        // Normalize section names
        for (const [sectionName, sectionData] of rawSections.entries()) {
            const normalizedName = normalizeSectionName(sectionName);
            normalizedSections.set(normalizedName, sectionData);
        }
        
        return normalizedSections;
    } catch (error) {
        Logger.log(`Error reading config file: ${(error as Error).message}`, LogLevel.Error, error as Error);
        throw error;
    }
}


/**
 * Write AWS config file
 */
export function writeAwsConfigFile(sections: Map<string, Map<string, string>>): void {
    try {
        ensureAwsDir();
        const content = serializeIniFile(sections, true);
        fs.writeFileSync(CONFIG_FILE, content, { mode: 0o600 });
    } catch (error) {
        Logger.log(`Error writing config file: ${(error as Error).message}`, LogLevel.Error, error as Error);
        throw error;
    }
}

/**
 * Validate access keys by calling AWS STS GetCallerIdentity
 */
export async function validateAccessKeys(accessKeyId: string, secretAccessKey: string, region: string = 'us-east-1'): Promise<ValidationResult> {
    try {
        const stsClient = new STSClient({
            region,
            credentials: {
                accessKeyId,
                secretAccessKey
            }
        });

        const command = new GetCallerIdentityCommand({});
        const response = await stsClient.send(command);

        return {
            valid: true,
            accountId: response.Account,
            arn: response.Arn,
            userId: response.UserId
        };
    } catch (error: any) {
        let errorMessage = 'Unknown error';
        if (error.message) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        }

        return {
            valid: false,
            error: errorMessage
        };
    }
}

/**
 * Validate profile name: only letters, digits, underscores, and hyphens
 */
function validateProfileName(profileName: string): void {
    if (!profileName || !profileName.trim()) {
        throw new Error('Profile name cannot be empty');
    }
    const trimmedName = profileName.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
        throw new Error('Profile name can only contain letters, digits, underscores (_), and hyphens (-)');
    }
}

/**
 * Create an access key profile
 */
export function createAccessKeyProfile(profile: AccessKeyProfile): void {
    // Trim and validate profile name
    const profileName = profile.profileName.trim();
    validateProfileName(profileName);
    
    Logger.log(`Creating access key profile: ${profileName}`, LogLevel.Info);
    const sections = readAwsCredentialsFile();
    const sectionMap = new Map<string, string>();
    sectionMap.set('aws_access_key_id', profile.awsAccessKeyId);
    sectionMap.set('aws_secret_access_key', profile.awsSecretAccessKey);
    if (profile.region) {
        sectionMap.set('region', profile.region);
    }
    sections.set(profileName, sectionMap);
    Logger.log(`Profile "${profileName}" added to sections map. Total sections: ${sections.size}`, LogLevel.Info);
    writeAwsCredentialsFile(sections);
    Logger.log(`Profile "${profileName}" written to credentials file: ${CREDENTIALS_FILE}`, LogLevel.Info);
}

export function createConfigProfile(profile: string): void {
    // Trim and validate profile name
    const profileName = profile.trim();
    validateProfileName(profileName);
    
    Logger.log(`Creating config profile: ${profileName}`, LogLevel.Info);
    const sections = readAwsConfigFile();
    const sectionMap = new Map<string, string>();
    
    sections.set(profileName, sectionMap);
    Logger.log(`Config profile "${profileName}" added to sections map. Total sections: ${sections.size}`, LogLevel.Info);
    writeAwsConfigFile(sections);
    Logger.log(`Config profile "${profileName}" written to config file: ${CONFIG_FILE}`, LogLevel.Info);
}   
/**
 * Update an existing profile
 */
export function updateProfile(profileName: string, profileData: AccessKeyProfile): void {
    // Delete existing profile first
    deleteProfile(profileName);
    
    // Create new profile
    createAccessKeyProfile(profileData);
}

/**
 * Delete a profile from both credentials and config files
 */
export function deleteProfile(profileName: string): void {
    // Delete from credentials file
    const credentialsSections = readAwsCredentialsFile();
    if (credentialsSections.has(profileName)) {
        credentialsSections.delete(profileName);
        writeAwsCredentialsFile(credentialsSections);
    }

    // Delete from config file
    const configSections = readAwsConfigFile();
    if (configSections.has(profileName)) {
        configSections.delete(profileName);
        writeAwsConfigFile(configSections);
    }
}

/**
 * Get profile details from credentials file
 */
export function getProfileDetails(profileName: string): { type: 'access-key' | 'unknown'; data: any } {
    // Check credentials file
    const credentialsSections = readAwsCredentialsFile();
    if (credentialsSections.has(profileName)) {
        const section = credentialsSections.get(profileName)!;
        return {
            type: 'access-key',
            data: {
                profileName,
                awsAccessKeyId: section.get('aws_access_key_id') || '',
                awsSecretAccessKey: section.get('aws_secret_access_key') || '',
                region: section.get('region')
            }
        };
    }

    return { type: 'unknown', data: null };
}

