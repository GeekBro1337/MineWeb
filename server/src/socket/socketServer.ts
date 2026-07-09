import type { Server, Socket } from 'socket.io';
import type {
  BlockSetMessage,
  InitMessage,
  PlayerMoveMessage,
  PlayerStateMessage,
} from '../../../shared/protocol';
import { SocketEvents } from '../../../shared/protocol';
import type { WorldStore } from '../world/worldStore';

/**
 * Realtime layer. Tracks connected players and relays world edits.
 * Block updates are broadcast to every client (including the sender, which
 * treats the echo as an idempotent confirmation), so adding real multiplayer
 * later is just a matter of rendering the other players.
 */
export function setupSocketServer(io: Server, store: WorldStore): void {
  const players = new Map<string, PlayerStateMessage>();

  io.on('connection', (socket: Socket) => {
    console.log(`[socket] player connected: ${socket.id}`);

    const init: InitMessage = {
      playerId: socket.id,
      meta: store.getMeta(),
      players: [...players.values()],
    };
    socket.emit(SocketEvents.Init, init);
    socket.broadcast.emit(SocketEvents.PlayerJoined, { playerId: socket.id });

    socket.on(SocketEvents.BlockSet, (msg: BlockSetMessage) => {
      if (!msg || typeof msg !== 'object') return;
      if (store.setBlock(msg.x, msg.y, msg.z, msg.id)) {
        io.emit(SocketEvents.BlockUpdate, { x: msg.x, y: msg.y, z: msg.z, id: msg.id });
      }
    });

    socket.on(SocketEvents.PlayerMove, (msg: PlayerMoveMessage) => {
      if (!msg || typeof msg !== 'object') return;
      const state: PlayerStateMessage = {
        playerId: socket.id,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        z: Number(msg.z) || 0,
        yaw: Number(msg.yaw) || 0,
        pitch: Number(msg.pitch) || 0,
      };
      players.set(socket.id, state);
      socket.broadcast.emit(SocketEvents.PlayerState, state);
    });

    socket.on('disconnect', () => {
      players.delete(socket.id);
      socket.broadcast.emit(SocketEvents.PlayerLeft, { playerId: socket.id });
      console.log(`[socket] player disconnected: ${socket.id}`);
    });
  });
}
