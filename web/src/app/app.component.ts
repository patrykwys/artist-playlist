import { ChangeDetectionStrategy, Component, DOCUMENT, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStore } from './core/auth.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly auth = inject(AuthStore);
  protected readonly loginFailed = inject(DOCUMENT).location.search.includes('login=failed');
}
