import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Generate · Artist mix',
    loadComponent: () => import('./pages/generator-page.component').then((m) => m.GeneratorPageComponent),
  },
  { path: '**', redirectTo: '' },
];
