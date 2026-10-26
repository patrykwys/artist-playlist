import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';

/** Where a card was, and how far its station was scrolled then, so scrolling alone doesn't count as moving. */
export interface Measured {
  rect: DOMRect;
  station: HTMLElement | null;
  scrollTop: number;
}

/**
 * Cards that move between stations fly there (FLIP). Before a step the view measures every card marked
 * `data-flip="key"` and every station anchor marked `data-anchor="key"`. After Angular renders the step, each card
 * that moved, or that is new and names where it came from in `data-from` (keys separated by spaces, the first
 * one measured wins), gets a copy that flies from the old place to the new one along an arc, with an arrow trail.
 * The copies live in this fixed layer, so stations that scroll or clip don't cut them off. The real card stays
 * hidden until its copy lands. Copies and trails are styled globally (`.is-flying`, `.trail`): they are made
 * outside Angular's templates.
 */
@Component({
  selector: 'app-flight-layer',
  template: `
    <svg #trails class="trails">
      <defs>
        <marker id="engine-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path class="arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
    </svg>
  `,
  styles: `
    :host {
      position: fixed;
      z-index: 60;
      inset: 0;
      pointer-events: none;
    }

    .trails {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .arrow-head {
      fill: var(--accent);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
})
export class FlightLayerComponent {
  readonly #layer: HTMLElement = inject(ElementRef).nativeElement;
  private readonly trails = viewChild.required<ElementRef<SVGSVGElement>>('trails');

  readonly #inFlight = new Map<string, { copy: HTMLElement; animation: Animation }>();
  readonly #reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: true };

  /** Where every card and anchor in `root` is now; cards scrolled out of their station's view are left out. */
  measure(root: HTMLElement): Map<string, Measured> {
    const rects = new Map<string, Measured>();
    for (const element of root.querySelectorAll<HTMLElement>('[data-flip], [data-anchor]')) {
      const key = element.dataset['flip'] ?? element.dataset['anchor'];
      if (!key) {
        continue;
      }
      const rect = (this.#inFlight.get(key)?.copy ?? element).getBoundingClientRect();
      if (isVisible(element, rect)) {
        const station = stationOf(element);
        rects.set(key, { rect, station, scrollTop: station?.scrollTop ?? 0 });
      }
    }
    return rects;
  }

  /** Flies every card in `root` that moved since `before` was measured. `speed` shortens flights at higher speeds. */
  fly(root: HTMLElement, before: Map<string, Measured>, speed: number): void {
    if (this.#reducedMotion.matches) {
      return;
    }
    // Bring the newest cards into view first, so they are seen landing.
    root.querySelectorAll<HTMLElement>('[data-keep-visible]').forEach(scrollIntoStation);
    for (const element of root.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = element.dataset['flip'] ?? '';
      const from = startOf(element, before.get(key)) ?? firstMeasured(element.dataset['from'], before);
      if (!from) {
        continue;
      }
      const to = element.getBoundingClientRect();
      if (to.width > 0 && isVisible(element, to) && Math.hypot(from.left - to.left, from.top - to.top) > 3) {
        this.#launch(key, element, from, to, speed);
      }
    }
  }

  #launch(key: string, element: HTMLElement, from: DOMRect, to: DOMRect, speed: number): void {
    this.#inFlight.get(key)?.animation.cancel();

    const copy = element.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-flip');
    copy.removeAttribute('data-keep-visible');
    copy.classList.add('is-flying');
    Object.assign(copy.style, {
      position: 'fixed',
      left: `${to.left}px`,
      top: `${to.top}px`,
      width: `${to.width}px`,
      height: `${to.height}px`,
      margin: '0',
    });
    this.#layer.append(copy);
    element.style.visibility = 'hidden';

    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const distance = Math.hypot(dx, dy);
    // Long trips arc higher; a card sliding within its station barely lifts.
    const lift = Math.min(90, distance * 0.22);
    const duration = Math.min(950, 360 + distance * 0.45) / Math.sqrt(speed);
    const scaleX = from.width / to.width;
    const scaleY = from.height / to.height;
    const keyframes = Array.from({ length: 11 }, (_, index) => {
      const t = easeInOut(index / 10);
      // Quadratic Bézier from the old place (dx, dy) to the new one (0, 0), lifted in the middle.
      const x = (1 - t) ** 2 * dx + 2 * (1 - t) * t * (dx / 2);
      const y = (1 - t) ** 2 * dy + 2 * (1 - t) * t * (dy / 2 - lift);
      const sx = scaleX + (1 - scaleX) * t;
      const sy = scaleY + (1 - scaleY) * t;
      return { transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy})` };
    });
    const animation = copy.animate(keyframes, { duration, easing: 'linear' });
    const land = (): void => {
      copy.remove();
      element.style.visibility = '';
      if (this.#inFlight.get(key)?.copy === copy) {
        this.#inFlight.delete(key);
      }
    };
    animation.onfinish = land;
    animation.oncancel = land;
    this.#inFlight.set(key, { copy, animation });

    if (distance > 60) {
      this.#trail(from, to, lift, duration, getComputedStyle(element).getPropertyValue('--hue').trim() || '275');
    }
  }

  /** An arrow drawn along the flight path, then faded. */
  #trail(from: DOMRect, to: DOMRect, lift: number, duration: number, hue: string): void {
    const svg = this.trails().nativeElement;
    if (svg.childElementCount > 40) {
      return;
    }
    const x1 = from.left + from.width / 2;
    const y1 = from.top + from.height / 2;
    const x2 = to.left + to.width / 2;
    const y2 = to.top + to.height / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 - lift * 2} ${x2} ${y2}`);
    path.setAttribute('class', 'trail');
    path.setAttribute('marker-end', 'url(#engine-arrow)');
    path.style.setProperty('--hue', hue);
    svg.append(path);
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    const draw = path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
      duration,
      easing: 'cubic-bezier(.45, .05, .25, 1)',
      fill: 'forwards',
    });
    draw.onfinish = () => {
      const fade = path.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: 'forwards' });
      fade.onfinish = () => path.remove();
    };
  }
}

/** Where the card was, shifted by however far its station has scrolled since, if it is still in that station. */
function startOf(element: HTMLElement, measured: Measured | undefined): DOMRect | undefined {
  if (!measured) {
    return undefined;
  }
  const { rect, station, scrollTop } = measured;
  if (!station || station !== stationOf(element)) {
    return rect;
  }
  return new DOMRect(rect.left, rect.top - (station.scrollTop - scrollTop), rect.width, rect.height);
}

function firstMeasured(keys: string | undefined, rects: Map<string, Measured>): DOMRect | undefined {
  for (const key of keys?.split(' ') ?? []) {
    const measured = rects.get(key);
    if (measured) {
      return measured.rect;
    }
  }
  return undefined;
}

function stationOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('[data-scroll]');
}

/** Inside its scrolling station's visible area (or not in one at all). */
function isVisible(element: HTMLElement, rect: DOMRect): boolean {
  const station = stationOf(element)?.getBoundingClientRect();
  return !station || (rect.bottom > station.top && rect.top < station.bottom);
}

/** Scrolls only the card's own station, never the page around it. */
function scrollIntoStation(element: HTMLElement): void {
  const station = stationOf(element);
  if (!station) {
    return;
  }
  const box = station.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  if (rect.top < box.top) {
    station.scrollTop -= box.top - rect.top + 8;
  } else if (rect.bottom > box.bottom) {
    station.scrollTop += rect.bottom - box.bottom + 8;
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}
