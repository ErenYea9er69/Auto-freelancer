import { WebSocketServer } from 'ws';
import { Agent } from './agent';
import { CopilotAgent } from './copilot-agent';
import { DatabaseManager } from './db';
import { SemanticSoul } from './semantic-index';
import * as dotenv from 'dotenv';

dotenv.config();

const port = 8080;
const wss = new WebSocketServer({ port });

console.log(`Agent Core WebSocket server starting on ws://localhost:${port}`);

wss.on('connection', function connection(ws) {
  console.log('Client connected to Agent Core');

  ws.on('error', console.error);

  let currentWorkspaceRoot = process.cwd(); 
  let dbManager: DatabaseManager | null = null;
  let semanticSoul: SemanticSoul | null = null;
  let userId: string = '';
  let apiKey: string = '';
  
  // Track active agents to allow cancellation
  const activeAgents: Map<string, Agent | CopilotAgent> = new Map();

  ws.on('message', async function message(data) {
    try {
      const message = JSON.parse(data.toString());
      console.log('received command: %s', message.command);
      
      if (message.command === 'init') {
        currentWorkspaceRoot = message.workspaceRoot;
        userId = message.userId;
        apiKey = message.apiKey;
        dbManager = new DatabaseManager(message.storagePath);
        await dbManager.init();
        
        semanticSoul = new SemanticSoul(currentWorkspaceRoot);
        semanticSoul.buildIndex().catch(console.error);
        
        ws.send(JSON.stringify({ type: 'ack', payload: `Workspace initialized to ${currentWorkspaceRoot} for user ${userId}` }));
      }
      
      // Autonomous Mode — full ReAct agent with swarm, semantic search, etc.
      if (message.command === 'startTask') {
        let agent = activeAgents.get('core') as Agent;
        if (!agent) {
            agent = new Agent(ws, currentWorkspaceRoot, dbManager, apiKey, 'core', semanticSoul);
            activeAgents.set('core', agent);
        }
        agent.runTask(message.text).catch(console.error);
      }

      // Copilot Mode — stripped-down, obedient, surgical edits only
      if (message.command === 'startCopilotTask') {
        let copilot = activeAgents.get('copilot') as CopilotAgent;
        if (!copilot) {
            copilot = new CopilotAgent(ws, currentWorkspaceRoot, dbManager, apiKey);
            activeAgents.set('copilot', copilot);
        }
        copilot.runTask(message.text, message.fileContext, message.filePath).catch(console.error);
      }

      // Cancel a running agent
      if (message.command === 'cancel') {
        const agentToCancel = activeAgents.get(message.agentId);
        if (agentToCancel) {
          agentToCancel.cancel();
          activeAgents.delete(message.agentId);
        }
      }

      // Fetch chat history
      if (message.command === 'getHistory') {
        if (dbManager) {
          const index = await dbManager.getIndex();
          ws.send(JSON.stringify({ type: 'history_list', payload: index.conversations }));
        }
      }
    } catch (e) {
      console.error('Failed to parse message or execute', e);
    }
  });

  ws.send(JSON.stringify({ type: 'ready', payload: 'Agent core is ready' }));
});
