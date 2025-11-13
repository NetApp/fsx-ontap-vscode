
import * as vscode from 'vscode';
import * as net from 'net';
import { Client }  from 'ssh2';
import { ChildProcess, spawn } from 'child_process';
import { state } from './state';
import { SSHConnectionInfo, SSHService } from './sshService';
import { FileSystem } from '@aws-sdk/client-fsx';

export type OntapCommandResult = { command: string; exitCode: number; output: string; error: string; success: boolean; }
export type OntapExecutorResult = { result: OntapCommandResult[]; connectionContext: SSHConnectionInfo; };

async function getConnectionContextFromSecret(fileSystemId: string, region: string): Promise<SSHConnectionInfo | null> {
    const sshInfoStr = await state.context.secrets.get(`sshKey-${fileSystemId}-${region}`);
    if (sshInfoStr) {
        return JSON.parse(sshInfoStr);
    }
   
    return null;
}

function extractRegionFromArn(arn: string): string | null {
    if (!arn || typeof arn !== 'string') {
        return null;
    }

    const arnParts = arn.split(':');
    
    // ARN should have at least 6 parts: arn:partition:service:region:account-id:resource
    if (arnParts.length < 6 || arnParts[0] !== 'arn') {
        return null;
    }

    const region = arnParts[3];
    
    // Region can be empty for some global services, but we return it as-is
    return region || null;
}

export async function executeOntapCommands(fileSystem: FileSystem, commands: string[],
     providedConnectionContext?: SSHConnectionInfo, stream?: vscode.ChatResponseStream): Promise<OntapExecutorResult> {

    const sshConfig = {
        username:  '',
        password:  ''
    };

    if(!fileSystem.OntapConfiguration) {
        throw new Error('ONTAP configuration not found for the specified file system.');
    }
    const config = {
            instanceConnectEndpointId: '',
            privateIpAddress: fileSystem.OntapConfiguration?.Endpoints?.Management?.IpAddresses?.[0] || ''
    };
   const region = extractRegionFromArn(fileSystem.ResourceARN as string);
   const currentProvidedConnectionContext = providedConnectionContext ? providedConnectionContext : await getConnectionContextFromSecret(fileSystem.FileSystemId as string, region || '');
   if(!currentProvidedConnectionContext) {
        const connectionDetails = await SSHService.promptForConnectionDetails(fileSystem.OntapConfiguration?.Endpoints?.Management?.DNSName || '' ,
                 fileSystem.FileSystemId as string, fileSystem.OntapConfiguration?.Endpoints?.Management?.IpAddresses?.[0] || '', true);
       
        sshConfig.password = connectionDetails?.password || '';
        sshConfig.username = connectionDetails?.username || 'fsxadmin';

        if (connectionDetails?.instanceConnectEndpointId) {
            config.instanceConnectEndpointId = connectionDetails.instanceConnectEndpointId;
        }
   } else {

       if(!currentProvidedConnectionContext.password) {
          currentProvidedConnectionContext.password = await vscode.window.showInputBox({
            prompt: 'Enter SSH password',
            value: '', // Default for FSx
            password: true
          }) as string;
       }
       sshConfig.password = currentProvidedConnectionContext.password;
       sshConfig.username = currentProvidedConnectionContext.username || 'fsxadmin';
       config.instanceConnectEndpointId = currentProvidedConnectionContext.instanceConnectEndpointId || '';
       config.privateIpAddress = currentProvidedConnectionContext.privateIpAddress || config.privateIpAddress;
   }
   
    stream?.markdown(`\nEstablishing SSH connection to ${config.privateIpAddress} as ${sshConfig.username}...\n`);
    const connectionContext: SSHConnectionInfo = {
        username:  sshConfig.username,
        password:  sshConfig.password,
        instanceConnectEndpointId: config.instanceConnectEndpointId,
        privateIpAddress: config.privateIpAddress as string 
    };
    
    if (connectionContext.instanceConnectEndpointId) {
        const res =  await createTunnelAndConnect(config, sshConfig, commands, stream);
        return {
            result: res,
            connectionContext: connectionContext
        };
    } else {
        // Direct connection
        const res = await createDirectSSHConnection(config, sshConfig, commands, stream);
        return {
            result: res,
            connectionContext: connectionContext
        };
    }
}

async function createDirectSSHConnection(config: { privateIpAddress: string; },
     sshConfig: { username: string; password: string;  }, commands: string[], stream?: vscode.ChatResponseStream): Promise<OntapCommandResult[]> {
    let sshClient: Client | null = null;
    try {
        // Step 1: Create SSH connection
        sshClient = await createSSHConnection(22, config.privateIpAddress, {
            username: sshConfig.username,
            password: sshConfig.password
        });
        
        // Step 2: Execute commands
        return await executeONTAPCommands(sshClient, commands, stream);
    } finally {
        if (sshClient) {
            sshClient.end();
        }
    }
}

