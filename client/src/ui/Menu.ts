import type { WorldInfo } from '../../../shared/protocol';
import { createSettingsForm, type Settings } from '../game/Settings';
import { createWorld, deleteWorld, listWorlds } from '../game/WorldsApi';

export interface MenuCallbacks {
  /** The user chose to enter a world. */
  onPlay: (worldId: string) => void;
}

type ScreenName = 'main' | 'worlds' | 'create' | 'settings';

/**
 * Full-screen pre-game menu: title screen, world list (create/delete/play),
 * new-world form and settings. Shown before a world is entered and again after
 * quitting one.
 */
export class Menu {
  private el: HTMLElement;
  private screens: Record<ScreenName, HTMLElement>;
  private worldListEl!: HTMLElement;
  private worldsErrorEl!: HTMLElement;
  private nameInput!: HTMLInputElement;
  private seedInput!: HTMLInputElement;
  private createErrorEl!: HTMLElement;
  private settingsHost!: HTMLElement;
  /** True while a create request is in flight, to reject double submits. */
  private creating = false;

  constructor(
    root: HTMLElement,
    private settings: Settings,
    private cb: MenuCallbacks,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen menu-screen';
    this.el.style.display = 'none';

    this.screens = {
      main: this.buildMain(),
      worlds: this.buildWorlds(),
      create: this.buildCreate(),
      settings: this.buildSettings(),
    };
    for (const screen of Object.values(this.screens)) this.el.appendChild(screen);
    root.appendChild(this.el);
  }

