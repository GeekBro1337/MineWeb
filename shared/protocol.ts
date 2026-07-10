import type { BlockId } from './blocks';

/** Socket.IO event names shared by client and server. */
export const SocketEvents = {
  /** server -> client, once after connect */
  Init: 'init',
  /** client -> server: request a block change */
  BlockSet: 'block:set',
  /** server -> all clients: a block changed */
  BlockUpdate: 'block:update',
  /** client -> server: own position/rotation (throttled) */
  PlayerMove: 'player:move',
  /** server -> other clients: someone moved */
  PlayerState: 'player:state',
  PlayerJoined: 'player:joined',
  PlayerLeft: 'player:left',
  /** server -> client: fatal error (e.g. joined a world that no longer exists) */
  ServerError: 'server:error',
} as const;

export interface WorldMeta {
  seed: number;
  chunkSizeX: number;
  chunkSizeZ: number;
  chunkHeight: number;
  spawn: { x: number; y: number; z: number };
}

/** A saved world as listed in the world-selection menu. */
export interface WorldInfo {
  id: string;
  name: string;
  seed: number;
  createdAt: number;
  lastPlayed: number;
}

export interface ChunkPayload {
  cx: number;
  cz: number;
  /** base64-encoded Uint8Array of block ids, ordering per blockIndex() */
  data: string;
}

export interface BlockSetMessage {
  x: number;
  y: number;
  z: number;
  id: BlockId;
}

export type BlockUpdateMessage = BlockSetMessage;

export interface PlayerMoveMessage {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PlayerStateMessage extends PlayerMoveMessage {
  playerId: string;
}

export interface InitMessage {
  playerId: string;
  meta: WorldMeta;
  players: PlayerStateMessage[];
}
