import { getTelemetryConfig, isTelemetryEnabled } from "./telemetryKey";
import * as vscode from 'vscode';
import { TelemetryReporter } from '@vscode/extension-telemetry';
import { state } from "./state";
import { TelemetryExternalReporter } from "./telemetryExternalReporter";

export const create_svm_success = 'create-svm-success';
export const create_svm_failure = 'create-svm-failure';
export const create_volume_success = 'create-volume-success';
export const create_volume_failure = 'create-volume-failure';
export const copilot_question = 'copilot-question';
export const copilot_filesystem_question = 'copilot-filesystem-question';
export const ssh_to_fs = 'ssh-to-fs';
export const create_snapshot_success = 'create-snapshot-success';
export const create_snapshot_failure = 'create-snapshot-failure';
export const select_profile = 'select-profile';
export const extension_activated = 'extension-activated';
export const extension_deactivated = 'extension-deactivated';

export class FsxTelemetryReporter {

    private reporter: TelemetryReporter | undefined;
    private telemetryEnabled: boolean = false;
    private externalReporter: TelemetryExternalReporter = new TelemetryExternalReporter();
    
    constructor() {
        this.telemetryEnabled = isTelemetryEnabled();
        if (!this.telemetryEnabled) {
            console.log('Telemetry is disabled - no telemetry key configured');
        }
    }

    public activate(context: vscode.ExtensionContext) {
        if (!this.telemetryEnabled) {
            console.log('Skipping telemetry initialization - telemetry disabled');
            return;
        }
        
        const config = getTelemetryConfig();
        if (config && config.key) {
            this.reporter = new TelemetryReporter(config.key);
            context.subscriptions.push(this.reporter);
            console.log('Telemetry initialized successfully');
        } else {
            console.warn('Failed to initialize telemetry - invalid configuration');
        }
    }

    public sendTelemetryEvent(eventName: string, properties?: { [key: string]: string  }, measurements?: { [key: string]: number }) {
        if (!this.telemetryEnabled || !this.reporter) {
            // Optionally log to console in development
            if (process.env.NODE_ENV === 'development') {
                console.log(`[Telemetry] ${eventName}`, { properties, measurements });
            }
            return;
        }
        
        const company = vscode.workspace.getConfiguration('netapp-fsx-ontap').get('company',"");
        try {
            const baseProperties = {
                userId: state.userId,
                sessionId: vscode.env.sessionId,
                company: company
            };
            properties = { ...baseProperties, ...properties };
            this.reporter.sendTelemetryEvent(eventName, properties, measurements);
            const config = getTelemetryConfig();
            this.externalReporter.sendTelemetryEvent(eventName, properties, config?.hmacKey || '');
        } catch (error) {
            console.warn('Failed to send telemetry event:', error);
        }
    }

    
}