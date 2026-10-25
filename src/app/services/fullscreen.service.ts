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
  private wantsFullscreen = false;
  private readonly activeState = signal(false);

  readonly isActive = this.activeState.asReadonly();
  readonly supported =
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    document.fullscreenEnabled !== false;

  constructor() {
    if (typeof document !== 'undefined') {
      this.activeState.set(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', () => {
        this.activeState.set(!!document.fullscreenElement);
      });
      document.addEventListener('visibilitychange', () => {
        if (this.wantsFullscreen && document.visibilityState === 'visible' && !this.wakeLock) {
          void this.acquireWakeLock();
        }
      });
    }
  }

  async enter(): Promise<void> {
    this.wantsFullscreen = true;

    if (this.supported) {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
        }
      } catch {
        // iOS Safari y algunos navegadores no permiten fullscreen.
      }
    }

    this.activeState.set(!!document.fullscreenElement);

    try {
      const orientation = screen.orientation as unknown as OrientationWithLock | undefined;
      await orientation?.lock?.('landscape');
    } catch {
      // El bloqueo de orientación requiere fullscreen y soporte del navegador.
    }

    await this.acquireWakeLock();
  }

  async exit(): Promise<void> {
    this.wantsFullscreen = false;
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
      await this.exit();
      return;
    }
    await this.enter();
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
