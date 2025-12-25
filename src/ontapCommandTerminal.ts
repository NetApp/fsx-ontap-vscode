import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { Logger, LogLevel } from './logger';

class OntapCommandTerminal implements vscode.Pseudoterminal {
   private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    private closeEmitter = new vscode.EventEmitter<void>();
    onDidClose?: vscode.Event<void> = this.closeEmitter.event;

    private sshProcess?: ChildProcessWithoutNullStreams;

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        const sshCommand = `ssh fsxadmin@management.fs-00018e6a0992b555a.fsx.us-east-1.amazonaws.com -o ProxyCommand='aws ec2-instance-connect open-tunnel --instance-connect-endpoint-id eice-009518b0a3ab6ac67 --private-ip-address 172.31.5.14' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
        this.sshProcess = spawn(sshCommand, {
            shell: true,
            stdio: 'pipe'
        });

        this.sshProcess.stdout.on('data', (data) => {
            this.writeEmitter.fire(data.toString());
            Logger.log(`SSH stdout: ${data.toString()}`, LogLevel.Info);        });
        this.sshProcess.stderr.on('data', (data) => {
            this.writeEmitter.fire(data.toString());
            Logger.log(`SSH stderr: ${data.toString()}`, LogLevel.Error);
        });
        this.sshProcess.on('close', () => {
            this.closeEmitter.fire();
            Logger.log('SSH process closed', LogLevel.Info);
        });

    }

    close(): void {
        this.sshProcess?.kill();
        this.closeEmitter.fire();
    }

    handleInput?(data: string): void {}
}

export function openPseudoTerminalAndCapture() {
    const pty = new OntapCommandTerminal();
    const terminal = vscode.window.createTerminal({ name: 'Pseudo', pty });

    
    pty.onDidWrite((data) => {
        vscode.window.showInformationMessage(`Terminal output: ${data}`);
    });

    terminal.show();
}