import { Component, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FullscreenService } from './services/fullscreen.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly fullscreen = inject(FullscreenService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    if (typeof document === 'undefined') {
      return;
    }

    const requestFullscreen = () => {
      document.removeEventListener('pointerdown', requestFullscreen, true);
      document.removeEventListener('keydown', requestFullscreen, true);
      void this.fullscreen.enter();
    };

    document.addEventListener('pointerdown', requestFullscreen, true);
    document.addEventListener('keydown', requestFullscreen, true);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('pointerdown', requestFullscreen, true);
      document.removeEventListener('keydown', requestFullscreen, true);
    });
  }
}
