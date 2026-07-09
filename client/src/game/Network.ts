import { io, type Socket } from 'socket.io-client';
import { SocketEvents } from '../../../shared/protocol';
import type {
  BlockSetMessage,
  BlockUpdateMessage,
  ChunkPayload,
  PlayerMoveMessage,
  WorldMeta,
} from '../../../shared/protocol';

const MOVE_SEND_INTERVAL_MS = 100;

/** All client<->server traffic: REST for world data, Socket.IO for realtime events. */
export class Network {
  private socket: Socket;
  private lastMoveSent = 0;

  onBlockUpdate: ((msg: BlockUpdateMessage) => void) | null = null;

  constructor() {
    // Same origin: the Vite dev server proxies /socket.io and /api to the backend.
    this.socket = io();
    this.socket.on(SocketEvents.BlockUpdate, (msg: BlockUpdateMessage) => {
      this.onBlockUpdate?.(msg);
    });
  }

  async fetchMeta(): Promise<WorldMeta> {
    const res = await fetch('/api/world/meta');
    if (!res.ok) throw new Error(`meta request failed: HTTP ${res.status}`);
    return res.json();
  }

  async fetchChunk(cx: number, cz: number): Promise<Uint8Array> {
    const res = await fetch(`/api/world/chunk/${cx}/${cz}`);
    if (!res.ok) throw new Error(`chunk request failed: HTTP ${res.status}`);
    const payload: ChunkPayload = await res.json();
    return base64ToBytes(payload.data);
  }

  sendBlockSet(msg: BlockSetMessage): void {
    this.socket.emit(SocketEvents.BlockSet, msg);
  }

  /** Throttled — multiplayer needs positions, but not on every frame. */
  sendPlayerMove(msg: PlayerMoveMessage): void {
    const now = performance.now();
    if (now - this.lastMoveSent < MOVE_SEND_INTERVAL_MS) return;
    this.lastMoveSent = now;
    this.socket.emit(SocketEvents.PlayerMove, msg);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
