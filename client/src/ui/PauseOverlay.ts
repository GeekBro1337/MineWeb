import type { GameMode } from '../../../shared/protocol';
import { createSettingsForm, type GameSettings, type Settings } from '../game/Settings';

export interface PauseCallbacks {
  /** Re-lock the pointer and return to play. */
  onResume: () => void;
  /** Leave the world and return to the main menu. */
  onQuit: () => void;
  /** A settings value changed — apply it live. */
  onSettingChange?: (key: keyof GameSettings) => void;
  /** Switch survival ⇄ creative. */
  onToggleMode: () => void;
}

/**
 * In-game pause screen, shown whenever the pointer is unlocked (Esc or on
 * entering the world). Offers Resume / Settings / Quit to Title, and embeds the
 * same settings form used by the main menu.
 */
export class PauseOverlay {
  private el: HTMLElement;
  private mainPanel: HTMLElement;
  private settingsPanel: HTMLElement;
  private modeButton: HTMLButtonElement;

  constructor(root: HTMLElement, settings: Settings, cb: PauseCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'screen pause-screen';
    this.el.style.display = 'none';

    this.mainPanel = document.createElement('div');
    this.mainPanel.className = 'panel';
    this.mainPanel.innerHTML = `
      <h1 class="panel-title">Пауза</h1>
      <div class="btn-column"></div>
      <ul class="controls-hint">
        <li><b>W A S D</b> — движение · <b>Space</b> — прыжок · <b>2×Space</b> — полёт (творч.)</li>
        <li><b>Мышь</b> — обзор · <b>ЛКМ/ПКМ</b> — ломать/ставить · <b>E</b> — инвентарь</li>
        <li><b>1–9</b> — слот · <b>ПКМ по печи</b> — открыть · <b>Esc</b> — пауза</li>
      </ul>
    `;
    const col = this.mainPanel.querySelector('.btn-column')!;
    col.appendChild(this.button('Продолжить', 'primary', cb.onResume));
    this.modeButton = this.button('Режим: —', '', cb.onToggleMode);
    col.appendChild(this.modeButton);
    col.appendChild(this.button('Настройки', '', () => this.showSettings()));
    col.appendChild(this.button('Выйти в меню', 'danger', cb.onQuit));

    this.settingsPanel = document.createElement('div');
    this.settingsPanel.className = 'panel';
    this.settingsPanel.style.display = 'none';
    const title = document.createElement('h1');
    title.className = 'panel-title';
    title.textContent = 'Настройки';
    this.settingsPanel.appendChild(title);
    this.settingsPanel.appendChild(createSettingsForm(settings, cb.onSettingChange));
    this.settingsPanel.appendChild(this.button('Назад', 'primary', () => this.showMain()));

    this.el.append(this.mainPanel, this.settingsPanel);
    root.appendChild(this.el);
  }

  private button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'menu-btn' + (variant ? ' ' + variant : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  setMode(mode: GameMode): void {
    this.modeButton.textContent = `Режим: ${mode === 'creative' ? 'Творческий' : 'Выживание'}`;
  }

  show(): void {
    this.el.style.display = 'flex';
    this.showMain();
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  private showMain(): void {
    this.mainPanel.style.display = 'flex';
    this.settingsPanel.style.display = 'none';
  }

  private showSettings(): void {
    this.mainPanel.style.display = 'none';
    this.settingsPanel.style.display = 'flex';
  }

  dispose(): void {
    this.el.remove();
  }
}
