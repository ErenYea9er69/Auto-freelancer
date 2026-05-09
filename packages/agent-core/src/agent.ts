import { WebSocket } from 'ws';
import { generateResponse } from './llm';
import { tools as executeTool, toolDefinitions } from './tools';
import { DatabaseManager } from './db';
import { SemanticSoul } from './semantic-index';
import * as crypto from 'crypto';

export class Agent {
    private ws: WebSocket;
    private workspaceRoot: string;
    private history: any[] = [];
    private traces: string[] = [];
    private dbManager: DatabaseManager | null;
    private conversationId: string;
    private apiKey: string;
    private contextFiles = new Set<string>();
    private semanticSoul: SemanticSoul | null;
    public agentId: string;
    private isCancelled: boolean = false;
    private pendingApprovals = new Map<string, (result: string) => void>();

    constructor(ws: WebSocket, workspaceRoot: string, dbManager: DatabaseManager | null = null, apiKey: string = "", agentId: string = "core", semanticSoul: SemanticSoul | null = null) {
        this.ws = ws;
        this.workspaceRoot = workspaceRoot;
        this.dbManager = dbManager;
        this.apiKey = apiKey;
        this.agentId = agentId;
        this.semanticSoul = semanticSoul;
        this.conversationId = crypto.randomUUID();
        
        // Single global listener for this agent's approvals to prevent memory leaks
        this.ws.on('message', (data: any) => {
             try {
                 const msg = JSON.parse(data.toString());
                 if (msg.agentId !== this.agentId) return;
                 
                 if ((msg.command === 'approve' || msg.command === 'reject') && msg.filePath) {
                     const resolve = this.pendingApprovals.get(`file:${msg.filePath}`);
                     if (resolve) {
                         this.pendingApprovals.delete(`file:${msg.filePath}`);
                         resolve(msg.command === 'approve' ? 'approved' : 'rejected');
                     }
                 } else if ((msg.command === 'approve_run' || msg.command === 'reject_run') && msg.runCommand) {
                     const resolve = this.pendingApprovals.get(`cmd:${msg.runCommand}`);
                     if (resolve) {
                         this.pendingApprovals.delete(`cmd:${msg.runCommand}`);
                         resolve(msg.command === 'approve_run' ? 'approved' : 'rejected');
                     }
                 }
             } catch (e) {}
        });
    }

    private sendTrace(message: string) {
        this.traces.push(message);
        this.ws.send(JSON.stringify({ type: 'trace', agentId: this.agentId, payload: message }));
    }

    private updateGraph(filePath: string) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        if (!fileName || fileName === '.') return;
        
        this.contextFiles.add(fileName);
        
        const nodes = Array.from(this.contextFiles).map(name => ({ id: name, group: 1 }));
        nodes.push({ id: 'Agent Core', group: 0 });
        
        const links = Array.from(this.contextFiles).map(name => ({ source: 'Agent Core', target: name }));

