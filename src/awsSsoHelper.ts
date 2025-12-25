import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { Logger, LogLevel } from './logger';

/**
 * Checks if a profile is an SSO profile by examining the config file
 */
export async function isSsoProfile(profileName: string): Promise<boolean> {
    try {
        const configFiles = await loadSharedConfigFiles();
        const profileConfig = configFiles.configFile?.[profileName];
        
        // SSO profiles have sso_start_url in their config
        return !!(profileConfig && 'sso_start_url' in profileConfig);
    } catch (error) {
        Logger.log(`Error checking if profile ${profileName} is SSO: ${(error as Error).message}`, LogLevel.Error, error as Error);
        console.error(`Error checking if profile ${profileName} is SSO:`, error);
        return false;
    }
}

/**
 * Checks if an SSO profile needs login by attempting to use it
 */
export async function needsSsoLogin(profileName: string): Promise<boolean> {
    try {
        const stsClient = new STSClient({ region: "us-east-1", profile: profileName });
        const command = new GetCallerIdentityCommand({});
        await stsClient.send(command);
        return false; // Profile works, no login needed
    } catch (error: any) {
        const errorMessage = error.message || '';
        // Common SSO-related error messages
        const ssoErrorIndicators = [
            'Unable to locate credentials',
            'The SSO session associated with this profile has expired',
            'The SSO session has expired or is invalid',
            'Token has expired',
            'does not exist',
            'not found'
        ];
        
        return ssoErrorIndicators.some(indicator => 
            errorMessage.toLowerCase().includes(indicator.toLowerCase())
        );
    }
}

/**
 * Executes AWS SSO login for a given profile
 * Opens a browser for user authentication
 */
export async function performSsoLogin(profileName: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
        const output: string[] = [];
        const errors: string[] = [];

        vscode.window.showInformationMessage(`Initiating AWS SSO login for profile: ${profileName}...`);

        const loginProcess: ChildProcess = spawn('aws', ['sso', 'login', '--profile', profileName], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: process.env
        });

        loginProcess.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            output.push(text);
            Logger.log(`AWS SSO login stdout: ${text}`, LogLevel.Info);
            console.log(`AWS SSO login stdout: ${text}`);
        });

        loginProcess.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            errors.push(text);
            Logger.log(`AWS SSO login stderr: ${text}`, LogLevel.Error);
            console.error(`AWS SSO login stderr: ${text}`);
        });

        loginProcess.on('error', (error: Error) => {
            resolve({
                success: false,
                message: `Failed to start AWS SSO login process: ${error.message}`
            });
        });

        loginProcess.on('close', (code: number | null) => {
            const allOutput = output.join('');
            const allErrors = errors.join('');

            if (code === 0) {
                // Success - verify the login worked
                setTimeout(async () => {
                    const needsLogin = await needsSsoLogin(profileName);
                    if (!needsLogin) {
                        resolve({
                            success: true,
                            message: `Successfully logged in to AWS SSO for profile: ${profileName}`
                        });
                    } else {
                        resolve({
                            success: false,
                            message: `Login completed but profile still not accessible. Please check your SSO configuration.`
                        });
                    }
                }, 2000); // Wait 2 seconds for credentials to be written
            } else {
                // Check if it's a user cancellation (browser closed, etc.)
                if (allOutput.includes('Success') || allOutput.includes('successfully')) {
                    resolve({
                        success: true,
                        message: `AWS SSO login completed for profile: ${profileName}`
                    });
                } else {
                    resolve({
                        success: false,
                        message: `AWS SSO login failed (exit code: ${code}). ${allErrors || allOutput}`
                    });
                }
            }
        });
    });
}

/**
 * Checks if a profile is SSO and needs login, then performs login if needed
 */
export async function ensureSsoLogin(profileName: string): Promise<{ success: boolean; message: string }> {
    const isSso = await isSsoProfile(profileName);
    
    if (!isSso) {
        return {
            success: true,
            message: `Profile ${profileName} is not an SSO profile.`
        };
    }

    const needsLogin = await needsSsoLogin(profileName);
    
    if (!needsLogin) {
        return {
            success: true,
            message: `SSO profile ${profileName} is already logged in.`
        };
    }

    // Show progress notification
    const progressOptions: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: `AWS SSO Login`,
        cancellable: false
    };

    return await vscode.window.withProgress(progressOptions, async (progress) => {
        progress.report({ message: `Logging in to AWS SSO for profile: ${profileName}...` });
        
        // Perform the login
        const result = await performSsoLogin(profileName);
        
        if (result.success) {
            progress.report({ message: `Login successful!` });
        } else {
            progress.report({ message: `Login failed: ${result.message}` });
        }
        
        return result;
    });
}

