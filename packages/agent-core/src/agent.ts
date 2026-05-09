import { WebSocket } from 'ws';
import { generateResponse } from './llm';
import { tools as executeTool, toolDefinitions } from './tools';

export class Agent {
    private ws: WebSocket;
    private workspaceRoot: string;
    private history: any[] = [];

    constructor(ws: WebSocket, workspaceRoot: string) {
        this.ws = ws;
        this.workspaceRoot = workspaceRoot;
    }

    private sendTrace(message: string) {
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
                const response = await generateResponse("What is your next action?", this.history, toolDefinitions);
                
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
                            payload: { filePath: args.filePath, content: args.content } 
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
                        toolResult = await executeTool.runCommand(args.command as string, this.workspaceRoot);
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
        }
        
        this.ws.send(JSON.stringify({ type: 'completed', payload: 'Task finished' }));
    }
}
