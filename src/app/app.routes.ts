import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/library/library.page').then((module) => module.LibraryPage),
  },
  {
    path: 'play/:id',
    loadComponent: () =>
      import('./pages/player/player.page').then((module) => module.PlayerPage),
  },
  { path: '**', redirectTo: '' },
];
