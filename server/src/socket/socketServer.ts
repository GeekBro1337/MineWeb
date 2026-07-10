import type { Server, Socket } from 'socket.io';
import type {
  BlockSetMessage,
  InitMessage,
  PlayerMoveMessage,
  PlayerStateMessage,
} from '../../../shared/protocol';
import { SocketEvents } from '../../../shared/protocol';
import { worldRoom } from '../api/worldsRoutes';
import type { WorldManager } from '../world/worldManager';

interface TrackedPlayer {
  worldId: string;
  state: PlayerStateMessage;
}

/**
 * Realtime layer. Each connection joins the room of the world it selected
 * (passed as a handshake query), and block/position events are scoped to that
 * room — so different worlds are isolated and adding real multiplayer per world
 * is just a matter of rendering the other players in the same room.
 */
export function setupSocketServer(io: Server, manager: WorldManager): void {
  const players = new Map<string, TrackedPlayer>();

  io.on('connection', (socket: Socket) => {
    const worldId = String(socket.handshake.query.worldId ?? '');
    const store = manager.getStore(worldId);
    if (!store) {
      socket.emit(SocketEvents.ServerError, 'world not found');
      socket.disconnect(true);
      return;
    }

    const room = worldRoom(worldId);
    socket.join(room);
    manager.touch(worldId);
    console.log(`[socket] ${socket.id} joined world ${worldId}`);

    const roomPlayers = [...players.values()]
      .filter((p) => p.worldId === worldId)
      .map((p) => p.state);
    const init: InitMessage = {
      playerId: socket.id,
      meta: store.getMeta(),
      players: roomPlayers,
    };
    socket.emit(SocketEvents.Init, init);
    socket.to(room).emit(SocketEvents.PlayerJoined, { playerId: socket.id });

    socket.on(SocketEvents.BlockSet, (msg: BlockSetMessage) => {
      if (!msg || typeof msg !== 'object') return;
      if (store.setBlock(msg.x, msg.y, msg.z, msg.id)) {
        io.to(room).emit(SocketEvents.BlockUpdate, { x: msg.x, y: msg.y, z: msg.z, id: msg.id });
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
      players.set(socket.id, { worldId, state });
      socket.to(room).emit(SocketEvents.PlayerState, state);
    });

    socket.on('disconnect', () => {
      players.delete(socket.id);
      socket.to(room).emit(SocketEvents.PlayerLeft, { playerId: socket.id });
      console.log(`[socket] ${socket.id} left world ${worldId}`);
    });
  });
}
