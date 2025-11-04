//this is external reporter that does not depend on vscode API
//it reports to global telemetry endpoint with hmac signing

import * as vscode from 'vscode';
import axios from 'axios';
import * as crypto from 'crypto';

export class TelemetryExternalReporter {

    private getExtensionVersion(): string {
        return vscode.extensions.getExtension('netapp-fsx-ontap')?.packageJSON.version || 'unknown';
    }

    async sendTelemetryEvent(eventName: string, props: any, hmacSecret: string) {
        const baseProperties: Record<string, string> = {
            extensionVersion: this.getExtensionVersion(),
            vscodeVersion: vscode.version,
            machineId: vscode.env.machineId,
            timestamp: new Date().toISOString(),
        };

        const telemetryEndpoint = 'https://anftelemetry-api-prod.azurewebsites.net/api/track';
        const properties = { ...baseProperties, ...props };
        const payload = {
            name: `fsx.${eventName}`,
            properties: properties
        };
        const body = JSON.stringify(payload);
        const signature = crypto.createHmac('sha256', hmacSecret).update(body).digest('hex');
        axios({
            method: 'post',
            url: telemetryEndpoint,
            headers: {
                'Content-Type': 'application/json',
                'X-HMAC-Signature': signature,
                'User-Agent': `netapp-fsx-ontap/${this.getExtensionVersion()}`,
            },
            data: body
        }).catch((error) => {
            console.warn(`Failed to send telemetry event ${eventName}: ${error}`);     
        });
    }
}