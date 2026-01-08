// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { addOntapLoginDetails, addSvmCommand, createSnapshot, createVolume, selectProfile, selectRegion, sshToFileSystem } from './commands';
import { state } from './state';
import { FileSystemsTree } from './FileSystemsTree';
import { SimpleScriptCreator } from './SimpleScriptCreator';
import { handleChatRequest } from './copilot_herlper';
import { WelcomeEditor } from './WelcomeEditor';
import { Logger } from './logger';
import { extension_activated, extension_deactivated } from './telemetryReporter';

let activationTime: number = 0;
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "netapp-fsx-ontap" is now active!');
	Logger.log('Extension activated.');
	activationTime = Date.now();
	await state.init(context);
	
	// Show welcome screen on first activation
	//WelcomeEditor.createWelcomePanel(context);
	const hasShownWelcome = context.globalState.get('hasShownWelcome', false);
	if (!hasShownWelcome) {
		WelcomeEditor.createWelcomePanel(context);
		context.globalState.update('hasShownWelcome', true);
	}

	/*vscode.workspace.onDidChangeConfiguration(async (e) => {
		
	});*/
	const treeDataProvider = new FileSystemsTree();
	vscode.window.createTreeView('netapp-fsx-ontap.tree', {
		treeDataProvider: treeDataProvider
	});

	const refreshCommand = vscode.commands.registerCommand('netapp-fsx-ontap.refresh', () => {
		// Refresh the tree view
		treeDataProvider.refresh();
	});

	const regionCommand = vscode.commands.registerCommand('netapp-fsx-ontap.regions-select', () => {
		selectRegion();
	});

	const loginCommand = vscode.commands.registerCommand('netapp-fsx-ontap.aws-login', () => {
		selectProfile();
	});

	const showFilesystemsCfCreationCommand = vscode.commands.registerCommand('netapp-fsx-ontap.show-filesystem-cf-creation', async () => {
		await SimpleScriptCreator.createFileSystemCloudFormationScript();
	});

	const showFilesystemsTFCreationCommand = vscode.commands.registerCommand('netapp-fsx-ontap.show-filesystem-tf-creation', async () => {
		await SimpleScriptCreator.createFileSystemTFScript();
	});

	const createSvmCommand = vscode.commands.registerCommand('netapp-fsx-ontap.addSvm', async (fileSystem: any) => {
		addSvmCommand(fileSystem, fileSystem.region, () => treeDataProvider.refresh());
	});

	const showSvmTerraformCommand = vscode.commands.registerCommand('netapp-fsx-ontap.addSvm-terraform', async (fileSystem: any) => {
		await SimpleScriptCreator.createSvmTerraformScript(fileSystem.id, fileSystem.region);
	});

	const showSvmCloudFormationCommand = vscode.commands.registerCommand('netapp-fsx-ontap.addSvm-cloudformation', async (fileSystem: any) => {
		await SimpleScriptCreator.createSvmCloudFormationScript(fileSystem.id, fileSystem.region);
	});

	const showSvmCliCommand = vscode.commands.registerCommand('netapp-fsx-ontap.addSvm-cli', async (fileSystem: any) => {
		await SimpleScriptCreator.createSvmCliScript(fileSystem.id, fileSystem.region);
	});

	const sshToFileSystemCommand = vscode.commands.registerCommand('netapp-fsx-ontap.sshToFileSystem', async (item) => {
		await sshToFileSystem(item);
	});

	const createVolumeCommand = vscode.commands.registerCommand('netapp-fsx-ontap.addVolume', async (svm: any) => {
		createVolume(svm.id, svm.region, () => treeDataProvider.refresh());
	});

	const createSnapshotCommand = vscode.commands.registerCommand('netapp-fsx-ontap.createSnapshot', async (volume: any) => {
		await createSnapshot(volume.fs, volume.svm.Name, volume.volume.Name, volume.region);
	});

	const showVolumeTerraformCommand = vscode.commands.registerCommand('netapp-fsx-ontap.addVolume-terraform', async (svm: any) => {
		await SimpleScriptCreator.createVolumeTerraformScript(svm.id, svm.region);
	});

	const showVolumeCloudFormationCommand = vscode.commands.registerCommand('netapp-fsx-ontap.addVolume-cloudformation', async (svm: any) => {
		await SimpleScriptCreator.createVolumeCloudFormationScript(svm.id, svm.region);
	});

	const showVolumeCliCommand = vscode.commands.registerCommand('netapp-fsx-ontap.addVolume-cli', async (svm: any) => {
		await SimpleScriptCreator.createVolumeCliScript(svm.id, svm.region);
	});

	const showWelcomeCommand = vscode.commands.registerCommand('netapp-fsx-ontap.showWelcome', () => {
		WelcomeEditor.createWelcomePanel(context);
	});

	const registerOntapLoginDetailsCommand = vscode.commands.registerCommand('netapp-fsx-ontap.add-ontap-login-details', async (filesystem: any) => {
		await addOntapLoginDetails(filesystem, () => treeDataProvider.refresh());
	});

	const registerUpdateOntapLoginDetailsCommand = vscode.commands.registerCommand('netapp-fsx-ontap.update-ontap-login-details', async (filesystem: any) => {
		await addOntapLoginDetails(filesystem, () => treeDataProvider.refresh());
	});
	
	const chatParticipant = vscode.chat.createChatParticipant('netapp-fsx-ontap.helper', handleChatRequest);
	chatParticipant.iconPath = vscode.Uri.file(context.asAbsolutePath('resources/chat.svg'));

	context.subscriptions.push(
		refreshCommand,
		regionCommand,
		loginCommand,
		showFilesystemsCfCreationCommand,
		showFilesystemsTFCreationCommand,
		createSvmCommand,
		showSvmTerraformCommand,
		showSvmCloudFormationCommand,
		showSvmCliCommand,
		sshToFileSystemCommand,
		createVolumeCommand,
		createSnapshotCommand,
		showVolumeTerraformCommand,
		showVolumeCloudFormationCommand,
		showVolumeCliCommand,
		showWelcomeCommand,
		chatParticipant,
		registerOntapLoginDetailsCommand,
		registerUpdateOntapLoginDetailsCommand
	);

	state.reporter.sendTelemetryEvent(extension_activated, { });
}

// This method is called when your extension is deactivated
export function deactivate() { 
	Logger.log('Extension deactivated.');
	const activeDurationSeconds = activationTime ? Math.round((Date.now() - activationTime) / 1000) : 0;
	state.reporter.sendTelemetryEvent(extension_deactivated, { 
		activeDurationFormatted: `${Math.floor(activeDurationSeconds / 60)}m ${activeDurationSeconds % 60}s`,
		activeDurationSeconds: activeDurationSeconds.toString(),
	 });
}
