import { WebSocketServer } from 'ws';
import { Agent } from './agent';
import * as dotenv from 'dotenv';

dotenv.config();

const port = 8080;
const wss = new WebSocketServer({ port });

console.log(`Agent Core WebSocket server starting on ws://localhost:${port}`);

wss.on('connection', function connection(ws) {
  console.log('Client connected to Agent Core');

  ws.on('error', console.error);

  let activeAgent: Agent | null = null;
  // Fallback to CWD, though extension should send an init message
  let currentWorkspaceRoot = process.cwd(); 

  ws.on('message', async function message(data) {
    try {
      const message = JSON.parse(data.toString());
      console.log('received command: %s', message.command);
      
      if (message.command === 'init') {
        currentWorkspaceRoot = message.workspaceRoot;
        ws.send(JSON.stringify({ type: 'ack', payload: `Workspace initialized to ${currentWorkspaceRoot}` }));
      }
      
      if (message.command === 'startTask') {
        activeAgent = new Agent(ws, currentWorkspaceRoot);
        activeAgent.runTask(message.text).catch(console.error);
      }
    } catch (e) {
      console.error('Failed to parse message or execute', e);
    }
  });

  ws.send(JSON.stringify({ type: 'ready', payload: 'Agent core is ready' }));
});
