import * as vscode from 'vscode';
import { MessageType, Model } from "../modelFactory";
import { Logger, LogLevel } from '../../logger';


export class CopilotModel implements Model {
    type: string = "copilot";
    chatModel: vscode.LanguageModelChat | null = null;

    constructor(private token: vscode.CancellationToken) {}
    
    async getWorkingLanguageModel(): Promise<vscode.LanguageModelChat | null> {
        const chatModels = await vscode.lm.selectChatModels();
        
        for (const model of chatModels) {
            try {
                // Test the model with a simple request
                const testMessage = vscode.LanguageModelChatMessage.Assistant('Hello');
                await model.sendRequest([testMessage], {}, new vscode.CancellationTokenSource().token);
                return model;
            } catch (error) {
                Logger.log(`Model ${model.vendor}/${model.name} failed test: ${(error as Error).message}`, LogLevel.Warning, error as Error);
                console.warn(`Model ${model.vendor}/${model.name} failed test:`, error);
                continue;
            }
        }
        
        return null;
    }

    async init(): Promise<void> {
        this.chatModel = await this.getWorkingLanguageModel();
        Logger.log(`Using language model: ${this.chatModel?.vendor}/${this.chatModel?.name}`, LogLevel.Info);
        console.log(`Using language model: ${this.chatModel?.vendor}/${this.chatModel?.name}`);
    }

    async sendMessage(message: string, messageType: MessageType): Promise<string> {
        const messageObj = messageType.role === 'user' ? vscode.LanguageModelChatMessage.User(message)
            : vscode.LanguageModelChatMessage.Assistant(message);
           
        const request = await this.chatModel?.sendRequest([messageObj], {}, this.token);
        let response = '';
        for await (const fragment of request?.text || []) {
            response = response + fragment;
        }
        return response;
    }
}