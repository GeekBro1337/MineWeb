import { Router } from 'express';
import type { Server } from 'socket.io';
import type { BlockSetMessage, ChunkPayload } from '../../../shared/protocol';
import { SocketEvents } from '../../../shared/protocol';
import type { WorldStore } from '../world/worldStore';

const MAX_CHUNK_COORD = 1_000_000;

export function createWorldRouter(store: WorldStore, io: Server): Router {
  const router = Router();

  router.get('/meta', (_req, res) => {
    res.json(store.getMeta());
  });

  router.get('/chunk/:cx/:cz', (req, res) => {
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

  // REST fallback for block edits; the primary realtime path is Socket.IO.
  router.post('/block', (req, res) => {
    const { x, y, z, id } = (req.body ?? {}) as BlockSetMessage;
    if (!store.setBlock(x, y, z, id)) {
      res.status(400).json({ error: 'invalid block edit' });
      return;
    }
    io.emit(SocketEvents.BlockUpdate, { x, y, z, id });
    res.json({ ok: true });
  });

  return router;
}
