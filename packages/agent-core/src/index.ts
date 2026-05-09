import { WebSocketServer } from 'ws';

const port = 8080;
const wss = new WebSocketServer({ port });

console.log(`Agent Core WebSocket server starting on ws://localhost:${port}`);

wss.on('connection', function connection(ws) {
  console.log('Client connected to Agent Core');

  ws.on('error', console.error);

  ws.on('message', function message(data) {
    console.log('received: %s', data);
    
    // Echo back a response to verify communication
    try {
      const message = JSON.parse(data.toString());
      ws.send(JSON.stringify({ 
        type: 'ack', 
        payload: `Received your message: ${message.command}` 
      }));
    } catch (e) {
      console.error('Failed to parse message', e);
    }
  });

  ws.send(JSON.stringify({ type: 'ready', payload: 'Agent core is ready' }));
});
