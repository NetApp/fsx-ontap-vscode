import * as vscode from 'vscode';
import { FileSystem, S3AccessPointAttachment, StorageVirtualMachine, Volume} from "@aws-sdk/client-fsx";
import { _Object } from '@aws-sdk/client-s3';

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
		this.iconPath = new vscode.ThemeIcon('library');
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

export class S3AccessPointItem extends vscode.TreeItem {
    constructor(
		public readonly name: string,
		public readonly id: string,
		public readonly region: string,
		public readonly accessPoint: S3AccessPointAttachment,
		public readonly volume: Volume,
		public readonly svm: StorageVirtualMachine,
		public readonly fs: FileSystem,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(name, collapsibleState);

		this.tooltip = `${this.name}`;
		this.description = this.id;
		this.iconPath = new vscode.ThemeIcon('folder-library');
	}

	contextValue = 's3-access-point';
}

export class S3NextPageItem extends vscode.TreeItem {
    constructor(
        public readonly resourceArn: string,
        public readonly region: string,
        public readonly continuationToken: string,
        public readonly accessPoint: S3AccessPointAttachment,
        public readonly volume: Volume,
        public readonly svm: StorageVirtualMachine,
        public readonly fs: FileSystem
    ) {
        super('Next Page', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'next-page';
        this.iconPath = new vscode.ThemeIcon('arrow-right');
        this.command = {
            command: 'netapp-fsx-ontap.list-s3-objects-next-page',
            title: 'Load Next Page',
            arguments: [this],
        };
    }
}

export class ObjectItem extends vscode.TreeItem {
    constructor(
        public readonly name: string,
        public readonly lastModified: string,
        public readonly region: string,
        public readonly object: _Object,
        public readonly accessPoint: S3AccessPointAttachment,
        public readonly volume: Volume,
        public readonly svm: StorageVirtualMachine,
        public readonly fs: FileSystem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(name, collapsibleState);

        this.tooltip = `${this.name}`;
        this.description = `${this.object.Size?.toString() || ''} bytes, ${this.lastModified}`;
        this.iconPath = new vscode.ThemeIcon('file');
    }

    contextValue = 'object';
}