import * as vscode from 'vscode';
import { FileSystemMetrics, getEntities, VolumeMetrics } from './FileSystemApis';
import { executeOntapCommands, OntapExecutorResult } from './ontap_executor';
import { state } from './state';
import { copilot_filesystem_question, copilot_question } from './telemetryReporter';

async function getWorkingLanguageModel(): Promise<vscode.LanguageModelChat | null> {
    const chatModels = await vscode.lm.selectChatModels();
    
    for (const model of chatModels) {
        try {
            // Test the model with a simple request
            const testMessage = vscode.LanguageModelChatMessage.Assistant('Hello');
            await model.sendRequest([testMessage], {}, new vscode.CancellationTokenSource().token);
            return model;
        } catch (error) {
            console.warn(`Model ${model.vendor}/${model.name} failed test:`, error);
            continue;
        }
    }
    
    return null;
}

export async function handleChatRequest(
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<any> {
    try {
        const chatModel = await getWorkingLanguageModel();

        if (!chatModel) {
            stream.markdown('No language models are available. Please ensure you have access to language models.');
            return;
        }
        console.log(`Using language model: ${chatModel.vendor}/${chatModel.name}`);

        if(request.command === 'filesystem') {
            state.reporter.sendTelemetryEvent(copilot_filesystem_question, { prompt: request.prompt });
            const entitiesResults = await getEntities(['filesystems']);
            const fileSystems = entitiesResults.filesystems;
            const nameIdMapping = fileSystems.map(fs => {
                return {
                    fileSystemId: fs.FileSystemId,
                    name: fs.Tags?.find((tag: { Key: string; }) => tag.Key === 'Name')?.Value || 'N/A',
                };
            });

            const fileSystemIdMessage = vscode.LanguageModelChatMessage.Assistant(`From the user prompt please return as string only the filesystem id the user 
                asked about with no extra text, the rules to extract the filesystem id are:
                1. find the regex ^fs-[0-9a-f]{17}$ 
                2. if the ^fs-[0-9a-f]{17}$ regex isnt found, from the context, look in the mapping that is provided. it is an array and each object has property of name and id and try to see if the name is in the prompt and map to the id, it must be exact match and not partial match. use this context ${JSON.stringify(nameIdMapping)}`
                 + "\n" + request.prompt);
            const fileSystemIdRequest = await chatModel.sendRequest([fileSystemIdMessage], {}, token);
            let fileSystemId = '';
            for await (const fragment of fileSystemIdRequest.text) {
                        fileSystemId = fileSystemId + fragment;
            }
            if(!fileSystemId.match(/^fs-[0-9a-f]{17}$/)) {
                stream.markdown(`The user prompt does not contain a valid filesystem id, please try again with a valid filesystem id or a name that exists in the context\n`);
                return;
            };
            stream.markdown(`\nI understand that the user wants information about filesystem id: ${fileSystemId}\n`);
            const cliMessage = vscode.LanguageModelChatMessage.Assistant('You are a Netapp ONTAP master. Your job is to suggest which Netapp ONTAP CLI commands need to run in order to answer the user question. You can use https://docs.netapp.com/us-en/ontap-cli/ to get all the CLIs, use version 9.16.1. Return the result as JSON string array without the ```json``` in the format of [{"command": <cli command>}]. If in the prompt there is a filesystem id with the regex ^fs-[0-9a-f]{17}$, dont use it as a parameter in the CLI, not as a volume or anything.The suggested commands are not allowed to modify state only to show information. Dont suggest commands that has placeholder in the pattern of <> instead use * for all entities.' + "\n" + request.prompt);
            const cliRequest = await chatModel.sendRequest([cliMessage], {}, token);
            let clis = '';
            for await (const fragment of cliRequest.text) {
                clis = clis + fragment;
            }
            stream.markdown(`\nI understand that I need to run the following CLI commands:\n`);
            const commands = JSON.parse(clis);
            for(const command of commands) {
                stream.markdown(`-  **${command.command}**\n`);
            }
            stream.markdown(`\nI will now proceed to run the necessary ONTAP CLI commands.\n`);
            stream.markdown(`\nI will need some information to establish the SSH connection.\n`);
            const fileSystem = entitiesResults.filesystems.find((fs: any) => fs.FileSystemId === fileSystemId);
            let results: OntapExecutorResult = undefined as any;
            try {
                results = await executeOntapCommands(fileSystem, commands.map((c: { command: string; }) => c.command), undefined, stream);
            } catch (error) {
                stream.markdown(`\nFailed to SSH into ${fileSystemId}\n`);
                return;
            }
            const errors = results.result.find(r => !r.success && r.exitCode === 255);
            const validResults = results.result.filter(r => r.success);
            if(errors) {
                stream.markdown(`\nNote: Some commands failed to execute. Trying again...\n`);
                const errorsMessage = vscode.LanguageModelChatMessage.Assistant('You are a Netapp ONTAP master. Your job is to suggest which Netapp ONTAP CLI commands need to run in order to answer the user question. You can use https://docs.netapp.com/us-en/ontap-cli/ to get all the CLIs, use version 9.16.1. Return the result as JSON string array without the ```json``` in the format of [{"command": <cli command>}]. If in the prompt there is a filesystem id with the regex ^fs-[0-9a-f]{17}$, dont use it as a parameter in the CLI, not as a volume or anything.'
                     + `When I first asked you the question you gave me some commands which were wrong, please suggest the correct commands. Here are the wrong commands and their ONTAP errors ${JSON.stringify(errors)}` + "\n" + request.prompt);
                const errorsRequest = await chatModel.sendRequest([errorsMessage], {}, token);
                let errclis = '';
                for await (const fragment of errorsRequest.text) {
                            errclis = errclis + fragment;
                }
                stream.markdown(`\nRunning the updated commands using the previous context:\n`);
                const errcommands = JSON.parse(errclis);
                for(const command of errcommands) {
                    stream.markdown(`- ${command.command}\n`);
                }
                stream.markdown(`\nI will now proceed to run the necessary ONTAP CLI commands.\n`);
                const errresults = await executeOntapCommands(fileSystem, errcommands.map((c: { command: string; }) => c.command), results.connectionContext, stream);
                validResults.push(...errresults.result.filter(r => r.success));
            }
            stream.markdown(`\nI have executed the commands. Working on the answer\n`);
           
            
            const messageWithResults = vscode.LanguageModelChatMessage.Assistant(`You are a Netapp ONTAP master. 
                  Your job is to answer the user question based on the command results I give you.
                  The results are directly reference filesystem id ${fileSystemId} which is ONTAP cluster, so look on the user question and answer accordingly.
                  The results were obtained by running the following commands: ${commands.map((c: { command: string; }) => c.command).join(', ')}.
                  If the results do not help you answer the question, say you dont know.
                  Use this format for your answer: Question: <repeat the user question> Answer: <your answer>. 
                  Here are the command results: ${JSON.stringify(validResults)}` + "\n" + request.prompt);
            const messageWithResultsRequest = await chatModel.sendRequest([messageWithResults], {}, token);
            stream.markdown('\n');
            for await (const fragment of messageWithResultsRequest.text) {
                        stream.markdown(fragment);
            }

            stream.markdown("\n");
            stream.markdown('\n**This analysis was generated by AI. Please verify information before making decisions.**\n');
    
        } else {
            state.reporter.sendTelemetryEvent(copilot_question, { prompt: request.prompt });
            stream.progress('processing request...');
            const entitiesMessage = vscode.LanguageModelChatMessage.Assistant('You are an AWS FSX ONTAP expert. From the user prompt please return as a json string array without the ```json``` that I can parse which of the below entities are asked from the user, can be one or more : filesystems, volumes, svms, backups'
                 + " if you see that there is a need for filesystems and volumes and also svms" + "\n" + request.prompt);
            const entitiesRequest = await chatModel.sendRequest([entitiesMessage], {}, token);

            let ent = '';
            for await (const fragment of entitiesRequest.text) {
                        ent = ent + fragment;
            }
            const entities: string[] = JSON.parse(ent);
            const fsMetrics: string[] = [];
            const volumeMetrics: string[] = [];
            if(entities.length > 0) {
                const fsMetricsMessage = vscode.LanguageModelChatMessage.Assistant('You are an AWS FSX ONTAP expert. From the user prompt advise if there is a need to query cloudwatch metrics for the filesystems. If so return it only as as a json string array without the ```json``` that I can parse which of the below filesystem metrics are asked from the user, can be one or more : ' + FileSystemMetrics.join(', ') + " use this url for more information https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/file-system-metrics.html" + "\n" + request.prompt);
                const fsMetricsRequest = await chatModel.sendRequest([fsMetricsMessage], {}, token);
                let fsmet = '';
                for await (const fragment of fsMetricsRequest.text) {
                            fsmet = fsmet + fragment;
                }
                try {
                    fsMetrics.push(...JSON.parse(fsmet).filter((met: string) => FileSystemMetrics.includes(met)));
                } catch (error) {
                    console.error('Error parsing filesystem metrics:', error);
                }
                

                const volumeMetricsMessage = vscode.LanguageModelChatMessage.Assistant('You are an AWS FSX ONTAP expert. From the user prompt advise if there is a need to query cloudwatch metrics for the filesystem volumes. If so return response that contains it only as as a json string array without the ```json``` that I can parse which of the below volume metrics are asked from the user, can be one or more : ' + VolumeMetrics.join(', ') + " use this url for more information https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/volume-metrics.html" + "\n" + request.prompt);
                const volumeMetricsRequest = await chatModel.sendRequest([volumeMetricsMessage], {}, token);
                let vmet = '';
                for await (const fragment of volumeMetricsRequest.text) {
                            vmet = vmet + fragment;
                }
                try {
                    volumeMetrics.push(...JSON.parse(vmet).filter((met: string) => VolumeMetrics.includes(met)));
                } catch (error) {
                    console.error('Error parsing volume metrics:', error);
                }
            }

            stream.markdown(`\nI understand that I need the following entities: ${entities.join(', ')}\n`);
            stream.markdown("\n");
            if(fsMetrics.length > 0) {
                stream.markdown(`\nI will also gather the following filesystem metrics: ${fsMetrics.join(', ')}\n`);
            }
            //if(volumeMetrics.length > 0) {
            //    stream.markdown(`\nI will also gather the following volume metrics: ${volumeMetrics.join(', ')}\n`);
            //}
            stream.markdown(`\nI will now proceed to gather the necessary information for those entities.\n`);
            stream.progress('gathering information...');

            if(fsMetrics.length > 0 || volumeMetrics.length > 0) {
                entities.push('metrics');
            }
            const entitiesResults = await getEntities(entities, {fsMetrics, volMetrics: []});
            stream.markdown("I have got the context and processing...");
            stream.progress('finishing...');
            const messages: vscode.LanguageModelChatMessage[] = [];
            messages.push(vscode.LanguageModelChatMessage.Assistant(`You are an AWS FSX ONTAP expert. 
                Use the context I give you to answer the question. 
                The context is only about AWS FSX ONTAP.
                The context is from the AWS account that the user is currently connected to in the VSCode AWS extension.
                The context contains the current state of the AWS FSX ONTAP filesystems, volumes, svms, backups and cloud watch metrics. 
                If the question is not about AWS FSX ONTAP, say you can only answer questions related to AWS FSX ONTAP.
                Some quiestion may refere to more than one filesystem, volume or svm, make sure to answer all of them.
                Some questions may refer to a single filesystem, volue or svm. make sure to use the correct one. you can identify the filesystem by its id or by its name tag.
                Answer only questions related to AWS FSX ONTAP. 
                Use this format for your answer: Question: <repeat the user question> Answer: <your answer>
                The question is: ${request.prompt}
                Here is the context of filesystem that you can use to answer the question.
                The format is collection of filesystems. context: ${JSON.stringify(entitiesResults.filesystems || [])}
                Here is the context of volumes that you can use to answer the question.
                The format is collection of volumes. context: ${JSON.stringify(entitiesResults.volumes || [])}
                Here is the context of storage virtual machines that you can use to answer the question.
                The format is collection of storage virtual machines. context: ${JSON.stringify(entitiesResults.svms || [])}
                Here is the cloud watch context that you can use to answer the question.
                The format is map that the key is the region and the value is the cloudwatch metrics.
                Each metric is represented as a key-value pair where the name is the entity name - and the metric. context: ${JSON.stringify(entitiesResults.metrics || {})}
                Here is the context of backups that you can use to answer the question.
                The format is collection of backups. context: ${JSON.stringify(entitiesResults.backups || [])}`));
            /*messages.push(vscode.LanguageModelChatMessage.Assistant(`The user question is: ${request.prompt}`));
            messages.push(vscode.LanguageModelChatMessage.Assistant(`Here is the context of filesystem that you can use to answer the question.
                The format is collection of filesystems. context: ${JSON.stringify(entitiesResults.filesystems || [])}`));
            messages.push(vscode.LanguageModelChatMessage.Assistant(`Here is the context of volumes that you can use to answer the question.
                The format is collection of volumes. context: ${JSON.stringify(entitiesResults.volumes || [])}`));
            messages.push(vscode.LanguageModelChatMessage.Assistant(`Here is the context of storage virtual machines that you can use to answer the question.
                The format is collection of storage virtual machines. context: ${JSON.stringify(entitiesResults.svms || [])}`));
            messages.push(vscode.LanguageModelChatMessage.Assistant(`Here is the cloud watch context that you can use to answer the question.
                The format is map that the key is the region and the value is the cloudwatch metrics.
                Each metric is represented as a key-value pair where the name is the entity name - and the metric. context: ${JSON.stringify(entitiesResults.metrics || [])}`));
            messages.push(vscode.LanguageModelChatMessage.Assistant(`Here is the context of backups that you can use to answer the question.
                The format is collection of backups. context: ${JSON.stringify(entitiesResults.backups || [])}`));*/
           

            const userResult = await chatModel.sendRequest(messages, {}, token);
            for await (const fragment of userResult.text) {
                        stream.markdown(fragment);
            }
            stream.markdown("\n");
            stream.markdown('\n**This analysis was generated by AI. Please verify information before making decisions.**\n');
        }
		

    } catch (error) {
        console.error('Error handling chat request:', error);
        stream.markdown(`Failed to process chat request with error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
	// Handle the chat request here
}       