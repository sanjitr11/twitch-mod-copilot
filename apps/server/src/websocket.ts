import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { Server } from 'http';
import { Flag, SampledMessage, ChatMessage, SystemStatus } from './types';

export class WebSocketServer {
  private wss: WSServer;
  private clients: Set<WebSocket> = new Set();

  constructor(server: Server) {
    this.wss = new WSServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WebSocket] Client connected');
      this.clients.add(ws);

      ws.on('close', () => {
        console.log('[WebSocket] Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error);
        this.clients.delete(ws);
      });

      // Send initial connection confirmation
      this.send(ws, { type: 'connection', data: { status: 'connected' } });
    });
  }

  private send(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private broadcast(data: any) {
    const message = JSON.stringify(data);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  broadcastFlagCreated(data: { flag: Flag; message: SampledMessage; context: ChatMessage[] }) {
    this.broadcast({
      type: 'flag.created',
      data,
    });
  }

  broadcastSystemStatus(status: SystemStatus) {
    this.broadcast({
      type: 'system.status',
      data: status,
    });
  }
}
