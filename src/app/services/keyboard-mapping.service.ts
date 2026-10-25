import { Injectable, signal } from '@angular/core';
import { isKeyboardCodeAllowed, KeyboardKey } from '../../core/kalimba';

const STORAGE_KEY = 'kalimbapp.keyboard.v1';

type StoredMapping = Record<string, KeyboardKey>;

function isKeyboardKey(value: unknown): value is KeyboardKey {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<KeyboardKey>;
  return (
    typeof candidate.code === 'string' &&
    isKeyboardCodeAllowed(candidate.code) &&
    typeof candidate.label === 'string' &&
    candidate.label.length > 0
  );
}

function load(): StoredMapping {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isKeyboardKey(value)),
    ) as StoredMapping;
  } catch {
    return {};
  }
}

@Injectable({ providedIn: 'root' })
export class KeyboardMappingService {
  private readonly state = signal<StoredMapping>(load());

  readonly mappings = this.state.asReadonly();

  set(tineId: string, key: KeyboardKey): void {
    if (!isKeyboardKey(key)) {
      return;
    }
    const next = Object.fromEntries(
      Object.entries(this.state()).filter(([, value]) => value.code !== key.code),
    );
    next[tineId] = key;
    this.commit(next);
  }

  reset(): void {
    this.commit({});
  }

  private commit(value: StoredMapping): void {
    this.state.set(value);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // La sesión sigue funcionando aunque el navegador bloquee el almacenamiento.
    }
  }
}
