import { WebSocketServer } from 'ws';
import { Agent } from './agent';
import { DatabaseManager } from './db';
import * as dotenv from 'dotenv';

dotenv.config();

const port = 8080;
const wss = new WebSocketServer({ port });

console.log(`Agent Core WebSocket server starting on ws://localhost:${port}`);

wss.on('connection', function connection(ws) {
  console.log('Client connected to Agent Core');

  ws.on('error', console.error);

  let activeAgent: Agent | null = null;
  let currentWorkspaceRoot = process.cwd(); 
  let dbManager: DatabaseManager | null = null;
  let userId: string = '';
  let apiKey: string = '';

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
        ws.send(JSON.stringify({ type: 'ack', payload: `Workspace initialized to ${currentWorkspaceRoot} for user ${userId}` }));
      }
      
      if (message.command === 'startTask') {
        activeAgent = new Agent(ws, currentWorkspaceRoot, dbManager, apiKey);
        activeAgent.runTask(message.text).catch(console.error);
      }
    } catch (e) {
      console.error('Failed to parse message or execute', e);
    }
  });

  ws.send(JSON.stringify({ type: 'ready', payload: 'Agent core is ready' }));
});
