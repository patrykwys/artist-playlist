import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Generate · Artist mix',
    loadComponent: () => import('./pages/generator-page.component').then((m) => m.GeneratorPageComponent),
  },
  {
    path: 'playlists',
    title: 'My playlists · Artist mix',
    loadComponent: () => import('./pages/playlists-page.component').then((m) => m.PlaylistsPageComponent),
  },
  {
    path: 'lab',
    title: 'Algorithm lab · Artist mix',
    loadComponent: () => import('./pages/lab-page.component').then((m) => m.LabPageComponent),
  },
  { path: '**', redirectTo: '' },
];
