import { Router } from 'express';
import type { Server } from 'socket.io';
import type { BlockSetMessage, ChunkPayload } from '../../../shared/protocol';
import { SocketEvents } from '../../../shared/protocol';
import type { WorldManager } from '../world/worldManager';

const MAX_CHUNK_COORD = 1_000_000;

/** Room name a world's players and block updates are scoped to. */
export function worldRoom(id: string): string {
  return `world:${id}`;
}

/**
 * REST API for the world menu (list/create/delete) and world data
 * (meta/chunk/block). Block edits are also broadcast over Socket.IO to the
 * world's room; the socket path is primary, this is the fallback.
 */
export function createWorldsRouter(manager: WorldManager, io: Server): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ worlds: manager.list() });
  });

  router.post('/', (req, res) => {
    const { name, seed } = (req.body ?? {}) as { name?: unknown; seed?: unknown };
    const info = manager.create(name, seed);
    res.status(201).json(info);
  });

  router.delete('/:id', (req, res) => {
    if (!manager.delete(req.params.id)) {
      res.status(404).json({ error: 'world not found' });
      return;
    }
    // Kick anyone still connected to the deleted world so they return to the
    // menu instead of editing a ghost world (the store is already closed, so
    // any in-flight edit is a no-op and cannot resurrect the file).
    const room = worldRoom(req.params.id);
    io.to(room).emit(SocketEvents.ServerError, 'world deleted');
    io.in(room).disconnectSockets(true);
    res.json({ ok: true });
  });

  router.get('/:id/meta', (req, res) => {
    const store = manager.getStore(req.params.id);
    if (!store) {
      res.status(404).json({ error: 'world not found' });
      return;
    }
    res.json(store.getMeta());
  });

  router.get('/:id/chunk/:cx/:cz', (req, res) => {
    const store = manager.getStore(req.params.id);
    if (!store) {
      res.status(404).json({ error: 'world not found' });
      return;
    }
    const cx = Number(req.params.cx);
    const cz = Number(req.params.cz);
    if (
      !Number.isInteger(cx) || !Number.isInteger(cz) ||
      Math.abs(cx) > MAX_CHUNK_COORD || Math.abs(cz) > MAX_CHUNK_COORD
    ) {
      res.status(400).json({ error: 'invalid chunk coordinates' });
      return;
    }
    const chunk = store.getChunk(cx, cz);
    const payload: ChunkPayload = {
      cx,
      cz,
      data: Buffer.from(chunk.data).toString('base64'),
    };
    res.json(payload);
  });

  router.post('/:id/block', (req, res) => {
    const store = manager.getStore(req.params.id);
    if (!store) {
      res.status(404).json({ error: 'world not found' });
      return;
    }
    const { x, y, z, id } = (req.body ?? {}) as BlockSetMessage;
    if (!store.setBlock(x, y, z, id)) {
      res.status(400).json({ error: 'invalid block edit' });
      return;
    }
    io.to(worldRoom(req.params.id)).emit(SocketEvents.BlockUpdate, { x, y, z, id });
    res.json({ ok: true });
  });

  return router;
}