async function createTunnelAndConnect(config: { instanceConnectEndpointId: string; privateIpAddress: string; },
     sshConfig: { username: string; password: string;  }, commands: string[], stream?: vscode.ChatResponseStream): Promise<OntapCommandResult[]> {
  let tunnel: ChildProcess | null = null;
  let sshClient: Client | null = null;

  try {
    // Step 1: Find available port
    const localPort = await getAvailablePort();
   
    // Step 2: Start tunnel
    tunnel = await startTunnel(localPort, config);
    
    // Step 3: Wait for tunnel to be ready
    await waitForPort(localPort);
   
    // Step 4: Create SSH connection
    sshClient = await createSSHConnection(localPort, 'localhost', sshConfig);

    // Step 5: Execute commands
    return await executeONTAPCommands(sshClient, commands, stream);
    
  } catch (error) {
    //vscode.window.showErrorMessage(`Error: ${(error as Error).message}`);
    throw new Error('failed to ssh');
  } finally {
    // Cleanup
    if (sshClient) {
      sshClient.end();
    }
    if (tunnel) {
      tunnel.kill();
    }
  }
}

async function executeONTAPCommands(sshClient: Client, commands: string[], stream?: vscode.ChatResponseStream): Promise<OntapCommandResult[]> {
  const results: OntapCommandResult[] = [];

  
  for (const command of commands) {
    try {
        const result = await executeCommand(sshClient, command, stream);
        stream?.markdown(`Command ${command} completed with exit code ${result.exitCode}\n`);
        stream?.markdown('```\n' + result.output + '\n```\n');
        results.push(result);
    } catch (error: any) {
      results.push({
        command,
        exitCode: -1,
        output: '',
        error: `Command failed: ${command}\nError: ${error.message}`,
        success: false
      });
    }
  }

  return results;
}

function startTunnel(localPort: number, config: { instanceConnectEndpointId: string; privateIpAddress: string; }): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const awsArgs = [
      'ec2-instance-connect',
      'open-tunnel',
      '--instance-connect-endpoint-id', config.instanceConnectEndpointId,
      '--private-ip-address', config.privateIpAddress,
      '--local-port', localPort.toString()
    ];
    
    // Add profile if one is selected
    if (state.currentProfile) {
      awsArgs.push('--profile', state.currentProfile);
    }
    
    const tunnel = spawn('aws', awsArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    tunnel.stdout.on('data', (data) => {
      
    });

    tunnel.stderr.on('data', (data) => {
     
    });

    tunnel.on('error', (err) => {
      reject(new Error(`Tunnel failed to start: ${err.message}`));
    });

    tunnel.on('close', (code) => {
      
    });

    // AWS CLI tunnel doesn't give reliable output, so we wait and test
    setTimeout(() => {
      resolve(tunnel);
    }, 3000);
  });
}

function createSSHConnection(localPort: number, host: string, config: { username: string; password: string;  }): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      resolve(conn);
    });
    
    conn.on('error', (err: any) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });
    
    conn.connect({
      host: host,
      port: localPort,
      username: config.username,
      password: config.password,
      readyTimeout: 20000
    });
  });
}

function executeCommand(sshClient: Client, command: string, stream?: vscode.ChatResponseStream): Promise<OntapCommandResult> {
  return new Promise((resolve, reject) => {
    stream?.progress(`\nExecuting command: \`${command}\`\n`);
    sshClient.exec(command, (err: any, stream: any) => {
      if (err) {
        reject(err);
        return;
      }

      let output = '';
      let errorOutput = '';
      
      stream.on('close', (code: number) => {
        const result = {
                    command,
                    exitCode: code,
                    output: output.trim(),
                    error: errorOutput.trim(),
                    success: code === 0
        };

        // ONTAP behavior: Always resolve with result object instead of rejecting
        // This prevents the session from being considered "failed" on invalid commands
        resolve(result);
      });

      stream.on('data', (data: any) => {
        output += data.toString();
      });

      stream.stderr.on('data', (data: any) => {
        errorOutput += data.toString();
      });

      stream.on('error', (streamErr: any) => {
                resolve({
                    command,
                    exitCode: -1,
                    output: output.trim(),
                    error: `Stream error: ${streamErr.message}`,
                    success: false
                });
    });

    });
  });
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object' && 'port' in address) {
        const port = (address as net.AddressInfo).port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get server port')));
      }
    });
    server.on('error', reject);
  });
}

function waitForPort(port: number, maxAttempts = 15) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    function testConnection() {
      attempts++;
     
      const socket = new net.Socket();
      
      socket.setTimeout(2000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve({});
      });
      
      socket.on('error', () => {
        socket.destroy();
        if (attempts >= maxAttempts) {
          reject(new Error(`Port ${port} not ready after ${maxAttempts} attempts`));
        } else {
          setTimeout(testConnection, 1000);
        }
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        if (attempts >= maxAttempts) {
          reject(new Error(`Port ${port} connection timeout after ${maxAttempts} attempts`));
        } else {
          setTimeout(testConnection, 1000);
        }
      });
      
      socket.connect(port, 'localhost');
    }
    
    testConnection();
  });
}