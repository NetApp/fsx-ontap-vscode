import * as vscode from 'vscode';
import { CopilotModel } from './models/copilot';
import { BedrockModel } from './models/bedrock';

export type MessageType = {
    role: 'user' | 'assistant' | 'system';
};

export interface Model {
    sendMessage: (message: string, messageType: MessageType) => Promise<string>;
    init: () => Promise<void>;
    type: string;
}




export async function getModel(token: vscode.CancellationToken): Promise<Model> {
    const inference = vscode.workspace.getConfiguration('netapp-fsx-ontap').get('inferenceArn',"");
    if (inference) {
        const model = new BedrockModel(inference as string);
        await model.init();
        return model;
    } else {
        const model = new CopilotModel(token);
        await model.init();
        return model;
    }
}