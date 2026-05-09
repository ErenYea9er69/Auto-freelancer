import { WebSocket } from 'ws';
import { generateResponse } from './llm';
import { tools as executeTool } from './tools';
import { DatabaseManager } from './db';
import * as crypto from 'crypto';

/**
 * CopilotAgent — The obedient mode.
 * 
 * Unlike the autonomous Agent which explores, plans, and delegates,
 * the CopilotAgent receives the user's exact instruction + the file context
 * and performs a single, precise edit cycle. No exploration. No planning.
 * Just do exactly what the user said.
 */

// Minimal tool set for Copilot Mode — only file operations, no exploration
const copilotToolDefs = [
    {
        name: "editFile",
        description: "Surgically edit a file by finding an exact target string and replacing it. The target must match the file content exactly.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file relative to workspace root." },
                target: { type: "string", description: "The exact string to find." },
                replacement: { type: "string", description: "The string to replace with." }
            },
            required: ["filePath", "target", "replacement"]
        }
    },
    {
        name: "writeFile",
        description: "Write content to a file. Only use for creating new files or full rewrites.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file relative to workspace root." },
                content: { type: "string", description: "The content to write." }
            },
            required: ["filePath", "content"]
        }
    },
    {
        name: "readFile",
        description: "Read the contents of a file.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file relative to workspace root." }
            },
            required: ["filePath"]
        }
    }
];

const COPILOT_SYSTEM_PROMPT = `You are GOALpilot in COPILOT MODE — a precise, obedient code editor.

RULES:
1. The user tells you EXACTLY what to do. Do it. Nothing more.
2. You have the file content in your context. Make the change the user requested.
3. Prefer "editFile" for small changes (surgical find-and-replace). Only use "writeFile" when creating new files or rewriting everything.
4. Do NOT explore the filesystem. Do NOT run commands. Do NOT plan or strategize.
5. Make the minimal change necessary to fulfill the user's instruction.
6. After making the edit, confirm what you did in one sentence. No verbose explanations.
7. If the user's instruction is ambiguous, make your best judgment and proceed.

You are fast, precise, and silent. Like a scalpel, not a sledgehammer.`;

export class CopilotAgent {
    private ws: WebSocket;
    private workspaceRoot: string;
    private history: any[] = [];
    private dbManager: DatabaseManager | null;
    private conversationId: string;
    private apiKey: string;
    private isCancelled: boolean = false;
    private pendingApprovals = new Map<string, (result: string) => void>();

    constructor(ws: WebSocket, workspaceRoot: string, dbManager: DatabaseManager | null = null, apiKey: string = "") {
        this.ws = ws;
        this.workspaceRoot = workspaceRoot;
        this.dbManager = dbManager;
        this.apiKey = apiKey;
        this.conversationId = crypto.randomUUID();
        
        // Single global listener for copilot approvals
        this.ws.on('message', (data: any) => {
             try {
                 const msg = JSON.parse(data.toString());
                 if (msg.agentId !== 'copilot') return;
                 
                 if ((msg.command === 'approve' || msg.command === 'reject') && msg.filePath) {
                     const resolve = this.pendingApprovals.get(`file:${msg.filePath}`);
                     if (resolve) {
                         this.pendingApprovals.delete(`file:${msg.filePath}`);
                         resolve(msg.command === 'approve' ? 'approved' : 'rejected');
                     }
                 }
             } catch (e) {}
        });
    }

    private sendTrace(message: string) {
        this.ws.send(JSON.stringify({ type: 'trace', agentId: 'copilot', payload: message }));
    }

    public cancel() {
        this.isCancelled = true;
        this.sendTrace("[COPILOT] Task cancelled by user.");
    }

