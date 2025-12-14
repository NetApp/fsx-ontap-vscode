import * as vscode from 'vscode';
import { FileSystem, StorageVirtualMachine, Volume} from "@aws-sdk/client-fsx";

export class FileSystemsItem extends vscode.TreeItem {
    constructor(
		public readonly name: string,
		public readonly id: string,
        public readonly fs: FileSystem,
        public readonly region: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly hasOntapLoginDetails: boolean,
		public readonly command?: vscode.Command
	) {
		super(name, collapsibleState);

		this.tooltip = `${this.name}`;
		this.description = this.id;
		this.iconPath = this.hasOntapLoginDetails ? new vscode.ThemeIcon('pass-filled') : new vscode.ThemeIcon('cloud'); 
		this.contextValue = this.hasOntapLoginDetails ? 'filesystem-withLoginDetails' : 'filesystem';
	}

	

}

export class SVMItem extends vscode.TreeItem {
    constructor(
		public readonly name: string,
		public readonly id: string,
        public readonly svm: StorageVirtualMachine,
        public readonly region: string,
		public readonly fs: FileSystem,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(name, collapsibleState);

		this.tooltip = `${this.name}`;
		this.description = this.id;
		this.iconPath = new vscode.ThemeIcon('folder-library');
	}

	/*iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'dependency.svg')
	};*/

	contextValue = 'svm';

}

export class VolumeItem extends vscode.TreeItem {
    constructor(
		public readonly name: string,
		public readonly id: string,
        public readonly region: string,
        public readonly volume: Volume,
		public readonly svm: StorageVirtualMachine,
		public readonly fs: FileSystem,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(name, collapsibleState);

		this.tooltip = `${this.name}`;
		this.description = this.id;
		this.iconPath = new vscode.ThemeIcon('folder');
	}

	/*iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'dependency.svg')
	};*/

	contextValue = 'volume';

}