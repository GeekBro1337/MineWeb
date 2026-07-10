import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { createWorldsRouter } from './api/worldsRoutes';
import { setupSocketServer } from './socket/socketServer';
import { WorldManager } from './world/worldManager';

const PORT = Number(process.env.PORT ?? 3000);
// npm scripts run with cwd = /server, so worlds land in server/data/worlds/.
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');

const manager = new WorldManager(DATA_DIR);

const app = express();
app.use(express.json());

const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use('/api/worlds', createWorldsRouter(manager, io));
setupSocketServer(io, manager);

// In production the same server serves the built client.
//   dev  (tsx, runs from src/):           __dirname = server/src            -> ../../client/dist
//   prod (compiled to dist/server/src/):  __dirname = server/dist/server/src -> ../../../../client/dist
const clientDistCandidates = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../../../../client/dist'),
];
const clientDist = clientDistCandidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
if (clientDist) {
  app.use(express.static(clientDist));
  console.log(`[server] serving client from ${clientDist}`);
} else {
  console.log('[server] no client build found — use "npm run dev:client" for development or run "npm run build"');
}

httpServer.listen(PORT, () => {
  console.log(`[server] WebVoxel server listening on http://localhost:${PORT}`);
});

function shutdown(): void {
  console.log('\n[server] shutting down, saving worlds…');
  manager.closeAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
