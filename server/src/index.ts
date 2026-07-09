import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { createWorldRouter } from './api/worldRoutes';
import { setupSocketServer } from './socket/socketServer';
import { WorldStore } from './world/worldStore';

const PORT = Number(process.env.PORT ?? 3000);
// npm scripts run with cwd = /server, so the world lands in server/data/world.json.
const WORLD_FILE = process.env.WORLD_FILE ?? path.resolve(process.cwd(), 'data/world.json');

const store = new WorldStore(WORLD_FILE);

const app = express();
app.use(express.json());

const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use('/api/world', createWorldRouter(store, io));
setupSocketServer(io, store);

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
  console.log('\n[server] shutting down, saving world…');
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
