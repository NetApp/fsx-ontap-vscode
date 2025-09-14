import * as vscode from 'vscode';
import { SimpleScriptCreator } from './SimpleScriptCreator';

export class WelcomeEditor {
    public static readonly viewType = 'netapp-fsx-ontap.welcome';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public static createWelcomePanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
        const panel = vscode.window.createWebviewPanel(
            WelcomeEditor.viewType,
            'FSx for ONTAP Welcome',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [context.extensionUri],
                retainContextWhenHidden: true
            }
        );

        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'netapp.svg');
        
        const welcomeEditor = new WelcomeEditor(context);
        panel.webview.html = welcomeEditor._getHtmlForWebview(panel.webview);

        panel.webview.onDidReceiveMessage(data => {
            console.log('Received message:', data);
            switch (data.type) {
                case 'connectAws':
                    console.log('Executing AWS login command');
                    vscode.commands.executeCommand('netapp-fsx-ontap.aws-login');
                    break;
                case 'openCloudFormation':
                    vscode.commands.executeCommand('netapp-fsx-ontap.show-filesystem-cf-creation');
                    break;
                case 'openTerraform':
                    vscode.commands.executeCommand('netapp-fsx-ontap.show-filesystem-tf-creation');
                    break;
                case 'openMSsql':
                    console.log('Opening MS SQL documentation');
                    welcomeEditor._openDocumentation('https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/sql-server.html');
                    break;
                case 'openEKS':
                    console.log('Opening EKS documentation');
                    welcomeEditor._openDocumentation('https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/eks-csi-driver.html');
                    break;
                case 'openFSx':
                    console.log('Opening FSx documentation');
                    welcomeEditor._openDocumentation('https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/');
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        });

        return panel;
    }

    private _openDocumentation(url: string) {
        vscode.env.openExternal(vscode.Uri.parse(url));
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the SVG icon URIs
        const cloudFormationIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'cloudfprmation.svg'));
        const terraformIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'terraform.svg'));
        const mysqlIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'mysql.svg'));
        const eksIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'eks.svg'));
        const awsIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'aws.svg'));
        const fsxIconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'fsxn.png'));
        
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>FSx for ONTAP Welcome</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 40px;
                        margin: 0;
                        line-height: 1.6;
                    }
                    
                    .welcome-container {
                        max-width: 1000px;
                        margin: 0 auto;
                    }
                    
                    .header {
                        text-align: center;
                        margin-bottom: 30px;
                        padding: 20px;
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        border-radius: 8px;
                        border: 1px solid var(--vscode-widget-border);
                    }
                    
                    .header h1 {
                        margin: 0 0 10px 0;
                        font-size: 24px;
                        font-weight: 600;
                        color: var(--vscode-foreground);
                    }
                    
                    .header p {
                        margin: 5px 0;
                        color: var(--vscode-descriptionForeground);
                        font-size: 14px;
                    }
                    
                    .aws-connect-section {
                        margin: 20px 0;
                        display: flex;
                        justify-content: stretch;
                    }
                    
                    .aws-connect-card {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 8px;
                        padding: 15px 20px;
                        text-align: left;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        position: relative;
                        overflow: hidden;
                        display: flex;
                        align-items: center;
                        gap: 15px;
                        width: 100%;
                    }
                    
                    .aws-connect-card:hover {
                        background-color: var(--vscode-list-hoverBackground);
                        border-color: var(--vscode-focusBorder);
                        transform: translateY(-2px);
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    }
                    
                    .aws-connect-icon {
                        width: 32px;
                        height: 32px;
                        flex-shrink: 0;
                    }
                    
                    .aws-connect-icon img {
                        width: 100%;
                        height: 100%;
                        object-fit: contain;
                    }
                    
                    .aws-connect-content {
                        flex: 1;
                    }
                    
                    .aws-connect-title {
                        font-weight: 600;
                        font-size: 14px;
                        margin: 0;
                        color: var(--vscode-foreground);
                    }
                    
                    .aws-connect-button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        font-weight: 500;
                        transition: background-color 0.2s ease;
                        margin-left: auto;
                        flex-shrink: 0;
                    }
                    
                    .aws-connect-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    
                    .services-grid {
                        display: flex;
                        flex-wrap: nowrap;
                        gap: 15px;
                        margin-top: 20px;
                        justify-content: space-between;
                    }
                    
                    .service-card {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 8px;
                        padding: 20px 15px;
                        text-align: center;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        position: relative;
                        overflow: hidden;
                        flex: 1;
                        min-width: 140px;
                        max-width: 160px;
                    }
                    
                    .service-card:hover {
                        background-color: var(--vscode-list-hoverBackground);
                        border-color: var(--vscode-focusBorder);
                        transform: translateY(-2px);
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    }
                    
                    .service-icon {
                        width: 48px;
                        height: 48px;
                        margin: 0 auto 12px;
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    .service-icon img {
                        width: 100%;
                        height: 100%;
                        object-fit: contain;
                    }
                    
                    .service-title {
                        font-weight: 600;
                        margin-bottom: 8px;
                        font-size: 14px;
                        color: var(--vscode-foreground);
                    }
                    
                    .service-description {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        line-height: 1.4;
                    }
                    
                    .footer {
                        text-align: center;
                        margin-top: 50px;
                        padding: 20px;
                        color: var(--vscode-descriptionForeground);
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>
                <div class="welcome-container">
                    <div class="header">
                        <h1>Welcome to FSx for ONTAP VSCode extension</h1>
                        <p>Below are some useful links that can help you get started.</p>
                        <p>Use Co-pilot @fsx-ontap to chat about your FSx for ONTAP resources and get advice from FSx chatbot expert.</p>
                    </div>
                    
                    <div class="aws-connect-section">
                        <div class="aws-connect-card" data-action="connectAws">
                            <div class="aws-connect-icon">
                                <img src="${awsIconUri}" alt="AWS" />
                            </div>
                            <div class="aws-connect-content">
                                <div class="aws-connect-title">Connect to AWS</div>
                            </div>
                            <button class="aws-connect-button" data-action="connectAws">Connect</button>
                        </div>
                    </div>
                    
                    <div class="services-grid">
                        <div class="service-card" data-action="openCloudFormation">
                            <div class="service-icon">
                                <img src="${cloudFormationIconUri}" alt="CloudFormation" />
                            </div>
                            <div class="service-title">CloudFormation</div>
                            <div class="service-description">Create FSx for ONTAP cluster using CloudFormation</div>
                        </div>
                        
                        <div class="service-card" data-action="openTerraform">
                            <div class="service-icon">
                                <img src="${terraformIconUri}" alt="Terraform" />
                            </div>
                            <div class="service-title">Terraform</div>
                            <div class="service-description">Create FSx for ONTAP cluster using Terraform</div>
                        </div>
                        
                        <div class="service-card" data-action="openMSsql">
                            <div class="service-icon">
                                <img src="${mysqlIconUri}" alt="MySQL" />
                            </div>
                            <div class="service-title">MSsql</div>
                            <div class="service-description">Deploy an SQL Server on EC2 with Amazon FSx for ONTAP using Terraform</div>
                        </div>
                        
                        <div class="service-card" data-action="openEKS">
                            <div class="service-icon">
                                <img src="${eksIconUri}" alt="EKS" />
                            </div>
                            <div class="service-title">EKS</div>
                            <div class="service-description">Deploy FSx for ONTAP as a persistent storage for EKS using Terraform</div>
                        </div>
                        
                        <div class="service-card" data-action="openFSx">
                            <div class="service-icon">
                                <img src="${fsxIconUri}" alt="FSx" />
                            </div>
                            <div class="service-title">FSx</div>
                            <div class="service-description">FSx for ONTAP resource page</div>
                        </div>
                    </div>
                    
                    <div class="footer">
                        <p>Get started by connecting to AWS and exploring your FSx for ONTAP resources!</p>
                    </div>
                </div>
                
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    
                    console.log('Welcome script loaded');
                    
                    // Add event listeners when DOM is loaded
                    document.addEventListener('DOMContentLoaded', function() {
                        console.log('DOM loaded, adding event listeners');
                        
                        // Add click listeners to all elements with data-action
                        document.querySelectorAll('[data-action]').forEach(element => {
                            element.addEventListener('click', function(event) {
                                const action = this.getAttribute('data-action');
                                console.log('Action clicked:', action);
                                
                                // Prevent event bubbling for buttons
                                if (this.tagName === 'BUTTON') {
                                    event.stopPropagation();
                                }
                                
                                // Send message based on action
                                vscode.postMessage({
                                    type: action
                                });
                            });
                        });
                    });
                    
                    // Also add immediate listeners in case DOM is already loaded
                    if (document.readyState === 'loading') {
                        console.log('Document still loading, waiting for DOMContentLoaded');
                    } else {
                        console.log('Document already loaded, adding listeners immediately');
                        document.querySelectorAll('[data-action]').forEach(element => {
                            element.addEventListener('click', function(event) {
                                const action = this.getAttribute('data-action');
                                console.log('Action clicked:', action);
                                
                                if (this.tagName === 'BUTTON') {
                                    event.stopPropagation();
                                }
                                
                                vscode.postMessage({
                                    type: action
                                });
                            });
                        });
                    }
                </script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}