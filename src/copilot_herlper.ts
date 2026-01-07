import * as vscode from 'vscode';
import { FileSystemMetrics, getEntities, VolumeMetrics } from './FileSystemApis';
import { executeOntapCommands, OntapExecutorResult } from './ontap_executor';
import { state } from './state';
import { copilot_filesystem_question, copilot_question } from './telemetryReporter';
import { getModel } from './chat/modelFactory';
import { Logger, LogLevel } from './logger';

/**
 * Parses a comma-separated list from model responses.
 * Handles various formats: "item1,item2", "item1, item2", "item1\nitem2", etc.
 * 
 * @param response - The raw response from the model
 * @returns Array of trimmed strings
 */
function parseCommaSeparatedList(response: string): string[] {
    if (!response || typeof response !== 'string') {
        return [];
    }

    const trimmed = response.trim();
    
    // Remove markdown code blocks if present
    const codeBlockRegex = /```(?:[\w]+)?\s*([\s\S]*?)```/;
    const codeBlockMatch = trimmed.match(codeBlockRegex);
    const content = codeBlockMatch ? codeBlockMatch[1] : trimmed;
    
    // Split by comma or newline, filter empty strings, and trim
    return content
        .split(/[,\n]/)
        .map(item => item.trim())
        .filter(item => item.length > 0);
}

/**
 * Parses CLI commands from model responses.
 * Handles line-by-line format, numbered lists, or bullet points.
 * 
 * @param response - The raw response from the model
 * @returns Array of command objects with 'command' property
 */
function parseCommands(response: string): Array<{ command: string }> {
    if (!response || typeof response !== 'string') {
        return [];
    }

    const trimmed = response.trim();
    
    // Remove markdown code blocks if present
    const codeBlockRegex = /```(?:[\w]+)?\s*([\s\S]*?)```/;
    const codeBlockMatch = trimmed.match(codeBlockRegex);
    const content = codeBlockMatch ? codeBlockMatch[1] : trimmed;
    
    // Split by newlines
    const lines = content.split('\n');
    const commands: Array<{ command: string }> = [];
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
            continue;
        }
        
        // Remove common prefixes: "1. ", "- ", "* ", "• ", etc.
        const cleaned = trimmedLine
            .replace(/^[\d]+\.\s*/, '')  // Remove "1. ", "2. ", etc.
            .replace(/^[-*•]\s*/, '')     // Remove "- ", "* ", "• "
            .replace(/^COMMAND:\s*/i, '')  // Remove "COMMAND: "
            .trim();
        
        if (cleaned.length > 0) {
            commands.push({ command: cleaned });
        }
    }
    
    return commands;
}



