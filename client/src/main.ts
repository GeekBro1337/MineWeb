import './styles.css';
import { Game } from './game/Game';

const container = document.getElementById('app');
if (!container) throw new Error('#app element missing in index.html');

const game = new Game(container);
game.start().catch((err: unknown) => {
  console.error('Failed to start game:', err);
  const el = document.createElement('div');
  el.className = 'fatal-error';
  el.textContent =
    'Failed to start: ' + (err instanceof Error ? err.message : String(err)) +
    ' — is the server running on port 3000?';
  document.body.appendChild(el);
});
