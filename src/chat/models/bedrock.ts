import { BedrockRuntimeClient, ConversationRole, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { MessageType, Model } from "../modelFactory";
import * as vscode from 'vscode';
import { state } from "../../state";

export class BedrockModel implements Model {
    type: string = "bedrock";
    client: BedrockRuntimeClient | null = null;
    temperature = 0.7;
    maxTokens = 4096;
   
    constructor(private modelName: string) {}

    async init(): Promise<void> {
        const bedrockRegion = vscode.workspace.getConfiguration('netapp-fsx-ontap').get('bedrockregion',"us-east-1");
        try {
            this.client = new BedrockRuntimeClient({
                region: bedrockRegion as string,
                profile: state.currentProfile
            });
            console.log(`Initialized Bedrock client for model: ${this.modelName} in region: ${bedrockRegion}`);
        } catch (error) {
            console.error("Failed to initialize Bedrock client:", error);
            throw error;
        }
        
    }

    async sendMessage(message: string, messageType: MessageType): Promise<string> {
        const content = [{
            role: ConversationRole.USER,
            content: [{ text: message }],
        }];

        const command = new ConverseCommand({
            modelId: this.modelName,
            messages: content,
            
            inferenceConfig: {
                maxTokens: this.maxTokens,
                temperature: this.temperature,
            },
        });

        if(!this.client) {
            throw new Error("Bedrock client not initialized");
        }

        const response = await this.client.send(command);
        return response.output?.message?.content?.map(c => c.text).join("") || "";

        
    }
}