export async function handleChatRequest(
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<any> {
    try {
        
        const model = await getModel(token);
        
        if(model.type !== 'copilot') {
            stream.markdown(`\nUsing AI model: ${model.type}\n`);
        } 

        if(request.command === 'filesystem') {
            state.reporter.sendTelemetryEvent(copilot_filesystem_question, { prompt: request.prompt, type: model.type });
            const entitiesResults = await getEntities(['filesystems']);
            const fileSystems = entitiesResults.filesystems;
            const nameIdMapping = fileSystems.map(fs => {
                return {
                    fileSystemId: fs.FileSystemId,
                    name: fs.Tags?.find((tag: { Key: string; }) => tag.Key === 'Name')?.Value || 'N/A',
                };
            });

            const fileSystemId = await model.sendMessage(`From the user prompt please return as string only the filesystem id the user 
                asked about with no extra text, the rules to extract the filesystem id are:
                1. find the regex ^fs-[0-9a-f]{17}$ 
                2. if the ^fs-[0-9a-f]{17}$ regex isnt found, from the context, look in the mapping that is provided. it is an array and each object has property of name and id and try to see if the name is in the prompt and map to the id, it must be exact match and not partial match. use this context ${JSON.stringify(nameIdMapping)}`
                 + "\n" + request.prompt, { role: 'assistant' });
            
            if(!fileSystemId.match(/^fs-[0-9a-f]{17}$/)) {
                stream.markdown(`The user prompt does not contain a valid filesystem id, please try again with a valid filesystem id or a name that exists in the context\n`);
                return;
            };
            stream.markdown(`\nI understand that the user wants information about filesystem id: ${fileSystemId}\n`);
            
            const clis = await model.sendMessage('You are a Netapp ONTAP master. Your job is to suggest which Netapp ONTAP CLI commands need to run in order to answer the user question. You can use https://docs.netapp.com/us-en/ontap-cli/ to get all the CLIs, use version 9.16.1. Return ONLY the CLI commands, one per line, with no extra text, no numbering, no bullets, no markdown. Each line should be a single ONTAP CLI command. If in the prompt there is a filesystem id with the regex ^fs-[0-9a-f]{17}$, dont use it as a parameter in the CLI, not as a volume or anything. The suggested commands are not allowed to modify state only to show information. Dont suggest commands that has placeholder in the pattern of <> instead use * for all entities.' + "\n" + request.prompt, { role: 'assistant' });
            
            stream.markdown(`\nI understand that I need to run the following CLI commands:\n`);
            const commands = parseCommands(clis);
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
                const errclis = await model.sendMessage('You are a Netapp ONTAP master. Your job is to suggest which Netapp ONTAP CLI commands need to run in order to answer the user question. You can use https://docs.netapp.com/us-en/ontap-cli/ to get all the CLIs, use version 9.16.1. Return ONLY the CLI commands, one per line, with no extra text, no numbering, no bullets, no markdown. Each line should be a single ONTAP CLI command. If in the prompt there is a filesystem id with the regex ^fs-[0-9a-f]{17}$, dont use it as a parameter in the CLI, not as a volume or anything.'
                     + `When I first asked you the question you gave me some commands which were wrong, please suggest the correct commands. Here are the wrong commands and their ONTAP errors ${JSON.stringify(errors)}` + "\n" + request.prompt, { role: 'assistant' });
                
                stream.markdown(`\nRunning the updated commands using the previous context:\n`);
                const errcommands = parseCommands(errclis);
                for(const command of errcommands) {
                    stream.markdown(`- ${command.command}\n`);
                }
                stream.markdown(`\nI will now proceed to run the necessary ONTAP CLI commands.\n`);
                const errresults = await executeOntapCommands(fileSystem, errcommands.map((c: { command: string; }) => c.command), results.connectionContext, stream);
                validResults.push(...errresults.result.filter(r => r.success));
            }
            stream.markdown(`\nI have executed the commands. Working on the answer\n`);
           
            
            const result = await model.sendMessage(`You are a Netapp ONTAP master. 
                  Your job is to answer the user question based on the command results I give you.
                  The results are directly reference filesystem id ${fileSystemId} which is ONTAP cluster, so look on the user question and answer accordingly.
                  The results were obtained by running the following commands: ${commands.map((c: { command: string; }) => c.command).join(', ')}.
                  If the results do not help you answer the question, say you dont know.
                  Use this format for your answer: Question: <repeat the user question> Answer: <your answer>. 
                  Here are the command results: ${JSON.stringify(validResults)}` + "\n" + request.prompt, { role: 'assistant' });
            
            stream.markdown('\n');
            stream.markdown(result);
            stream.markdown("\n");
            stream.markdown('\n**This analysis was generated by AI. Please verify information before making decisions.**\n');
    
        } else {
            state.reporter.sendTelemetryEvent(copilot_question, { prompt: request.prompt });
            stream.progress('processing request...');
            const ent = await model.sendMessage(`
                You are an AWS FSX ONTAP expert.
                From the user prompt please return ONLY a comma-separated list (no extra text, no markdown) of which entities are asked from the user. Can be one or more: filesystems, volumes, svms, backups
                Example good response: filesystems,volumes
                Example good response: filesystems
                Example good response: filesystems,volumes,svms
                Return only the entity names separated by commas, nothing else.
                ${request.prompt}`, { role: 'assistant' });
            
            const entities: string[] = parseCommaSeparatedList(ent);
            const fsMetrics: string[] = [];
            const volumeMetrics: string[] = [];
            if(entities.length > 0) {
                const fsmet = await model.sendMessage('You are an AWS FSX ONTAP expert. From the user prompt advise if there is a need to query cloudwatch metrics for the filesystems. If so return ONLY a comma-separated list (no extra text, no markdown) of which filesystem metrics are asked from the user, can be one or more. Available metrics: ' + FileSystemMetrics.join(', ') + " use this url for more information https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/file-system-metrics.html. If no metrics are needed, return empty. Return only the metric names separated by commas, nothing else." + "\n" + request.prompt, { role: 'assistant' });
                try {
                    const parsed = parseCommaSeparatedList(fsmet);
                    fsMetrics.push(...parsed.filter((met: string) => FileSystemMetrics.includes(met)));
                } catch (error) {
                    Logger.log('Error parsing filesystem metrics.', LogLevel.Error, error as Error);
                    console.error('Error parsing filesystem metrics:', error);
                }
                

                const vmet = await model.sendMessage('You are an AWS FSX ONTAP expert. From the user prompt advise if there is a need to query cloudwatch metrics for the filesystem volumes. If so return ONLY a comma-separated list (no extra text, no markdown) of which volume metrics are asked from the user, can be one or more. Available metrics: ' + VolumeMetrics.join(', ') + " use this url for more information https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/volume-metrics.html. If no metrics are needed, return empty. Return only the metric names separated by commas, nothing else." + "\n" + request.prompt, { role: 'assistant' });
                try {
                    const parsed = parseCommaSeparatedList(vmet);
                    volumeMetrics.push(...parsed.filter((met: string) => VolumeMetrics.includes(met)));
                } catch (error) {
                    Logger.log('Error parsing volume metrics.', LogLevel.Error, error as Error);
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
            
            const userResult = await model.sendMessage(`You are an AWS FSX ONTAP expert. 
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
                The format is collection of backups. context: ${JSON.stringify(entitiesResults.backups || [])}`, { role: 'assistant' });
           
            stream.markdown('\n');
            stream.markdown(userResult);
            stream.markdown("\n");
            stream.markdown('\n**This analysis was generated by AI. Please verify information before making decisions.**\n');
        }
		

    } catch (error) {
        Logger.log('Error handling chat request.', LogLevel.Error, error as Error);
        console.error('Error handling chat request:', error);
        stream.markdown(`Failed to process chat request with error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
	// Handle the chat request here
}       