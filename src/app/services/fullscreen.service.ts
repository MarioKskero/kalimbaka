import { Injectable, signal } from '@angular/core';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
}

interface OrientationWithLock {
  lock?: (orientation: string) => Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class FullscreenService {
  private wakeLock: WakeLockSentinelLike | null = null;
  private active = false;
  private readonly activeState = signal(false);

  readonly isActive = this.activeState.asReadonly();

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (this.active && document.visibilityState === 'visible' && !this.wakeLock) {
          void this.acquireWakeLock();
        }
      });
    }
  }

  async enter(): Promise<void> {
    this.active = true;
    this.activeState.set(true);

    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      }
    } catch {
      // iOS Safari y algunos navegadores no permiten fullscreen.
    }

    try {
      const orientation = screen.orientation as unknown as OrientationWithLock | undefined;
      await orientation?.lock?.('landscape');
    } catch {
      // El bloqueo de orientación requiere fullscreen y soporte del navegador.
    }

    await this.acquireWakeLock();
  }

  async exit(): Promise<void> {
    this.active = false;
    this.activeState.set(false);
    await this.releaseWakeLock();

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      }
    } catch {
      // Sin efecto si el navegador ya salió.
    }
  }

  async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignorar.
      }
      return;
    }
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    } catch {
      // Ignorar.
    }
  }

  private async acquireWakeLock(): Promise<void> {
    if (typeof navigator === 'undefined') {
      return;
    }
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) {
      return;
    }
    try {
      const sentinel = await nav.wakeLock.request('screen');
      this.wakeLock = sentinel;
      sentinel.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const sentinel = this.wakeLock;
    this.wakeLock = null;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {
        // Ignorar.
      }
    }
  }
}
