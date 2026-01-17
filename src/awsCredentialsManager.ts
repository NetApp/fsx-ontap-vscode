import * as vscode from 'vscode';
import { state } from './state';
import {
    readAwsCredentialsFile,
    createAccessKeyProfile,
    deleteProfile as deleteProfileFromFile,
    getProfileDetails,
    validateAccessKeys,
    AccessKeyProfile,
    createConfigProfile
} from './awsCredentialsFileManager';
import { Logger, LogLevel } from './logger';
import { select_profile } from './telemetryReporter';

export class AwsCredentialsManager {
    public static readonly viewType = 'netapp-fsx-ontap.aws-credentials-manager';
    private static currentPanel: vscode.WebviewPanel | undefined = undefined;

    public static createOrShow(context: vscode.ExtensionContext): void {
        console.log('AwsCredentialsManager.createOrShow called');
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (AwsCredentialsManager.currentPanel) {
            console.log('Revealing existing panel');
            AwsCredentialsManager.currentPanel.reveal(column);
            return;
        }

        console.log('Creating new webview panel...');
        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            AwsCredentialsManager.viewType,
            'AWS Credentials Manager',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [context.extensionUri],
                retainContextWhenHidden: true
            }
        );

        console.log('Panel created, setting up message handler...');
        AwsCredentialsManager.currentPanel = panel;
        const manager = new AwsCredentialsManager(context, panel);

        // Set HTML first (like WelcomeEditor does)
        console.log('Setting webview HTML...');
        const htmlContent = manager.getHtmlForWebview(panel.webview);
        panel.webview.html = htmlContent;
        console.log('HTML set, registering message handler...');

        // Handle messages from the webview - exactly like WelcomeEditor pattern
        panel.webview.onDidReceiveMessage(async (data) => {
            console.log('=== RECEIVED MESSAGE FROM WEBVIEW ===');
            console.log('Message data:', JSON.stringify(data, null, 2));
            Logger.log(`Received message from webview: ${JSON.stringify(data)}`, LogLevel.Info);
            try {
                // Support both 'command' and 'type' for compatibility
                const command = data.command || data.type;
                
                switch (command) {
                    case 'test':
                        console.log('Received test message from webview:', data.message);
                        break;
                    case 'ready':
                        console.log('Webview ready, loading profiles...');
                        await manager.loadProfiles(panel.webview);
                        break;
                    case 'loadProfiles':
                        await manager.loadProfiles(panel.webview);
                        break;
                    case 'validateCredentials':
                        await manager.validateCredentials(panel.webview, data.accessKeyId, data.secretAccessKey, data.region);
                        break;
                    case 'saveProfile':
                        await manager.saveProfile(panel.webview, data.profile);
                        break;
                    case 'deleteProfile':
                        // Show confirmation dialog first
                        const confirmDelete = await vscode.window.showWarningMessage(
                            `Are you sure you want to delete profile "${data.profileName}"?`,
                            { modal: true },
                            'Delete'
                        );
                        if (confirmDelete === 'Delete') {
                            // Notify webview that deletion is starting
                            panel.webview.postMessage({
                                command: 'profileDeletionStarted',
                                profileName: data.profileName
                            });
                            await manager.deleteProfile(panel.webview, data.profileName);
                        }
                        break;
                    case 'getProfileDetails':
                        await manager.getProfileDetails(panel.webview, data.profileName);
                        break;
                    case 'selectProfile':
                        await manager.selectProfile(panel.webview, data.profileName);
                        break;
                    default:
                        console.warn('Unknown message command:', command);
                }
            } catch (error) {
                console.error('Error handling webview message:', error);
                Logger.log(`Error handling webview message: ${(error as Error).message}`, LogLevel.Error, error as Error);
            }
        }, null, context.subscriptions);

        // Clean up when panel is closed
        panel.onDidDispose(
            () => {
                AwsCredentialsManager.currentPanel = undefined;
            },
            null,
            context.subscriptions
        );
    }

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly panel: vscode.WebviewPanel
    ) {}

    private async loadProfiles(webview: vscode.Webview): Promise<void> {
        try {
            // Reload profiles in state to get validation status
            await state.loadProfiles();
            
            const profiles: Array<{ 
                name: string; 
                type: string; 
                hasError: boolean; 
                isCurrent: boolean; 
                error?: string;
            }> = [];

            // Get profiles from credentials file
            const credentialsSections = readAwsCredentialsFile();
            for (const profileName of credentialsSections.keys()) {
                const stateProfile = state.profiles.find(p => p.profileName === profileName);
                profiles.push({ 
                    name: profileName, 
                    type: 'access-key', 
                    hasError: !!stateProfile?.error,
                    isCurrent: profileName === state.currentProfile,
                    error: stateProfile?.error
                });
            }


            Logger.log(`Loading ${profiles.length} profiles, current profile: "${state.currentProfile}"`, LogLevel.Info);
            console.log('Loading profiles:', profiles.map(p => `${p.name} (${p.type}, current: ${p.isCurrent})`));
            console.log('Current profile from state:', state.currentProfile);
            
            webview.postMessage({
                command: 'profilesLoaded',
                profiles,
                currentProfile: state.currentProfile || ''
            });
        } catch (error) {
            Logger.log(`Error loading profiles: ${(error as Error).message}`, LogLevel.Error, error as Error);
            webview.postMessage({
                command: 'error',
                message: `Failed to load profiles: ${(error as Error).message}`
            });
        }
    }

    private async validateCredentials(webview: vscode.Webview, accessKeyId: string, secretAccessKey: string, region: string): Promise<void> {
        try {
            const result = await validateAccessKeys(accessKeyId, secretAccessKey, region);
            webview.postMessage({
                command: 'validationResult',
                result
            });
        } catch (error) {
            webview.postMessage({
                command: 'validationResult',
                result: {
                    valid: false,
                    error: (error as Error).message
                }
            });
        }
    }

    private async saveProfile(webview: vscode.Webview, profile: any): Promise<void> {
        try {
            Logger.log(`Saving profile. Type: ${profile.type}, Name: "${profile.profileName}"`, LogLevel.Info);
            if (profile.type === 'access-key') {
                // Trim profile name to avoid whitespace issues
                const profileName = (profile.profileName || '').trim();
                if (!profileName) {
                    throw new Error('Profile name is required');
                }
                createAccessKeyProfile({
                    profileName: profileName,
                    awsAccessKeyId: profile.awsAccessKeyId,
                    awsSecretAccessKey: profile.awsSecretAccessKey,
                    region: profile.region
                });

                createConfigProfile(profileName);
            }

            // Reload profiles in state
            await state.loadProfiles();
            
            // Notify webview
            webview.postMessage({
                command: 'profileSaved',
                profileName: profile.profileName
            });

            // Reload profiles list
            await this.loadProfiles(webview);

            vscode.window.showInformationMessage(`Profile "${profile.profileName}" saved successfully`);
        } catch (error) {
            Logger.log(`Error saving profile: ${(error as Error).message}`, LogLevel.Error, error as Error);
            webview.postMessage({
                command: 'error',
                message: `Failed to save profile: ${(error as Error).message}`
            });
            vscode.window.showErrorMessage(`Failed to save profile: ${(error as Error).message}`);
        }
    }

    private async deleteProfile(webview: vscode.Webview, profileName: string): Promise<void> {
        try {
            // Delete the profile from files
            deleteProfileFromFile(profileName);
            
            // If this was the current profile, clear it
            if (state.currentProfile === profileName) {
                state.currentProfile = '';
                // Clear from configuration
                if (state.context && state.context.globalState) {
                    state.context.globalState.update('fsx-ontap-selected-profile', undefined);
                }
                state.onDidChangeActiveProfile.fire(undefined);
            }
            
            // Reload profiles in state
            await state.loadProfiles();
            
            // Reload profiles list in webview
            await this.loadProfiles(webview);

            // Notify webview that deletion is complete
            webview.postMessage({
                command: 'profileDeleted',
                profileName
            });

            vscode.window.showInformationMessage(`Profile "${profileName}" deleted successfully`);
        } catch (error) {
            Logger.log(`Error deleting profile: ${(error as Error).message}`, LogLevel.Error, error as Error);
            webview.postMessage({
                command: 'error',
                message: `Failed to delete profile: ${(error as Error).message}`
            });
            vscode.window.showErrorMessage(`Failed to delete profile: ${(error as Error).message}`);
        }
    }

    private async getProfileDetails(webview: vscode.Webview, profileName: string): Promise<void> {
        try {
            const details = getProfileDetails(profileName);
            webview.postMessage({
                command: 'profileDetails',
                profileName,
                details
            });
        } catch (error) {
            Logger.log(`Error getting profile details: ${(error as Error).message}`, LogLevel.Error, error as Error);
            webview.postMessage({
                command: 'error',
                message: `Failed to get profile details: ${(error as Error).message}`
            });
        }
    }

    private async selectProfile(webview: vscode.Webview, profileName: string): Promise<void> {
        try {
            Logger.log(`Selecting profile: ${profileName}`, LogLevel.Info);
            console.log('selectProfile called with:', profileName);
            console.log('Current state.currentProfile:', state.currentProfile);
            
            // Notify webview that selection is starting
            webview.postMessage({
                command: 'profileSelectionStarted',
                profileName
            });
            
            const profileInfo = state.profiles.find(p => p.profileName === profileName);
            console.log('Profile info found:', profileInfo ? 'yes' : 'no', profileInfo);
            
            // Check if profile has errors (only if we found it in state)
            if (profileInfo?.error) {
                webview.postMessage({
                    command: 'profileSelectionResult',
                    success: false,
                    profileName,
                    error: `Profile has errors: ${profileInfo.error}`
                });
                return;
            }
            
            // Set as current profile (this will also save it to configuration)
            state.setCurrentProfile(profileName);
            console.log('Profile set, new state.currentProfile:', state.currentProfile);
            state.reporter.sendTelemetryEvent(select_profile, { profile: state.currentProfile });
            
            // Reload profiles in webview to update UI
            await this.loadProfiles(webview);
            console.log('Profiles reloaded in webview');
            
            webview.postMessage({
                command: 'profileSelectionResult',
                success: true,
                profileName
            });
            
            vscode.window.showInformationMessage(`Selected AWS profile: ${profileName}`);
        } catch (error) {
            Logger.log(`Error selecting profile: ${(error as Error).message}`, LogLevel.Error, error as Error);
            webview.postMessage({
                command: 'profileSelectionResult',
                success: false,
                profileName,
                error: `Failed to select profile: ${(error as Error).message}`
            });
        }
    }


    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AWS Credentials Manager</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        
        .header {
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header h1 {
            margin: 0;
            font-size: 20px;
        }
        
        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 8px;
        }
        
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: white;
        }
        
        .btn-danger:hover {
            opacity: 0.8;
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .profiles-list {
            margin-bottom: 20px;
        }
        
        .profile-item {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .profile-info {
            flex: 1;
        }
        
        .profile-name {
            font-weight: 600;
            margin-bottom: 4px;
        }
        
        .profile-type {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        
        .profile-actions {
            display: flex;
            gap: 8px;
        }
        
        .form-container {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 20px;
        }
        
        .profile-item.current {
            border: 2px solid var(--vscode-focusBorder);
        }
        
        .profile-error {
            color: var(--vscode-errorForeground);
            font-size: 11px;
            margin-top: 4px;
        }
        
        .profile-current {
            color: var(--vscode-textLink-foreground);
            font-size: 11px;
            margin-top: 4px;
            font-weight: 600;
        }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 4px;
            font-size: 12px;
            font-weight: 500;
        }
        
        .form-group input,
        .form-group select {
            width: 100%;
            padding: 6px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-size: 12px;
            box-sizing: border-box;
        }
        
        .form-group input:focus,
        .form-group select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        
        .validation-result {
            margin-top: 8px;
            padding: 8px;
            border-radius: 4px;
            font-size: 11px;
        }
        
        .validation-success {
            background-color: rgba(0, 200, 0, 0.1);
            color: var(--vscode-textBlockQuote-background);
            border: 1px solid rgba(0, 200, 0, 0.3);
        }
        
        .validation-error {
            background-color: rgba(200, 0, 0, 0.1);
            color: var(--vscode-errorForeground);
            border: 1px solid rgba(200, 0, 0, 0.3);
        }
        
        .validation-loading {
            color: var(--vscode-descriptionForeground);
        }
        
        .hidden {
            display: none;
        }
        
        .error-message {
            color: var(--vscode-errorForeground);
            margin-top: 8px;
            font-size: 11px;
        }
        
        .form-actions {
            display: flex;
            gap: 8px;
            margin-top: 16px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>AWS Credentials Manager</h1>
        <button class="btn" id="addProfileBtn">Add New Profile</button>
    </div>
    
    <div id="contentArea">
        <div class="profiles-list" id="profilesList">
            <p>Loading profiles...</p>
        </div>
        
        <div class="form-container hidden" id="profileForm">
        <h2 id="formTitle">Add New Profile</h2>
        
        <div class="form-group">
            <label for="profileName">Profile Name</label>
            <input type="text" id="profileName" placeholder="e.g., my-profile" required>
            <div id="profileNameError" class="error-message" style="display: none;"></div>
        </div>
        
        <!-- Access Key Fields -->
        <div id="accessKeyFields">
            <div class="form-group">
                <label for="accessKeyId">Access Key ID</label>
                <input type="text" id="accessKeyId" placeholder="AKIAIOSFODNN7EXAMPLE">
            </div>
            
            <div class="form-group">
                <label for="secretAccessKey">Secret Access Key</label>
                <input type="password" id="secretAccessKey" placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY">
            </div>
            
            <div class="form-group">
                <label for="region">Region (optional)</label>
                <input type="text" id="region" placeholder="us-east-1">
            </div>
            
            <div class="form-group">
                <button class="btn btn-secondary" id="validateBtn">Validate Credentials</button>
                <div id="validationResult"></div>
            </div>
        </div>
        
        <div class="form-actions">
            <button class="btn" id="saveBtn">Save Profile</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>
    </div>
    
    <script nonce="${nonce}">
        console.log('Script tag is executing!');
        const vscode = acquireVsCodeApi();
        console.log('acquireVsCodeApi() called, vscode object:', vscode);
        vscode.postMessage({ command: 'test', message: 'Script is running!' });
        console.log('Test message posted to extension');
        
        let currentEditingProfile = null;
        let validationState = { validated: false, valid: false };
        
        // DOM element references (will be set in initialize)
        let profilesList, profileForm, addProfileBtn, saveBtn, cancelBtn, validateBtn, validationResult;
        let accessKeyFields;
        let profileNameInput, profileNameError;
        
        // Helper function to check if profile name is valid
        function isProfileNameValid(profileName) {
            const trimmed = profileName.trim();
            return trimmed.length > 0 && /^[a-zA-Z0-9_-]+$/.test(trimmed);
        }
        
        // Function to update button states based on profile name validity
        function updateButtonStates() {
            if (!profileNameInput || !validateBtn || !saveBtn) return;
            const profileName = profileNameInput.value.trim();
            const isValid = isProfileNameValid(profileName);
            
            // Disable validate and save buttons if profile name is invalid
            validateBtn.disabled = !isValid;
            saveBtn.disabled = !isValid || !validationState.validated || !validationState.valid;
        }
        
        // Wait for DOM to be ready
        function initialize() {
            // DOM elements
            profilesList = document.getElementById('profilesList');
            profileForm = document.getElementById('profileForm');
            addProfileBtn = document.getElementById('addProfileBtn');
            saveBtn = document.getElementById('saveBtn');
            cancelBtn = document.getElementById('cancelBtn');
            validateBtn = document.getElementById('validateBtn');
            validationResult = document.getElementById('validationResult');
            
            // Field containers
            accessKeyFields = document.getElementById('accessKeyFields');
            
            // Get profile name input element
            profileNameInput = document.getElementById('profileName');
            profileNameError = document.getElementById('profileNameError');
            
            if (!profilesList || !profileForm || !addProfileBtn || !saveBtn || !cancelBtn || !validateBtn || !validationResult || !accessKeyFields) {
                console.error('Failed to find required DOM elements');
                return;
            }
            
            // Event listeners
            addProfileBtn.addEventListener('click', () => {
                currentEditingProfile = null;
                document.getElementById('formTitle').textContent = 'Add New Profile';
                resetForm();
                profilesList.classList.add('hidden');
                profileForm.classList.remove('hidden');
            });
        
            cancelBtn.addEventListener('click', () => {
                profileForm.classList.add('hidden');
                profilesList.classList.remove('hidden');
                resetForm();
                currentEditingProfile = null;
            });
            
            validateBtn.addEventListener('click', async () => {
            if (!profileNameInput) return;
            const profileName = profileNameInput.value.trim();
            
            // Check if profile name is valid before allowing validation
            if (!isProfileNameValid(profileName)) {
                showError('Please enter a valid profile name before validating credentials');
                return;
            }
            
            const accessKeyId = document.getElementById('accessKeyId').value;
            const secretAccessKey = document.getElementById('secretAccessKey').value;
            const region = document.getElementById('region').value || 'us-east-1';
            
            if (!accessKeyId || !secretAccessKey) {
                showError('Please enter both Access Key ID and Secret Access Key');
                return;
            }
            
            validateBtn.disabled = true;
            validationResult.innerHTML = '<div class="validation-loading">Validating credentials...</div>';
            
                vscode.postMessage({
                    command: 'validateCredentials',
                    accessKeyId,
                    secretAccessKey,
                    region
                });
            });
            
            saveBtn.addEventListener('click', () => {
            const profileName = document.getElementById('profileName').value.trim();
            
            if (!profileName) {
                showError('Profile name is required');
                return;
            }
            
            // Validate profile name: only letters, digits, underscores, and hyphens
            if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
                showError('Profile name can only contain letters, digits, underscores (_), and hyphens (-)');
                return;
            }
            
            const accessKeyId = document.getElementById('accessKeyId').value;
            const secretAccessKey = document.getElementById('secretAccessKey').value;
            const region = document.getElementById('region').value;
            
            if (!accessKeyId || !secretAccessKey) {
                showError('Access Key ID and Secret Access Key are required');
                return;
            }
            
            // Always require validation for access-key profiles
            if (!validationState.validated || !validationState.valid) {
                showError('Please validate credentials before saving');
                return;
            }
            
            const profile = {
                type: 'access-key',
                profileName,
                awsAccessKeyId: accessKeyId,
                awsSecretAccessKey: secretAccessKey,
                region: region || undefined
            };
            
                vscode.postMessage({
                    command: 'saveProfile',
                    profile
                });
            });
            
            // Handle messages from extension
            window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'profilesLoaded':
                    console.log('Received profilesLoaded:', message.profiles.length, 'profiles, current:', message.currentProfile);
                    displayProfiles(message.profiles, message.currentProfile);
                    break;
                case 'validationResult':
                    handleValidationResult(message.result);
                    break;
                case 'profileSaved':
                    // Don't set visibility here - let displayProfiles handle it based on profile count
                    resetForm();
                    currentEditingProfile = null;
                    break;
                case 'profileDetails':
                    profilesList.classList.add('hidden');
                    profileForm.classList.remove('hidden');
                    loadProfileForEditing(message.details);
                    break;
                case 'profileSelectionStarted':
                    // Show loading state on the select button
                    const selectButton = profilesList.querySelector('button[data-action="select"][data-profile="' + message.profileName + '"]');
                    if (selectButton) {
                        selectButton.disabled = true;
                        selectButton.textContent = 'Selecting...';
                    }
                    break;
                case 'profileDeletionStarted':
                    // Show loading state on the delete button
                    const deleteButton = profilesList.querySelector('button[data-action="delete"][data-profile="' + message.profileName + '"]');
                    if (deleteButton) {
                        deleteButton.disabled = true;
                        deleteButton.textContent = 'Deleting...';
                    }
                    break;
                case 'profileSelectionResult':
                    // Reset button state - profiles will be reloaded, so we don't need to manually reset
                    if (message.success) {
                        // Profile selected successfully, profiles will be reloaded by loadProfiles
                        // The UI will update when profilesLoaded message is received
                    } else {
                        // Reset the button on error
                        const errorButton = profilesList.querySelector('button[data-action="select"][data-profile="' + message.profileName + '"]');
                        if (errorButton) {
                            errorButton.disabled = false;
                            errorButton.textContent = 'Select';
                        }
                        showError(message.error || 'Failed to select profile');
                    }
                    break;
                case 'profileDeleted':
                    // Profiles have already been reloaded by loadProfiles, but we can show a confirmation
                    // The profilesLoaded message will have already updated the UI
                    break;
                case 'error':
                    showError(message.message);
                    break;
                }
            });
            
            // Set up event delegation for profile action buttons (only once)
            profilesList.addEventListener('click', (e) => {
                const button = e.target.closest('button[data-action]');
                if (!button || button.disabled) return;
                
                const action = button.getAttribute('data-action');
                const profileName = button.getAttribute('data-profile');
                
                if (action === 'select') {
                    console.log('Select button clicked for profile:', profileName);
                    if (!profileName) {
                        console.error('Profile name is missing!');
                        return;
                    }
                    vscode.postMessage({
                        command: 'selectProfile',
                        profileName: profileName
                    });
                } else if (action === 'edit') {
                    editProfile(profileName);
                } else if (action === 'delete') {
                    deleteProfileConfirm(profileName);
                }
            });
            
            // Initialize
            updateFormFields();
            
            // Add real-time validation for profile name (after all elements are ready)
            if (profileNameInput && profileNameError) {
                profileNameInput.addEventListener('input', () => {
                    const profileName = profileNameInput.value.trim();
                    if (profileName && !/^[a-zA-Z0-9_-]+$/.test(profileName)) {
                        profileNameError.textContent = 'Profile name can only contain letters, digits, underscores (_), and hyphens (-)';
                        profileNameError.style.display = 'block';
                    } else {
                        profileNameError.style.display = 'none';
                    }
                    // Update button states when profile name changes
                    updateButtonStates();
                });
            }
            
            // Disable buttons initially (will be enabled when profile name is valid)
            updateButtonStates();
            
            // Notify extension that webview is ready
            console.log('Sending ready message to extension');
            vscode.postMessage({
                command: 'ready'
            });
            console.log('Ready message sent');
        }
        
        function displayProfiles(profiles, currentProfile) {
            console.log('displayProfiles called with', profiles.length, 'profiles, currentProfile:', currentProfile);
            console.log('Profiles:', profiles.map(p => ({ name: p.name, type: p.type, isCurrent: p.isCurrent })));
            
            if (profiles.length === 0) {
                // If no profiles, automatically show the add profile form
                profilesList.classList.add('hidden');
                profileForm.classList.remove('hidden');
                document.getElementById('formTitle').textContent = 'Add New Profile';
                currentEditingProfile = null;
                resetForm();
                return;
            }
            
            // If we have profiles, make sure the list is visible and form is hidden
            profilesList.classList.remove('hidden');
            profileForm.classList.add('hidden');
            
            profilesList.innerHTML = profiles.map(profile => {
                const typeLabel = 'Access Key';
                
                // Escape HTML entities for display
                const escapedName = profile.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                // Check if this is the current profile - be more explicit
                // profile.isCurrent is set in loadProfiles based on state.currentProfile
                const isCurrent = profile.isCurrent === true || (currentProfile && currentProfile.length > 0 && profile.name === currentProfile);
                const hasError = profile.hasError || !!profile.error;
                const errorMessage = profile.error ? profile.error.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
                const selectDisabled = hasError || isCurrent;
                const selectTitle = hasError ? 'Profile has errors' : (isCurrent ? 'Already selected profile' : '');
                
                return '<div class="profile-item' + (isCurrent ? ' current' : '') + '">' +
                    '<div class="profile-info">' +
                    '<div class="profile-name">' + escapedName + '</div>' +
                    '<div class="profile-type">' + typeLabel + '</div>' +
                    (isCurrent ? '<div class="profile-current">✓ Currently Selected</div>' : '') +
                    (hasError ? '<div class="profile-error">✗ Error: ' + errorMessage + '</div>' : '') +
                    '</div>' +
                    '<div class="profile-actions">' +
                    '<button class="btn" data-action="select" data-profile="' + escapedName + '"' + (selectDisabled ? ' disabled' : '') + (selectTitle ? ' title="' + selectTitle + '"' : '') + '>Select</button>' +
                   
                    '</div>' +
                    '</div>';
            }).join('');
        }
        
        function updateFormFields() {
            accessKeyFields.classList.remove('hidden');
            resetValidation();
        }
        
        function resetForm() {
            document.getElementById('profileName').value = '';
            const profileNameError = document.getElementById('profileNameError');
            if (profileNameError) {
                profileNameError.style.display = 'none';
            }
            document.getElementById('accessKeyId').value = '';
            document.getElementById('secretAccessKey').value = '';
            document.getElementById('region').value = '';
            updateFormFields();
            resetValidation();
        }
        
        function resetValidation() {
            validationState = { validated: false, valid: false };
            validationResult.innerHTML = '';
            // Update button states based on profile name validity
            updateButtonStates();
        }
        
        function handleValidationResult(result) {
            validateBtn.disabled = false;
            validationState.validated = true;
            validationState.valid = result.valid;
            
            // Update button states - save button should be enabled only if profile name is valid AND credentials are valid
            updateButtonStates();
            
            if (result.valid) {
                validationResult.innerHTML = '<div class="validation-result validation-success">' +
                    '<strong>✓ Valid</strong><br>' +
                    'Account ID: ' + result.accountId + '<br>' +
                    'ARN: ' + result.arn + '<br>' +
                    'User ID: ' + result.userId +
                    '</div>';
            } else {
                validationResult.innerHTML = '<div class="validation-result validation-error">' +
                    '<strong>✗ Invalid</strong><br>' +
                    'Error: ' + result.error +
                    '</div>';
            }
        }
        
        function editProfile(profileName) {
            currentEditingProfile = null;
            document.getElementById('formTitle').textContent = 'Edit Profile';
            vscode.postMessage({
                command: 'getProfileDetails',
                profileName
            });
            profileForm.classList.remove('hidden');
        }
        
        function loadProfileForEditing(details) {
            if (details.type === 'unknown' || !details.data) {
                showError('Could not load profile details');
                return;
            }
            
            const data = details.data;
            document.getElementById('profileName').value = data.profileName;
            // Hide any error message when loading existing profile
            if (profileNameError) {
                profileNameError.style.display = 'none';
            }
            updateFormFields();
            
            if (details.type === 'access-key') {
                document.getElementById('accessKeyId').value = data.awsAccessKeyId || '';
                document.getElementById('secretAccessKey').value = data.awsSecretAccessKey || '';
                document.getElementById('region').value = data.region || '';
                currentEditingProfile = {
                    awsAccessKeyId: data.awsAccessKeyId,
                    awsSecretAccessKey: data.awsSecretAccessKey
                };
                // Reset validation and update button states
                resetValidation();
                // Update button states after loading profile (profile name should be valid for existing profiles)
                updateButtonStates();
            }
        }
        
        function deleteProfileConfirm(profileName) {
            // Send message to extension to show confirmation dialog
            vscode.postMessage({
                command: 'deleteProfile',
                profileName: profileName
            });
        }
        
        function showError(message) {
            // Simple error display - could be enhanced
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = message;
            profileForm.appendChild(errorDiv);
            setTimeout(() => errorDiv.remove(), 5000);
        }
        
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initialize);
        } else {
            initialize();
        }
    </script>
</body>
</html>`;
        
        console.log('Generated HTML length:', html.length);
        console.log('Nonce used:', nonce);
        console.log('HTML contains script tag:', html.includes('<script'));
        return html;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