    /**
     * Run a copilot task. 
     * @param instruction - What the user wants done
     * @param fileContext - The content of the currently active file (optional)
     * @param filePath - The path of the currently active file (optional)
     */
    public async runTask(instruction: string, fileContext?: string, filePath?: string) {
        this.isCancelled = false;
        this.sendTrace(`[COPILOT] Processing: ${instruction.substring(0, 80)}...`);

        // Build a hyper-focused prompt with file context
        let contextBlock = '';
        if (filePath && fileContext) {
            contextBlock = `\n\nCurrently open file: ${filePath}\nFile content:\n\`\`\`\n${fileContext}\n\`\`\``;
        }

        if (this.history.length === 0) {
             this.history = [
                 { role: 'user', parts: [{ text: `${COPILOT_SYSTEM_PROMPT}${contextBlock}\n\nUser instruction: ${instruction}` }] }
             ];
        } else {
             this.history.push({ role: 'user', parts: [{ text: `${contextBlock ? `Context updated:\n${contextBlock}\n\n` : ''}User instruction: ${instruction}` }] });
        }

        // Single-shot: max 3 steps (read → edit → confirm)
        const MAX_STEPS = 3;
        for (let step = 0; step < MAX_STEPS && !this.isCancelled; step++) {
            try {
                const response = await generateResponse(
                    step === 0 ? "Execute the user's instruction now." : "Continue.",
                    this.history,
                    copilotToolDefs,
                    this.apiKey,
                    (chunk) => {
                        this.ws.send(JSON.stringify({ type: 'stream', agentId: 'copilot', payload: chunk }));
                    }
                );

                if (response.usage) {
                    this.ws.send(JSON.stringify({ type: 'usage', payload: response.usage }));
                }

                if (!response.functionCalls || response.functionCalls.length === 0) {
                    const text = response.text || "Done.";
                    this.sendTrace(`[COPILOT] ${text}`);
                    break;
                }

                const call = response.functionCalls[0];
                const args = call.args || {};
                this.sendTrace(`[COPILOT] ${call.name}(${(args.filePath || '').toString().split(/[/\\]/).pop() || '...'})`);

                this.history.push({ role: 'model', parts: [{ functionCall: call }] });

                let toolResult = "";

                if (call.name === 'editFile') {
                    // In Copilot Mode, we auto-approve edits — the user asked for this specifically
                    toolResult = await executeTool.editFile(
                        args.filePath as string,
                        args.target as string,
                        args.replacement as string,
                        this.workspaceRoot
                    );
                    this.sendTrace(`[COPILOT] ✓ ${toolResult}`);
                } else if (call.name === 'writeFile') {
                    // writeFile still needs approval even in copilot mode (safety)
                    this.ws.send(JSON.stringify({
                        type: 'proposal',
                        agentId: 'copilot',
                        payload: { type: 'writeFile', filePath: args.filePath, content: args.content }
                    }));
                    this.sendTrace(`[COPILOT] Waiting for approval to write ${args.filePath}...`);

                    const result = await new Promise<string>((resolve) => {
                         this.pendingApprovals.set(`file:${args.filePath}`, resolve);
                    });

                    if (result === 'approved') {
                        toolResult = await executeTool.writeFile(args.filePath as string, args.content as string, this.workspaceRoot);
                        this.sendTrace(`[COPILOT] ✓ ${toolResult}`);
                    } else {
                        toolResult = "User rejected the write.";
                        this.sendTrace(`[COPILOT] ✗ Rejected.`);
                    }
                } else if (call.name === 'readFile') {
                    toolResult = await executeTool.readFile(args.filePath as string, this.workspaceRoot);
                }

                this.history.push({
                    role: 'user',
                    parts: [{ functionResponse: { id: call.id, name: call.name, response: { result: toolResult } } }]
                });

            } catch (error: any) {
                this.sendTrace(`[COPILOT] Error: ${error.message}`);
                break;
            }
        }

        if (this.dbManager) {
            await this.dbManager.saveConversation(this.conversationId, `[Copilot] ${instruction.substring(0, 40)}`, this.history, []).catch(console.error);
        }
        this.ws.send(JSON.stringify({ type: 'completed', agentId: 'copilot', payload: 'Copilot task finished' }));
    }
}
