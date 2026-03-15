import * as vscode from 'vscode';
import { MessageType, Model } from "../modelFactory";
import { ChatTool } from '../tools';
import { Logger, LogLevel } from '../../logger';

const MAX_TOOL_ROUNDS = 15;

export class CopilotModel implements Model {
    type: string = "copilot";
    chatModel: vscode.LanguageModelChat | null = null;

    constructor(private token: vscode.CancellationToken) {}
    
    async getWorkingLanguageModel(): Promise<vscode.LanguageModelChat | null> {
        const chatModels = await vscode.lm.selectChatModels();
        
        for (const model of chatModels) {
            try {
                const testMessage = vscode.LanguageModelChatMessage.Assistant('Hello');
                await model.sendRequest([testMessage], {}, new vscode.CancellationTokenSource().token);
                return model;
            } catch (error) {
                Logger.log(`Model ${model.vendor}/${model.name} failed test: ${(error as Error).message}`, LogLevel.Warning, error as Error);
                continue;
            }
        }
        
        return null;
    }

    async init(): Promise<void> {
        this.chatModel = await this.getWorkingLanguageModel();
        Logger.log(`Using language model: ${this.chatModel?.vendor}/${this.chatModel?.name}`, LogLevel.Info);
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

    async sendMessageWithTools(
        systemPrompt: string,
        userMessage: string,
        tools: ChatTool[],
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<string> {
        if (!this.chatModel) {
            throw new Error('Copilot language model not initialized');
        }

        const lmTools: vscode.LanguageModelChatTool[] = tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
        }));

        const toolMap = new Map(tools.map(t => [t.name, t]));

        const messages: vscode.LanguageModelChatMessage[] = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            vscode.LanguageModelChatMessage.User(userMessage)
        ];

        const options: vscode.LanguageModelChatRequestOptions = {
            tools: lmTools,
            toolMode: vscode.LanguageModelChatToolMode.Auto
        };

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const response = await this.chatModel.sendRequest(messages, options, token);

            const toolCalls: vscode.LanguageModelToolCallPart[] = [];
            let textParts: vscode.LanguageModelTextPart[] = [];

            for await (const part of response.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textParts.push(part);
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    toolCalls.push(part);
                }
            }

            if (toolCalls.length === 0) {
                return textParts.map(p => p.value).join('');
            }

            const toolResults: vscode.LanguageModelToolResultPart[] = [];
            for (const call of toolCalls) {
                const tool = toolMap.get(call.name);
                if (!tool) {
                    toolResults.push(new vscode.LanguageModelToolResultPart(call.callId, [
                        new vscode.LanguageModelTextPart(`Error: unknown tool "${call.name}"`)
                    ]));
                    continue;
                }

                stream.progress(`Running tool: ${call.name}...`);
                Logger.log(`Tool call: ${call.name} with input: ${JSON.stringify(call.input)}`, LogLevel.Info);

                try {
                    const result = await tool.invoke(call.input as any, stream);
                    toolResults.push(new vscode.LanguageModelToolResultPart(call.callId, [
                        new vscode.LanguageModelTextPart(result)
                    ]));
                } catch (error) {
                    const errMsg = `Tool "${call.name}" failed: ${(error as Error).message}`;
                    Logger.log(errMsg, LogLevel.Error, error as Error);
                    toolResults.push(new vscode.LanguageModelToolResultPart(call.callId, [
                        new vscode.LanguageModelTextPart(errMsg)
                    ]));
                }
            }

            messages.push(
                vscode.LanguageModelChatMessage.Assistant([...textParts, ...toolCalls])
            );
            messages.push(
                vscode.LanguageModelChatMessage.User(toolResults)
            );
        }

        throw new Error('Tool calling loop exceeded maximum rounds');
    }
}