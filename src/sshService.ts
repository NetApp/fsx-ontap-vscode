import * as vscode from 'vscode';
import * as path from 'path';
import { state } from './state';

export type SSHConnectionInfo = {
    privateIpAddress:  string; // IP address of the instance
    host?: string;
    username?: string;          
    connectionName?: string;
    instanceConnectEndpointId?: string;
    password?: string;
}

export class SSHService {
    

    static async sshToFileSystem(fileSystemId: string, fileSystemName: string, region: string, ip: string): Promise<void> {
        try {
            const sshInfoStr = await state.context.secrets.get(`sshKey-${fileSystemId}-${region}`); // Example of using context
            // For now, we'll show a mock connection dialog
            const connectionInfo = sshInfoStr ? JSON.parse(sshInfoStr) : await this.getFileSystemConnectionInfo(fileSystemId, fileSystemName, region, ip);

            if (connectionInfo) {
                await this.establishSSHConnection(connectionInfo);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to SSH to file system: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    
    /**
     * Get connection information for a file system
     */
    private static async getFileSystemConnectionInfo(fileSystemId: string, fileSystemName: string, region: string, ip: string): Promise<SSHConnectionInfo | undefined> {

        const selectedInstance = `management.${fileSystemId}.fsx.${region}.amazonaws.com`;
        // Get SSH connection details
        return await this.promptForConnectionDetails(selectedInstance, fileSystemName, ip);
    }

    /**
     * Prompt user for SSH connection details
     */
    public static async promptForConnectionDetails(host: string, resourceName: string, ip: string, promptForPassword: boolean = false): Promise<SSHConnectionInfo | undefined> {
        
        let password: string | undefined;

        // Get username
        const username = await vscode.window.showInputBox({
            prompt: 'Enter SSH username',
            value: 'fsxadmin', // Default for FSx
            placeHolder: 'e.g., fsxadmin'
        });

        if (!username) {
            return undefined;
        }

        if (promptForPassword) {
            password = await vscode.window.showInputBox({
                prompt: 'Enter SSH password',
                password: true,
                placeHolder: 'Your SSH password'
            });
        }
        const connectionOptions = await vscode.window.showQuickPick([
            { label: 'Direct', value: 'direct' },
            { label: 'EC2 Instance Connect', value: 'tunneling' },
        ], {
            placeHolder: 'How do you want to connect?'
        });

        if (!connectionOptions) {
            return undefined;
        }


        let endpointId: string | undefined;
        if (connectionOptions.value === 'tunneling') {
            endpointId = await vscode.window.showInputBox({
                prompt: 'Enter instance connect endpoint ID',
                placeHolder: 'e.g., eice-009518b0a3ab6ac67'
            });

        }
        // For 'default', keyPath remains undefined (will use SSH agent)

        return {
            privateIpAddress: ip,
            host: host,
            username: username,
            password: password,
            instanceConnectEndpointId: endpointId,
            connectionName: `${resourceName} (ip: ${ip})`
        };
    }

    /**
     * Establish SSH connection
     */
    private static async establishSSHConnection(connectionInfo: SSHConnectionInfo): Promise<void> {
        await this.openSSHInTerminal(connectionInfo);
    }

    /**
     * Open SSH connection in VS Code integrated terminal
     */
    private static async openSSHInTerminal(connectionInfo: SSHConnectionInfo): Promise<void> {
        const terminal = vscode.window.createTerminal({
            name: `SSH: ${connectionInfo.connectionName || connectionInfo.privateIpAddress}`,
            iconPath: new vscode.ThemeIcon('terminal')
        });

        // Build SSH command
        let sshCommand = `ssh ${connectionInfo.username}@${connectionInfo.privateIpAddress}`;
        
       
        
        if (connectionInfo.instanceConnectEndpointId) {
            sshCommand += ` -o ProxyCommand='aws ec2-instance-connect open-tunnel --instance-connect-endpoint-id ${connectionInfo.instanceConnectEndpointId} --private-ip-address ${connectionInfo.privateIpAddress}'`;
        }

        // Add common SSH options
        sshCommand += ' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null';

        terminal.show();
        terminal.sendText(sshCommand);

        vscode.window.showInformationMessage(`Opening SSH connection to ${connectionInfo.connectionName}`);
    }

}
