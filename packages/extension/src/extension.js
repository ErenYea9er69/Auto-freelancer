"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const crypto = require("crypto");
async function activate(context) {
    console.log('GOALpilot extension is now active!');
    // Super Privacy DB Setup: Ensure user ID exists
    let userId = context.globalState.get('userId');
    if (!userId) {
        userId = crypto.randomUUID();
        context.globalState.update('userId', userId);
    }
    // Ensure storage path exists
    const storageUri = context.globalStorageUri;
    try {
        await vscode.workspace.fs.createDirectory(storageUri);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(storageUri, 'chats'));
    }
    catch (e) { }
    const myProvider = new class {
        contentMap = new Map();
        provideTextDocumentContent(uri) {
            return this.contentMap.get(uri.path) || '';
        }
    }();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('goalpilot-proposal', myProvider));
    const provider = new SidebarProvider(context.extensionUri, myProvider, storageUri.fsPath, userId);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('goalpilot-sidebar', provider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    // Feature 4: Proactive Ghost Mode
    vscode.languages.onDidChangeDiagnostics(e => {
        for (const uri of e.uris) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
            if (errors.length > 0) {
                provider.postMessage({
                    type: 'diagnostic_event',
                    payload: {
                        filePath: uri.fsPath,
                        error: errors[0].message
                    }
                });
            }
        }
    });
    let disposable = vscode.commands.registerCommand('goalpilot.start', () => {
        vscode.window.showInformationMessage('GOALpilot started!');
    });
    context.subscriptions.push(disposable);
}
class SidebarProvider {
    _extensionUri;
    _provider;
    _storagePath;
    _userId;
    constructor(_extensionUri, _provider, _storagePath, _userId) {
        this._extensionUri = _extensionUri;
        this._provider = _provider;
        this._storagePath = _storagePath;
        this._userId = _userId;
    }
    _view;
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.command) {
                case 'startTask':
                    vscode.window.showInformationMessage('Task Started: ' + data.text);
                    break;
                case 'showDiff':
                    const originalUri = vscode.Uri.file(data.filePath);
                    const proposalUri = vscode.Uri.parse(`goalpilot-proposal:${data.filePath}`);
                    this._provider.contentMap.set(proposalUri.path, data.content);
                    vscode.commands.executeCommand('vscode.diff', originalUri, proposalUri, `Proposed: ${data.filePath.split(/[\\/]/).pop()}`);
                    break;
            }
        });
    }
    postMessage(message) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }
    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'build', 'assets', 'index.js'));
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'build', 'assets', 'index.css'));
        const nonce = getNonce();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const apiKey = vscode.workspace.getConfiguration('goalpilot').get('longcatApiKey') || '';
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';">
            <link href="${stylesUri}" rel="stylesheet">
            <title>GOALpilot</title>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}">
                window.vscode = acquireVsCodeApi();
                window.goalpilotConfig = {
                    storagePath: ${JSON.stringify(this._storagePath)},
                    userId: ${JSON.stringify(this._userId)},
                    workspaceRoot: ${JSON.stringify(workspaceRoot)},
                    apiKey: ${JSON.stringify(apiKey)}
                };
            </script>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
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
function deactivate() { }
//# sourceMappingURL=extension.js.map