  show(screen: ScreenName = 'main'): void {
    this.el.style.display = 'flex';
    this.showScreen(screen);
    if (screen === 'worlds') void this.refreshWorlds();
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  private showScreen(name: ScreenName): void {
    for (const [key, el] of Object.entries(this.screens)) {
      el.style.display = key === name ? 'flex' : 'none';
    }
  }

  private button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'menu-btn' + (variant ? ' ' + variant : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private buildMain(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'panel menu-main';
    const title = document.createElement('h1');
    title.className = 'game-title';
    title.textContent = 'WebVoxel 3D';
    const sub = document.createElement('p');
    sub.className = 'game-subtitle';
    sub.textContent = 'Воксельная песочница';

    const col = document.createElement('div');
    col.className = 'btn-column';
    col.appendChild(this.button('Одиночная игра', 'primary', () => this.show('worlds')));
    col.appendChild(this.button('Настройки', '', () => this.openSettings()));

    const footer = document.createElement('p');
    footer.className = 'menu-footer';
    footer.textContent = 'WebVoxel 3D — MVP';

    panel.append(title, sub, col, footer);
    return panel;
  }

  private buildWorlds(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'panel menu-worlds';
    const title = document.createElement('h1');
    title.className = 'panel-title';
    title.textContent = 'Выберите мир';

    this.worldListEl = document.createElement('div');
    this.worldListEl.className = 'world-list';
    this.worldsErrorEl = document.createElement('p');
    this.worldsErrorEl.className = 'form-error';

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(this.button('Создать новый мир', 'primary', () => this.openCreate()));
    row.appendChild(this.button('Назад', '', () => this.showScreen('main')));

    panel.append(title, this.worldListEl, this.worldsErrorEl, row);
    return panel;
  }

  private buildCreate(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'panel menu-create';
    const title = document.createElement('h1');
    title.className = 'panel-title';
    title.textContent = 'Создать мир';

    const form = document.createElement('div');
    form.className = 'create-form';

    const nameLabel = document.createElement('label');
    nameLabel.className = 'field';
    nameLabel.innerHTML = '<span>Название мира</span>';
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 40;
    this.nameInput.value = 'Новый мир';
    nameLabel.appendChild(this.nameInput);

    const seedLabel = document.createElement('label');
    seedLabel.className = 'field';
    seedLabel.innerHTML = '<span>Сид (необязательно)</span>';
    this.seedInput = document.createElement('input');
    this.seedInput.type = 'text';
    this.seedInput.maxLength = 40;
    this.seedInput.placeholder = 'случайный';
    seedLabel.appendChild(this.seedInput);

    this.createErrorEl = document.createElement('p');
    this.createErrorEl.className = 'form-error';

    form.append(nameLabel, seedLabel, this.createErrorEl);

    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(this.button('Создать', 'primary', () => void this.submitCreate()));
    row.appendChild(this.button('Назад', '', () => this.showScreen('worlds')));

    panel.append(title, form, row);
    return panel;
  }

  private buildSettings(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'panel menu-settings';
    const title = document.createElement('h1');
    title.className = 'panel-title';
    title.textContent = 'Настройки';
    // The form is (re)built on open so it reflects changes made in-game.
    this.settingsHost = document.createElement('div');
    panel.append(title, this.settingsHost);
    panel.appendChild(this.button('Готово', 'primary', () => this.showScreen('main')));
    return panel;
  }

  private openSettings(): void {
    this.settingsHost.textContent = '';
    this.settingsHost.appendChild(createSettingsForm(this.settings));
    this.showScreen('settings');
  }

  private openCreate(): void {
    this.createErrorEl.textContent = '';
    this.showScreen('create');
    this.nameInput.focus();
    this.nameInput.select();
  }

  private async submitCreate(): Promise<void> {
    // Reject a second click while the first create request is still in flight,
    // otherwise two worlds are created and two Game sessions launch.
    if (this.creating) return;
    this.creating = true;
    this.createErrorEl.textContent = '';
    try {
      const info = await createWorld(this.nameInput.value, this.seedInput.value);
      this.cb.onPlay(info.id);
    } catch (err) {
      this.createErrorEl.textContent = 'Не удалось создать мир. Сервер запущен?';
      console.error(err);
    } finally {
      this.creating = false;
    }
  }

  private async refreshWorlds(): Promise<void> {
    this.worldsErrorEl.textContent = '';
    this.worldListEl.textContent = 'Загрузка…';
    try {
      const worlds = await listWorlds();
      this.renderWorldList(worlds);
    } catch (err) {
      this.worldListEl.textContent = '';
      this.worldsErrorEl.textContent = 'Не удалось загрузить миры. Сервер запущен?';
      console.error(err);
    }
  }

  private renderWorldList(worlds: WorldInfo[]): void {
    this.worldListEl.textContent = '';
    if (worlds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'world-empty';
      empty.textContent = 'Пока нет миров. Создайте новый!';
      this.worldListEl.appendChild(empty);
      return;
    }
    for (const world of worlds) {
      const rowEl = document.createElement('div');
      rowEl.className = 'world-row';

      const meta = document.createElement('div');
      meta.className = 'world-meta';
      const name = document.createElement('div');
      name.className = 'world-name';
      name.textContent = world.name;
      const sub = document.createElement('div');
      sub.className = 'world-sub';
      sub.textContent = `сид ${world.seed} · ${new Date(world.lastPlayed).toLocaleString()}`;
      meta.append(name, sub);

      const actions = document.createElement('div');
      actions.className = 'world-actions';
      actions.appendChild(this.button('Играть', 'primary', () => this.cb.onPlay(world.id)));
      actions.appendChild(
        this.button('Удалить', 'danger', () => void this.confirmDelete(world)),
      );

      rowEl.append(meta, actions);
      this.worldListEl.appendChild(rowEl);
    }
  }

  private async confirmDelete(world: WorldInfo): Promise<void> {
    if (!window.confirm(`Удалить мир «${world.name}»? Это действие необратимо.`)) return;
    try {
      await deleteWorld(world.id);
      await this.refreshWorlds();
    } catch (err) {
      this.worldsErrorEl.textContent = 'Не удалось удалить мир.';
      console.error(err);
    }
  }
}
