import { WebSocket } from 'ws';
import { generateResponse } from './llm';
import { tools as executeTool, toolDefinitions } from './tools';
import { DatabaseManager } from './db';
import * as crypto from 'crypto';

export class Agent {
    private ws: WebSocket;
    private workspaceRoot: string;
    private history: any[] = [];
    private traces: string[] = [];
    private dbManager: DatabaseManager | null;
    private conversationId: string;
    private apiKey: string;

    constructor(ws: WebSocket, workspaceRoot: string, dbManager: DatabaseManager | null = null, apiKey: string = "") {
        this.ws = ws;
        this.workspaceRoot = workspaceRoot;
        this.dbManager = dbManager;
        this.apiKey = apiKey;
        this.conversationId = crypto.randomUUID();
    }

    private sendTrace(message: string) {
        this.traces.push(message);
        this.ws.send(JSON.stringify({ type: 'trace', payload: message }));
    }

    public async runTask(task: string) {
        this.sendTrace(`Initializing task: ${task}`);
        this.history.push({ role: 'user', parts: [{ text: `Task: ${task}\nYou are an autonomous agent. Use tools to complete the task. You MUST call tools to understand the environment and make progress. When you are completely finished, reply with text indicating the task is complete without calling a tool.` }] });

        let isComplete = false;
        let stepCount = 0;
        const MAX_STEPS = 15;

        while (!isComplete && stepCount < MAX_STEPS) {
            stepCount++;
            this.sendTrace(`Reasoning step ${stepCount}...`);
            
            try {
                // Generate response
                const response = await generateResponse("What is your next action?", this.history, toolDefinitions, this.apiKey);
                
                if (!response.functionCalls || response.functionCalls.length === 0) {
                    // No tool called, agent is done or just talking
                    const text = response.text || "Task complete.";
                    this.sendTrace(`Final Output: ${text}`);
                    this.history.push({ role: 'model', parts: [{ text }] });
                    isComplete = true;
                    break;
                }

                const call = response.functionCalls[0];
                const args = call.args || {};
                this.sendTrace(`Executing tool: ${call.name}(${JSON.stringify(args).substring(0, 50)}...)`);
                
                // Add model's tool call to history
                this.history.push({
                    role: 'model',
                    parts: [{ functionCall: call }]
                });

                // Execute tool
                let toolResult = "";
                try {
                    if (call.name === 'readFile') {
                        toolResult = await executeTool.readFile(args.filePath as string, this.workspaceRoot);
                    } else if (call.name === 'writeFile') {
                        this.ws.send(JSON.stringify({ 
                            type: 'proposal', 
                            payload: { type: 'writeFile', filePath: args.filePath, content: args.content } 
                        }));
                        
                        this.sendTrace(`Waiting for user approval to write ${args.filePath}...`);
                        
                        const result = await new Promise<string>((resolve) => {
                            const handler = (data: any) => {
                                try {
                                    const msg = JSON.parse(data.toString());
                                    if (msg.command === 'approve' && msg.filePath === args.filePath) {
                                        this.ws.removeListener('message', handler);
                                        resolve('approved');
                                    } else if (msg.command === 'reject' && msg.filePath === args.filePath) {
                                        this.ws.removeListener('message', handler);
                                        resolve('rejected');
                                    }
                                } catch (e) {}
                            };
                            this.ws.on('message', handler);
                        });

                        if (result === 'approved') {
                            toolResult = await executeTool.writeFile(args.filePath as string, args.content as string, this.workspaceRoot);
                            this.sendTrace(`User APPROVED write to ${args.filePath}`);
                        } else {
                            toolResult = "User REJECTED the file write. Try a different approach or ask for clarification.";
                            this.sendTrace(`User REJECTED write to ${args.filePath}`);
                        }
                    } else if (call.name === 'listDirectory') {
                        toolResult = await executeTool.listDirectory(args.dirPath as string, this.workspaceRoot);
                    } else if (call.name === 'runCommand') {
                        this.ws.send(JSON.stringify({ 
                            type: 'proposal', 
                            payload: { type: 'runCommand', command: args.command } 
                        }));
                        
                        this.sendTrace(`Waiting for user approval to run command: ${args.command}...`);
                        
                        const result = await new Promise<string>((resolve) => {
                            const handler = (data: any) => {
                                try {
                                    const msg = JSON.parse(data.toString());
                                    if (msg.command === 'approve_run' && msg.runCommand === args.command) {
                                        this.ws.removeListener('message', handler);
                                        resolve('approved');
                                    } else if (msg.command === 'reject_run' && msg.runCommand === args.command) {
                                        this.ws.removeListener('message', handler);
                                        resolve('rejected');
                                    }
                                } catch (e) {}
                            };
                            this.ws.on('message', handler);
                        });

                        if (result === 'approved') {
                            toolResult = await executeTool.runCommand(args.command as string, this.workspaceRoot);
                            this.sendTrace(`User APPROVED command: ${args.command}`);
                        } else {
                            toolResult = "User REJECTED the command. Try a different approach or ask for clarification.";
                            this.sendTrace(`User REJECTED command: ${args.command}`);
                        }
                    } else if (call.name === 'gitCommit') {
                        this.ws.send(JSON.stringify({ 
                            type: 'proposal', 
                            payload: { type: 'runCommand', command: `git checkout -b ${args.branchName} && git commit -m "${args.message}"` } 
                        }));
                        
                        this.sendTrace(`Waiting for user approval to commit...`);
                        
                        const result = await new Promise<string>((resolve) => {
                            const handler = (data: any) => {
                                try {
                                    const msg = JSON.parse(data.toString());
                                    if (msg.command === 'approve_run') {
                                        this.ws.removeListener('message', handler);
                                        resolve('approved');
                                    } else if (msg.command === 'reject_run') {
                                        this.ws.removeListener('message', handler);
                                        resolve('rejected');
                                    }
                                } catch (e) {}
                            };
                            this.ws.on('message', handler);
                        });

                        if (result === 'approved') {
                            toolResult = await executeTool.gitCommit(args.branchName as string, args.message as string, this.workspaceRoot);
                            this.sendTrace(`User APPROVED git commit.`);
                        } else {
                            toolResult = "User REJECTED the git commit. Try a different approach or ask for clarification.";
                            this.sendTrace(`User REJECTED git commit.`);
                        }
                    } else {
                        toolResult = `Unknown tool: ${call.name}`;
                    }
                } catch (e: any) {
                    toolResult = `Error executing tool: ${e.message}`;
                }

                this.sendTrace(`Tool Result: ${toolResult.substring(0, 100)}...`);

                // Add tool response to history
                this.history.push({
                    role: 'user', 
                    parts: [{ functionResponse: { name: call.name, response: { result: toolResult } } }]
                });

            } catch (error: any) {
                this.sendTrace(`Error during reasoning: ${error.message}`);
                break;
            }
            
            if (this.dbManager) {
                await this.dbManager.saveConversation(this.conversationId, task.substring(0, 50), this.history, this.traces).catch(e => console.error("DB Save Error:", e));
            }
        }
        
        if (this.dbManager) {
            await this.dbManager.saveConversation(this.conversationId, task.substring(0, 50), this.history, this.traces).catch(e => console.error("DB Save Error:", e));
        }
        this.ws.send(JSON.stringify({ type: 'completed', payload: 'Task finished' }));
    }
}
