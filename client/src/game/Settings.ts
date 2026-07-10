export interface GameSettings {
  /** Chunk render/generation radius around the player. */
  renderDistance: number;
  /** Camera field of view, degrees. */
  fov: number;
  /** Mouse look sensitivity multiplier. */
  sensitivity: number;
  /** Length of the daytime half of the cycle, minutes (night is the same). */
  dayLengthMinutes: number;
}

interface FieldSpec {
  key: keyof GameSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Formats the value for the readout next to the slider. */
  format: (v: number) => string;
}

export const SETTING_FIELDS: FieldSpec[] = [
  { key: 'renderDistance', label: 'Дальность прорисовки', min: 4, max: 24, step: 1, format: (v) => `${v} чанков` },
  { key: 'fov', label: 'Поле зрения (FOV)', min: 60, max: 110, step: 1, format: (v) => `${v}°` },
  { key: 'sensitivity', label: 'Чувствительность мыши', min: 0.2, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)}×` },
  { key: 'dayLengthMinutes', label: 'Длина дня', min: 1, max: 30, step: 1, format: (v) => `${v} мин` },
];

const DEFAULTS: GameSettings = {
  renderDistance: 12,
  fov: 75,
  sensitivity: 1.0,
  dayLengthMinutes: 10,
};

const STORAGE_KEY = 'webvoxel:settings';

/** Persisted, clamped player settings. A single instance is shared with the game. */
export class Settings {
  private data: GameSettings;

  constructor() {
    this.data = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GameSettings>;
        for (const field of SETTING_FIELDS) {
          const v = parsed[field.key];
          if (typeof v === 'number' && Number.isFinite(v)) {
            this.data[field.key] = this.clamp(field, v);
          }
        }
      }
    } catch {
      // Corrupt storage — fall back to defaults.
    }
  }

  private clamp(field: FieldSpec, v: number): number {
    const clamped = Math.min(field.max, Math.max(field.min, v));
    // Snap to the field's step so stored values stay tidy.
    return Math.round(clamped / field.step) * field.step;
  }

  get<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return this.data[key];
  }

  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    const field = SETTING_FIELDS.find((f) => f.key === key);
    this.data[key] = field ? this.clamp(field, value) : value;
    this.save();
  }

  all(): Readonly<GameSettings> {
    return this.data;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Ignore storage errors (private mode, quota).
    }
  }
}

/**
 * Builds a settings form (a list of labelled sliders). `onChange(key)` fires
 * live as the user drags, so a running game can apply changes immediately.
 */
export function createSettingsForm(settings: Settings, onChange?: (key: keyof GameSettings) => void): HTMLElement {
  const form = document.createElement('div');
  form.className = 'settings-form';

  for (const field of SETTING_FIELDS) {
    const row = document.createElement('label');
    row.className = 'settings-row';

    const head = document.createElement('div');
    head.className = 'settings-row-head';
    const name = document.createElement('span');
    name.textContent = field.label;
    const value = document.createElement('span');
    value.className = 'settings-value';
    value.textContent = field.format(settings.get(field.key));
    head.append(name, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(field.min);
    input.max = String(field.max);
    input.step = String(field.step);
    input.value = String(settings.get(field.key));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      settings.set(field.key, v);
      value.textContent = field.format(settings.get(field.key));
      onChange?.(field.key);
    });

    row.append(head, input);
    form.appendChild(row);
  }

  return form;
}
