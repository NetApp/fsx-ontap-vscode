import * as vscode from 'vscode';
import { FileSystemMetrics, getEntities, VolumeMetrics } from './FileSystemApis';
import { SSHService } from './sshService';
import { openPseudoTerminalAndCapture } from './ontapCommandTerminal';

export async function handleChatRequest(
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<any> {
    try {
        const chatModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });

        if(request.command === 'filesystem') {
            /*const entitiesResults = await getEntities(['filesystems']);
            const fileSystemIdMessage = vscode.LanguageModelChatMessage.User(`from the user prompt please return as string only the filesystem id the user 
                asked about with no extra text, the rules to extract the filesystem id are:
                1. find the regex ^fs-[0-9a-f]{17}$ 
                2. if the ^fs-[0-9a-f]{17}$ regex isnt found, from the context, look in the filesystems and try to match the names which are tags with key Name and with a string in the prompt.
                use this context ${JSON.stringify(entitiesResults)}`
                 + "\n" + request.prompt);
            const fileSystemIdRequest = await chatModels[0].sendRequest([fileSystemIdMessage], {}, token);
            let fileSystemId = '';
            for await (const fragment of fileSystemIdRequest.text) {
                        fileSystemId = fileSystemId + fragment;
            }
            stream.markdown(`I understand that I need to work with filesystem id: ${fileSystemId}\n`);
            const cliMessage = vscode.LanguageModelChatMessage.User('You are a Netapp ONTAP master. Your job is to suggest which Netapp ONTAP CLI commands need to run in order to answer the user question. You can use https://docs.netapp.com/us-en/ontap-cli/ to get all the CLIs, use version 9.16.1. Return the result as JSON string array without the ```json``` in the format of [{"command": <cli command>}]. If in the prompt there is a filesystem id with the regex ^fs-[0-9a-f]{17}$, dont use it as a parameter in the CLI, not as a volume or anything' + "\n" + request.prompt);
            const cliRequest = await chatModels[0].sendRequest([cliMessage], {}, token);
            let clis = '';
            for await (const fragment of cliRequest.text) {
                clis = clis + fragment;
            }
            stream.markdown(`\nI understand that I need to run the following CLI commands:\n`);
            const commands = JSON.parse(clis);
            for(const command of commands) {
                stream.markdown(`- ${command.command}\n`);
            }
            stream.markdown(`\nI will now proceed to run the necessary ONTAP CLI commands.\n`);
            stream.markdown(`\nI will need some information to establish the SSH connection.\n`);
            const fileSystem = entitiesResults.filesystems.find((fs: any) => fs.id === fileSystemId);
            //await SSHService.sendCommandToTerminal(fileSystem, commands.map((c: { command: string; }) => c.command));*/

        } else {
            
            stream.progress('processing request...');
            const entitiesMessage = vscode.LanguageModelChatMessage.User('from the user prompt please return as a json string array without the ```json``` that i can parse which of the below entities are asked from the user, can be one or more : filesystems, volumes, svms, backups'
                 + " if you see that there is a need for filesystems and volumes and also svms" + "\n" + request.prompt);
            const entitiesRequest = await chatModels[0].sendRequest([entitiesMessage], {}, token);

            let ent = '';
            for await (const fragment of entitiesRequest.text) {
                        ent = ent + fragment;
            }
            const entities: string[] = JSON.parse(ent);
            const fsMetrics: string[] = [];
            const volumeMetrics: string[] = [];
            if(entities.length > 0) {
                const fsMetricsMessage = vscode.LanguageModelChatMessage.User('from the user prompt please return as a json string array without the ```json``` that i can parse which of the below filesystem metrics are asked from the user, can be one or more : ' + FileSystemMetrics.join(', ') + " use this url for more information https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/file-system-metrics.html" + "\n" + request.prompt);
                const fsMetricsRequest = await chatModels[0].sendRequest([fsMetricsMessage], {}, token);
                let fsmet = '';
                for await (const fragment of fsMetricsRequest.text) {
                            fsmet = fsmet + fragment;
                }
                fsMetrics.push(...JSON.parse(fsmet).filter((met: string) => FileSystemMetrics.includes(met)));

                const volumeMetricsMessage = vscode.LanguageModelChatMessage.User('from the user prompt please return as a json string array without the ```json``` that i can parse which of the below volume metrics are asked from the user, can be one or more : ' + VolumeMetrics.join(', ') + "use this url for more information https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/volume-metrics.html" + "\n" + request.prompt);
                const volumeMetricsRequest = await chatModels[0].sendRequest([volumeMetricsMessage], {}, token);
                let vmet = '';
                for await (const fragment of volumeMetricsRequest.text) {
                            vmet = vmet + fragment;
                }
                volumeMetrics.push(...JSON.parse(vmet).filter((met: string) => VolumeMetrics.includes(met)));
            }

            stream.markdown(`\nI understand that I need the following entities: ${entities.join(', ')}\n`);
            stream.markdown("\n");
            if(fsMetrics.length > 0) {
                stream.markdown(`\nI will also gather the following filesystem metrics: ${fsMetrics.join(', ')}\n`);
            }
            if(volumeMetrics.length > 0) {
                stream.markdown(`\nI will also gather the following volume metrics: ${volumeMetrics.join(', ')}\n`);
            }
            stream.markdown(`\nI will now proceed to gather the necessary information for those entities.\n`);
            stream.progress('gathering information...');

            if(fsMetrics.length > 0 || volumeMetrics.length > 0) {
                entities.push('metrics');
            }
            const entitiesResults = await getEntities(entities, {fsMetrics, volMetrics: volumeMetrics});
            stream.markdown("I have got the context and processing...");
            stream.progress('finishing...');
            const userResult = await chatModels[0].sendRequest([vscode.LanguageModelChatMessage.User(JSON.stringify(entitiesResults) + "\n" + request.prompt)], {}, token);
            for await (const fragment of userResult.text) {
                        stream.markdown(fragment);
            }
        }
		

    } catch (error) {
        console.error('Error handling chat request:', error);
        stream.markdown(`Failed to process chat request with error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
	// Handle the chat request here
}       