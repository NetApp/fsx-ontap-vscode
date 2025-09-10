import * as vscode from 'vscode';
import * as path from 'path';

export interface SSHConnectionInfo {
    ip:  string; // IP address of the instance
    host: string;
    username?: string;          
    connectionName: string;
    endpointId?: string;
}

export class SSHService {
    

    static async sshToFileSystem(fileSystemId: string, fileSystemName: string, region: string, ip: string): Promise<void> {
        try {
           
            // For now, we'll show a mock connection dialog
            const connectionInfo = await this.getFileSystemConnectionInfo(fileSystemId, fileSystemName, region, ip);

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
    private static async promptForConnectionDetails(host: string, resourceName: string, ip: string): Promise<SSHConnectionInfo | undefined> {
        
        // Get username
        const username = await vscode.window.showInputBox({
            prompt: 'Enter SSH username',
            value: 'fsxadmin', // Default for FSx
            placeHolder: 'e.g., fsxadmin'
        });

        if (!username) {
            return undefined;
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
                placeHolder: 'e.g., i-0123456789abcdef0'
            });

        }
        // For 'default', keyPath remains undefined (will use SSH agent)

        return {
            ip: ip,
            host: host,
            username: username,
            endpointId: endpointId,
            connectionName: `${resourceName} (ip: ${ip})`
        };
    }

    /**
     * Establish SSH connection
     */
    private static async establishSSHConnection(connectionInfo: SSHConnectionInfo): Promise<void> {
        // Method 1: Open integrated terminal with SSH command
        await this.openSSHInTerminal(connectionInfo);
    }

    /**
     * Open SSH connection in VS Code integrated terminal
     */
    private static async openSSHInTerminal(connectionInfo: SSHConnectionInfo): Promise<void> {
        const terminal = vscode.window.createTerminal({
            name: `SSH: ${connectionInfo.connectionName}`,
            iconPath: new vscode.ThemeIcon('terminal')
        });

        // Build SSH command
        let sshCommand = `ssh ${connectionInfo.username}@${connectionInfo.host}`;
        
       
        
        if (connectionInfo.endpointId) {
            sshCommand += ` -o ProxyCommand='aws ec2-instance-connect open-tunnel --instance-connect-endpoint-id ${connectionInfo.endpointId} --private-ip-address ${connectionInfo.ip}'`;
        }

        // Add common SSH options
        sshCommand += ' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null';

        terminal.show();
        terminal.sendText(sshCommand);

        vscode.window.showInformationMessage(`Opening SSH connection to ${connectionInfo.connectionName}`);
    }

}
