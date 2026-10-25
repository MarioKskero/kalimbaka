import { Injectable, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private promptEvent: BeforeInstallPromptEvent | null = null;
  private readonly canInstallState = signal(false);
  private readonly standaloneState = signal(false);

  readonly canInstall = this.canInstallState.asReadonly();
  readonly isStandalone = this.standaloneState.asReadonly();

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }

    const standalone =
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      (navigator as NavigatorWithStandalone).standalone === true;
    this.standaloneState.set(standalone);

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.promptEvent = event as BeforeInstallPromptEvent;
      this.canInstallState.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.promptEvent = null;
      this.canInstallState.set(false);
      this.standaloneState.set(true);
    });
  }

  async install(): Promise<void> {
    const event = this.promptEvent;
    if (!event) {
      return;
    }
    this.promptEvent = null;
    this.canInstallState.set(false);
    await event.prompt();
    await event.userChoice;
  }
}
