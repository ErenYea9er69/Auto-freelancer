import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('GOALpilot extension is now active!');

    // Register Webview provider for sidebar
    const provider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('goalpilot-sidebar', provider)
    );

    // Register command
    let disposable = vscode.commands.registerCommand('goalpilot.start', () => {
        vscode.window.showInformationMessage('GOALpilot started!');
    });

    context.subscriptions.push(disposable);
}

class SidebarProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();
        
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.command) {
                case 'startTask':
                    vscode.window.showInformationMessage('Task Started: ' + data.text);
                    break;
            }
        });
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>GOALpilot</title>
            <style>
                body { font-family: var(--vscode-font-family); padding: 10px; }
                h2 { color: var(--vscode-editor-foreground); }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 12px; cursor: pointer; }
                button:hover { background: var(--vscode-button-hoverBackground); }
            </style>
        </head>
        <body>
            <h2>GOALpilot Agent</h2>
            <p>Welcome to your autonomous coding agent.</p>
            <button id="startTask">Start Task</button>
            <script>
                const vscode = acquireVsCodeApi();
                document.getElementById('startTask').addEventListener('click', () => {
                    vscode.postMessage({ command: 'startTask', text: 'Task started from UI' });
                });
            </script>
        </body>
        </html>`;
    }
}

export function deactivate() {}
