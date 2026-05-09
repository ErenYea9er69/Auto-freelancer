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
    let mindMeldCommand = vscode.commands.registerTextEditorCommand('goalpilot.mindMeld', async (editor) => {
        const prompt = await vscode.window.showInputBox({
            prompt: "GOALpilot Mind-Meld: What should I do here?",
            placeHolder: "e.g., Extract this into a reusable hook..."
        });
        if (!prompt)
            return;
        const selection = editor.selection;
        const startLine = Math.max(0, selection.start.line - 20);
        const endLine = Math.min(editor.document.lineCount - 1, selection.end.line + 20);
        const contextLines = editor.document.getText(new vscode.Range(startLine, 0, endLine, Number.MAX_VALUE));
        const selectedText = editor.document.getText(selection);
        const taskText = `[MIND-MELD MICRO-CONTEXT]
File: ${editor.document.uri.fsPath}
Context (Lines ${startLine}-${endLine}):
\`\`\`
${contextLines}
\`\`\`
${selectedText ? `Selected Text:\n\`\`\`\n${selectedText}\n\`\`\`\n` : ''}
Directive: ${prompt}

Action required: Modify the file to fulfill the directive using the editFile tool. Focus only on this specific context.`;
        vscode.window.showInformationMessage('GOALpilot Mind-Meld initiated!');
        provider.postMessage({ type: 'trigger_mind_meld', payload: taskText });
        // Ensure sidebar is visible
        vscode.commands.executeCommand('goalpilot-sidebar.focus');
    });
    context.subscriptions.push(disposable, mindMeldCommand);
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
                case 'copilotTask':
                    // Collect active editor context and relay to webview for WS transmission
                    const activeEditor = vscode.window.activeTextEditor;
                    let fileContent = undefined;
                    let activeFilePath = undefined;
                    if (activeEditor) {
                        activeFilePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
                        const selection = activeEditor.selection;
                        const startLine = Math.max(0, selection.start.line - 50);
                        const endLine = Math.min(activeEditor.document.lineCount - 1, selection.end.line + 50);
                        fileContent = activeEditor.document.getText(new vscode.Range(startLine, 0, endLine, Number.MAX_VALUE));
                        if (selection.isEmpty) {
                            fileContent = `// Context around line ${selection.start.line + 1}:\n` + fileContent;
                        }
                        else {
                            const selectedText = activeEditor.document.getText(selection);
                            fileContent = `// Context around selection (Lines ${startLine + 1}-${endLine + 1}):\n${fileContent}\n\n// Selected Text for context:\n${selectedText}`;
                        }
                    }
                    this._view?.webview.postMessage({
                        type: 'copilot_context',
                        payload: {
                            text: data.text,
                            fileContext: fileContent,
                            filePath: activeFilePath
                        }
                    });
                    break;
                case 'showDiff':
                    const originalUri = vscode.Uri.file(data.filePath);
                    const proposalUri = vscode.Uri.parse(`goalpilot-proposal:${data.filePath}`);
                    this._provider.contentMap.set(proposalUri.path, data.content);
                    vscode.commands.executeCommand('vscode.diff', originalUri, proposalUri, `Proposed: ${data.filePath.split(/[\\/]/).pop()}`);
                    break;
                case 'showDiffEdit':
                    const editOriginalUri = vscode.Uri.file(data.filePath);
                    const editProposalUri = vscode.Uri.parse(`goalpilot-proposal:${data.filePath}`);
                    vscode.workspace.fs.readFile(editOriginalUri).then(fileData => {
                        const originalContent = new TextDecoder().decode(fileData);
                        const newContent = originalContent.replace(data.target, data.replacement);
                        this._provider.contentMap.set(editProposalUri.path, newContent);
                        vscode.commands.executeCommand('vscode.diff', editOriginalUri, editProposalUri, `Proposed Edit: ${data.filePath.split(/[\\/]/).pop()}`);
                    });
                    break;
                case 'liquidCode':
                    const ext = data.filePath.split('.').pop() || '';
                    let lang = 'plaintext';
                    if (['ts', 'tsx'].includes(ext))
                        lang = 'typescript';
                    else if (['js', 'jsx'].includes(ext))
                        lang = 'javascript';
                    else if (['css', 'scss'].includes(ext))
                        lang = 'css';
                    else if (ext === 'html')
                        lang = 'html';
                    else if (ext === 'json')
                        lang = 'json';
                    vscode.workspace.openTextDocument({ language: lang }).then(doc => {
                        vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: true }).then(editor => {
                            const content = data.content;
                            let i = 0;
                            const chunkSize = Math.max(1, Math.floor(content.length / 30));
                            const typeLoop = () => {
                                if (i >= content.length)
                                    return;
                                const chunk = content.substring(i, i + chunkSize);
                                editor.edit(editBuilder => {
                                    editBuilder.insert(editor.document.positionAt(editor.document.getText().length), chunk);
                                }).then(() => {
                                    i += chunkSize;
                                    setTimeout(typeLoop, 20);
                                });
                            };
                            typeLoop();
                        });
                    });
                    break;
                case 'saveSettings':
                    vscode.workspace.getConfiguration('goalpilot').update('longcatApiKey', data.apiKey, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('GOALpilot API Key saved successfully.');
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
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ws://localhost:8080; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';">
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