        this.ws.send(JSON.stringify({ 
            type: 'graph_update', 
            agentId: this.agentId,
            payload: { nodes, links } 
        }));
    }

    public cancel() {
        this.isCancelled = true;
        this.sendTrace("Task cancelled by user.");
    }

    public async runTask(task: string) {
        this.isCancelled = false;
        this.sendTrace(`Initializing task: ${task}`);
        
        let injectedContext = "";
        if (this.semanticSoul && this.semanticSoul.isReady) {
            this.sendTrace("🔍 Pre-fetching context using Semantic Soul...");
            const results = await this.semanticSoul.search(task);
            if (results && results.length > 10) {
                injectedContext = `\n\n[SMART CONTEXT INJECTION]\nThe following files and snippets were found to be semantically relevant to your task:\n${results.substring(0, 4000)}\n\nReview this context before taking action.`;
            }
        }
        
        const taskPrompt = `Task: ${task}${injectedContext}\n(Remember to run 'npm run build' after edits and use tools to complete the task.)`;
        
        if (this.history.length === 0) {
            const systemPrompt = `You are an autonomous agent. Use tools to complete the task. You MUST call tools to understand the environment and make progress. When you are completely finished, reply with text indicating the task is complete without calling a tool.\nCRITICAL RULE: After modifying any files (using writeFile or editFile), you MUST run the 'sandboxedCommand' tool with "npm run build" to verify that the code compiles successfully. If the build fails, you MUST fix the errors before completing the task.`;
            this.history.push({ role: 'user', parts: [{ text: `${systemPrompt}\n\n${taskPrompt}` }] });
        } else {
            this.history.push({ role: 'user', parts: [{ text: taskPrompt }] });
        }

        let isComplete = false;
        let stepCount = 0;
        const MAX_STEPS = 15;

        while (!isComplete && stepCount < MAX_STEPS && !this.isCancelled) {
            stepCount++;
            this.sendTrace(`Reasoning step ${stepCount}...`);
            
            try {
                // Generate response
                const response = await generateResponse("What is your next action?", this.history, toolDefinitions, this.apiKey, (chunk) => {
                    this.ws.send(JSON.stringify({ type: 'stream', agentId: this.agentId, payload: chunk }));
                });
                
                if (response.usage) {
                    this.ws.send(JSON.stringify({ type: 'usage', payload: response.usage }));
                }

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
                        this.updateGraph(args.filePath as string);
                        toolResult = await executeTool.readFile(args.filePath as string, this.workspaceRoot);
                    } else if (call.name === 'writeFile') {
                        this.updateGraph(args.filePath as string);
                        this.ws.send(JSON.stringify({ 
                            type: 'proposal', 
                            agentId: this.agentId,
                            payload: { type: 'writeFile', filePath: args.filePath, content: args.content } 
                        }));
                        
                        this.sendTrace(`Waiting for user approval to write ${args.filePath}...`);
                        
                        const result = await new Promise<string>((resolve) => {
                             this.pendingApprovals.set(`file:${args.filePath}`, resolve);
                        });

                        if (result === 'approved') {
                            toolResult = await executeTool.writeFile(args.filePath as string, args.content as string, this.workspaceRoot);
                            this.sendTrace(`User APPROVED write to ${args.filePath}`);
                        } else {
                            toolResult = "User REJECTED the file write. Try a different approach or ask for clarification.";
                            this.sendTrace(`User REJECTED write to ${args.filePath}`);
                        }
                    } else if (call.name === 'editFile') {
                        this.updateGraph(args.filePath as string);
                        // editFile uses the same approval flow as writeFile
                        this.ws.send(JSON.stringify({ 
                            type: 'proposal', 
                            agentId: this.agentId,
                            payload: { type: 'editFile', filePath: args.filePath, target: args.target, replacement: args.replacement } 
                        }));
                        
                        this.sendTrace(`Waiting for user approval to edit ${args.filePath}...`);
                        
                        const result = await new Promise<string>((resolve) => {
                             this.pendingApprovals.set(`file:${args.filePath}`, resolve);
                        });

                        if (result === 'approved') {
                            toolResult = await executeTool.editFile(args.filePath as string, args.target as string, args.replacement as string, this.workspaceRoot);
                            this.sendTrace(`User APPROVED edit to ${args.filePath}`);
                        } else {
                            toolResult = "User REJECTED the file edit. Try a different approach or ask for clarification.";
                            this.sendTrace(`User REJECTED edit to ${args.filePath}`);
                        }
                    } else if (call.name === 'listDirectory') {
                        this.updateGraph(args.dirPath as string);
                        toolResult = await executeTool.listDirectory(args.dirPath as string, this.workspaceRoot);
                    } else if (call.name === 'runCommand') {
                        this.ws.send(JSON.stringify({ 
                            type: 'proposal', 
                            agentId: this.agentId,
                            payload: { type: 'runCommand', command: args.command } 
                        }));
                        
                        this.sendTrace(`Waiting for user approval to run command: ${args.command}...`);
                        
                        const result = await new Promise<string>((resolve) => {
                             this.pendingApprovals.set(`cmd:${args.command}`, resolve);
                        });
                        
                        if (result === 'approved') {
                            this.sendTrace(`Executing: ${args.command}...`);
                            toolResult = await executeTool.runCommand(args.command as string, this.workspaceRoot);
                            this.sendTrace(`Command Output:\n${toolResult}`);
                        } else {
                            toolResult = "User REJECTED the command. Try a different approach or ask for clarification.";
                            this.sendTrace(`User REJECTED command: ${args.command}`);
                        }
                    } else if (call.name === 'sandboxedCommand') {
                        this.sendTrace(`[CI SANDBOX] Running: ${args.command}...`);
                        toolResult = await executeTool.runCommand(args.command as string, this.workspaceRoot);
                        this.sendTrace(`[CI SANDBOX] Output:\n${toolResult}`);
                    } else if (call.name === 'semanticSearch') {
                        this.sendTrace(`[SEMANTIC SOUL] Searching for: "${args.query}"...`);
                        if (this.semanticSoul && this.semanticSoul.isReady) {
                            toolResult = await this.semanticSoul.search(args.query as string);
                        } else {
                            toolResult = "Semantic index is still building or unavailable. Try again shortly or use standard tools.";
                        }
                    } else if (call.name === 'gitCommit') {
                        this.ws.send(JSON.stringify({ 
                            type: 'proposal', 
                            agentId: this.agentId,
                            payload: { type: 'runCommand', command: `git checkout -b ${args.branchName} && git commit -m "${args.message}"` } 
                        }));
                        
                        this.sendTrace(`Waiting for user approval to commit...`);
                        
                        const result = await new Promise<string>((resolve) => {
                            const handler = (data: any) => {
                                try {
                                    const msg = JSON.parse(data.toString());
                                    if (msg.command === 'approve_run' && msg.agentId === this.agentId) {
                                        this.ws.removeListener('message', handler);
                                        resolve('approved');
                                    } else if (msg.command === 'reject_run' && msg.agentId === this.agentId) {
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
                    } else if (call.name === 'delegateTask') {
                        const subAgentName = args.agentName as string;
                        this.sendTrace(`Spawning sub-agent: [${subAgentName}]...`);
                        const subAgent = new Agent(this.ws, this.workspaceRoot, this.dbManager, this.apiKey, subAgentName);
                        
                        // Fire and forget, or we could await it. Fire and forget gives true swarm parallelism.
                        subAgent.runTask(args.task as string).catch(e => console.error(`Sub-agent ${subAgentName} error:`, e));
                        
                        toolResult = `Successfully delegated task to sub-agent [${subAgentName}]. They are now working in parallel. Do not wait for them unless necessary. You can continue with other work.`;
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
                    parts: [{ functionResponse: { id: call.id, name: call.name, response: { result: toolResult } } }]
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
        this.ws.send(JSON.stringify({ type: 'completed', agentId: this.agentId, payload: 'Task finished' }));
    }
}
