import {
    BedrockRuntimeClient, ConversationRole, ConverseCommand,
    type ContentBlock, type Message, type Tool, type ToolInputSchema,
    type ToolConfiguration, type ToolResultContentBlock
} from "@aws-sdk/client-bedrock-runtime";
import { MessageType, Model } from "../modelFactory";
import { ChatTool } from '../tools';
import * as vscode from 'vscode';
import { state } from "../../state";
import { Logger, LogLevel } from "../../logger";

const MAX_TOOL_ROUNDS = 15;

export class BedrockModel implements Model {
    type: string = "bedrock";
    client: BedrockRuntimeClient | null = null;
    temperature = 0.7;
    maxTokens = 4096;
   
    constructor(private inferenceArn: string) {}

    async init(): Promise<void> {
        const bedrockRegion = vscode.workspace.getConfiguration('netapp-fsx-ontap').get('bedrockregion',"us-east-1");
        if (!this.inferenceArn || typeof this.inferenceArn !== 'string' || !this.inferenceArn.startsWith('arn:')) {
            Logger.log('Bedrock inference ARN is missing or invalid.', LogLevel.Error);
            throw new Error('Bedrock inference ARN is missing or invalid.');
        }
        try {
            this.client = new BedrockRuntimeClient({
                region: bedrockRegion as string,
                credentials: { accessKeyId: state.currentAccessKeyId, secretAccessKey: state.currentSecretAccessKey }
            });
            Logger.log(`Initialized Bedrock client for inference ARN: ${this.inferenceArn} in region: ${bedrockRegion}`, LogLevel.Info);
        } catch (error) {
            Logger.log('Failed to initialize Bedrock client.', LogLevel.Error, error as Error);
            throw error;
        }
    }

    async sendMessage(message: string, messageType: MessageType): Promise<string> {
        const content: Message[] = [{
            role: ConversationRole.USER,
            content: [{ text: message }],
        }];

        const command = new ConverseCommand({
            modelId: this.inferenceArn,
            messages: content,
            inferenceConfig: {
                maxTokens: this.maxTokens,
                temperature: this.temperature,
            },
        });

        if (!this.client) {
            throw new Error("Bedrock client not initialized");
        }

        const response = await this.client.send(command);
        return response.output?.message?.content?.map(c => c.text).join("") || "";
    }

    async sendMessageWithTools(
        systemPrompt: string,
        userMessage: string,
        tools: ChatTool[],
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<string> {
        if (!this.client) {
            throw new Error("Bedrock client not initialized");
        }

        const toolMap = new Map(tools.map(t => [t.name, t]));

        const toolConfig: ToolConfiguration = {
            tools: tools.map(t => ({
                toolSpec: {
                    name: t.name,
                    description: t.description,
                    inputSchema: { json: t.inputSchema } as ToolInputSchema
                }
            } as Tool)),
            toolChoice: { auto: {} }
        };

        const messages: Message[] = [
            {
                role: ConversationRole.USER,
                content: [{ text: userMessage }]
            }
        ];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (token.isCancellationRequested) {
                throw new Error('Request cancelled');
            }

            const command = new ConverseCommand({
                modelId: this.inferenceArn,
                messages,
                system: [{ text: systemPrompt }],
                toolConfig,
                inferenceConfig: {
                    maxTokens: this.maxTokens,
                    temperature: this.temperature,
                },
            });

            const response = await this.client.send(command);
            const assistantContent = response.output?.message?.content || [];

            messages.push({
                role: ConversationRole.ASSISTANT,
                content: assistantContent
            });

            if (response.stopReason !== 'tool_use') {
                return assistantContent
                    .filter(block => block.text)
                    .map(block => block.text)
                    .join('');
            }

            const toolResultBlocks: ContentBlock[] = [];

            for (const block of assistantContent) {
                if (!block.toolUse) { continue; }

                const toolUse = block.toolUse;
                const tool = toolMap.get(toolUse.name!);

                if (!tool) {
                    toolResultBlocks.push({
                        toolResult: {
                            toolUseId: toolUse.toolUseId,
                            content: [{ text: `Error: unknown tool "${toolUse.name}"` } as ToolResultContentBlock],
                            status: 'error'
                        }
                    } as ContentBlock);
                    continue;
                }

                stream.progress(`Running tool: ${toolUse.name}...`);
                Logger.log(`Tool call: ${toolUse.name} with input: ${JSON.stringify(toolUse.input)}`, LogLevel.Info);

                try {
                    const result = await tool.invoke(toolUse.input as any, stream);
                    toolResultBlocks.push({
                        toolResult: {
                            toolUseId: toolUse.toolUseId,
                            content: [{ text: result } as ToolResultContentBlock]
                        }
                    } as ContentBlock);
                } catch (error) {
                    const errMsg = `Tool "${toolUse.name}" failed: ${(error as Error).message}`;
                    Logger.log(errMsg, LogLevel.Error, error as Error);
                    toolResultBlocks.push({
                        toolResult: {
                            toolUseId: toolUse.toolUseId,
                            content: [{ text: errMsg } as ToolResultContentBlock],
                            status: 'error'
                        }
                    } as ContentBlock);
                }
            }

            messages.push({
                role: ConversationRole.USER,
                content: toolResultBlocks
            });
        }

        throw new Error('Tool calling loop exceeded maximum rounds');
    }
}