import * as vscode from 'vscode';

export enum LogLevel {
  Info = 'INFO',
  Error = 'ERROR',
  Debug = 'DEBUG',
  Warning = 'WARNING',
}

export class Logger {
    private static outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('NetApp FSx ONTAP');

    static log(message: string, level: LogLevel = LogLevel.Info, error?: Error): void {
        const timestamp = new Date().toISOString();
        
        if(error) {
            this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message} ${error.stack || error.message}`);
        } else {
            this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
        }
    }
}