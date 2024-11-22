const WebSocket = require('ws');
require('dotenv').config();

const wss = new WebSocket.Server({ port: process.env.PROCTOR_WS_PORT || 8080 });

wss.on('connection', (ws) => {
    console.log('Proctor connected');

    ws.on('message', (message) => {
        // Broadcast message to all connected clients
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        console.log('Proctor disconnected');
    });
});

console.log(`WebSocket server running on port ${process.env.PROCTOR_WS_PORT || 8080}`);