import { Game } from './game/Game';
import { Settings } from './game/Settings';
import { Menu } from './ui/Menu';

/**
 * Top-level controller. Owns the shared settings and switches between the menu
 * and a live {@link Game}. Each world session is a fresh Game that is fully
 * disposed on quit, so entering another world never leaks resources.
 */
export class App {
  private settings = new Settings();
  private menu: Menu;
  private game: Game | null = null;

  constructor(private container: HTMLElement) {
    this.menu = new Menu(container, this.settings, {
      onPlay: (id) => void this.playWorld(id),
    });
  }

  start(): void {
    this.menu.show('main');
  }

  private async playWorld(id: string): Promise<void> {
    // Guard against a double-launch (e.g. two rapid clicks): tear down any
    // existing session before starting a new one, or the old Game would leak.
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    this.menu.hide();
    const game = new Game(this.container, id, this.settings, {
      onQuit: () => this.quitToMenu(),
    });
    this.game = game;
    try {
      await game.start();
    } catch (err) {
      console.error('Failed to start world:', err);
      game.dispose();
      if (this.game === game) this.game = null;
      this.menu.show('worlds');
    }
  }

  private quitToMenu(): void {
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    this.menu.show('worlds');
  }
}
