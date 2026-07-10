import type { WorldInfo } from '../../../shared/protocol';

/** REST client for the world-selection menu. */
export async function listWorlds(): Promise<WorldInfo[]> {
  const res = await fetch('/api/worlds');
  if (!res.ok) throw new Error(`list worlds failed: HTTP ${res.status}`);
  const body = (await res.json()) as { worlds: WorldInfo[] };
  return body.worlds;
}

export async function createWorld(name: string, seed: string): Promise<WorldInfo> {
  const res = await fetch('/api/worlds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, seed }),
  });
  if (!res.ok) throw new Error(`create world failed: HTTP ${res.status}`);
  return res.json();
}

export async function deleteWorld(id: string): Promise<void> {
  const res = await fetch(`/api/worlds/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete world failed: HTTP ${res.status}`);
}
