import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface FullscreenImageSettings {
  trueFullscreen: boolean;
}

const DEFAULT_SETTINGS: FullscreenImageSettings = {
  trueFullscreen: true
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;
const TAP_MOVE_THRESHOLD = 4;
const SINGLE_TAP_DELAY_MS = 280;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface Point {
  x: number;
  y: number;
}

/** Fullscreen overlay for a single image: owns its own zoom/pan state and DOM lifecycle. */
class ImageViewer {
  private readonly overlay: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly onClosed: () => void;

  private scale = MIN_SCALE;
  private tx = 0;
  private ty = 0;

  private readonly pointers = new Map<number, Point>();
  private dragStart: Point | null = null;
  private dragOriginTx = 0;
  private dragOriginTy = 0;
  private pinchStartDist = 0;
  private pinchStartScale = MIN_SCALE;
  private moved = false;

  private lastTapTime = 0;
  private lastTapPos: Point = { x: 0, y: 0 };
  private pendingSingleTap: number | null = null;

  private readonly boundedContainer: HTMLElement | null;

  constructor(sourceImg: HTMLImageElement, trueFullscreen: boolean, onClosed: () => void) {
    this.onClosed = onClosed;
    this.boundedContainer = trueFullscreen
      ? null
      : sourceImg.closest<HTMLElement>('.workspace-split.mod-root')
        ?? sourceImg.closest<HTMLElement>('.workspace-tabs')
        ?? null;

    this.overlay = document.body.createDiv({ cls: 'fsi-overlay' });
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.positionOverlay();

    this.img = this.overlay.createEl('img', { cls: 'fsi-img' });
    this.img.src = sourceImg.currentSrc || sourceImg.src;
    this.img.alt = sourceImg.alt || '';
    this.img.draggable = false;

    const controls = this.overlay.createDiv({ cls: 'fsi-controls' });
    const zoomOutBtn = controls.createEl('button', {
      cls: 'fsi-zoom-out',
      text: '−',
      attr: { type: 'button', 'aria-label': 'Zoom out' }
    });
    const zoomInBtn = controls.createEl('button', {
      cls: 'fsi-zoom-in',
      text: '+',
      attr: { type: 'button', 'aria-label': 'Zoom in' }
    });
    const closeBtn = this.overlay.createEl('button', {
      cls: 'fsi-close',
      text: '×',
      attr: { type: 'button', 'aria-label': 'Close' }
    });

    window.requestAnimationFrame(() => this.overlay.classList.add('fsi-visible'));

    this.overlay.addEventListener('click', this.onOverlayClick);
    this.overlay.addEventListener('wheel', this.onWheel, { passive: false });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomBy(ZOOM_STEP);
    });
    zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomBy(-ZOOM_STEP);
    });

    this.img.addEventListener('click', (e) => e.stopPropagation());
    this.img.addEventListener('pointerdown', this.onPointerDown);
    this.img.addEventListener('pointermove', this.onPointerMove);
    this.img.addEventListener('pointerup', this.onPointerUp);
    this.img.addEventListener('pointercancel', this.onPointerUp);

    document.addEventListener('keydown', this.onKeyDown);
    if (this.boundedContainer) {
      window.addEventListener('resize', this.onWindowResize);
    }
  }

  close(): void {
    if (this.pendingSingleTap !== null) {
      window.clearTimeout(this.pendingSingleTap);
      this.pendingSingleTap = null;
    }
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onWindowResize);
    this.overlay.remove();
    this.onClosed();
  }

  private positionOverlay(): void {
    if (!this.boundedContainer) {
      this.overlay.setCssStyles({ top: '0', left: '0', width: '100%', height: '100%' });
      return;
    }
    const rect = this.boundedContainer.getBoundingClientRect();
    this.overlay.setCssStyles({
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  }

  private readonly onWindowResize = (): void => {
    this.positionOverlay();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  private readonly onOverlayClick = (): void => {
    // Only reached for genuine background clicks: the image and buttons
    // stop propagation before an event can bubble up to the overlay.
    this.close();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.setScale(this.scale - e.deltaY * 0.0015 * this.scale);
  };

  private zoomBy(delta: number): void {
    this.setScale(this.scale + delta);
  }

  private setScale(nextScale: number): void {
    this.scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (this.scale === MIN_SCALE) {
      this.tx = 0;
      this.ty = 0;
    }
    this.applyTransform();
  }

  private resetZoom(): void {
    this.scale = MIN_SCALE;
    this.tx = 0;
    this.ty = 0;
    this.applyTransform();
  }

  private toggleZoom(): void {
    if (this.scale > MIN_SCALE) {
      this.resetZoom();
    } else {
      this.setScale(2);
    }
  }

  private applyTransform(): void {
    this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.img.classList.toggle('fsi-zoomed', this.scale > MIN_SCALE);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.img.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved = false;

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchStartScale = this.scale;
      this.dragStart = null;
    } else if (this.pointers.size === 1) {
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dragOriginTx = this.tx;
      this.dragOriginTy = this.ty;
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2 && this.pinchStartDist > 0) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.moved = true;
      this.setScale(this.pinchStartScale * (dist / this.pinchStartDist));
      return;
    }

    if (this.pointers.size === 1 && this.dragStart && this.scale > MIN_SCALE) {
      const p = [...this.pointers.values()][0];
      const dx = p.x - this.dragStart.x;
      const dy = p.y - this.dragStart.y;
      if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD) this.moved = true;
      this.tx = this.dragOriginTx + dx;
      this.ty = this.dragOriginTy + dy;
      this.applyTransform();
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const wasSingle = this.pointers.size === 1;
    const lastPos = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.img.hasPointerCapture(e.pointerId)) this.img.releasePointerCapture(e.pointerId);

    if (this.pointers.size >= 1) {
      // Transitioning from pinch back to a single remaining pointer: re-baseline drag tracking.
      const remaining = [...this.pointers.values()][0];
      this.dragStart = { x: remaining.x, y: remaining.y };
      this.dragOriginTx = this.tx;
      this.dragOriginTy = this.ty;
      return;
    }

    this.dragStart = null;
    if (wasSingle && !this.moved && lastPos) {
      this.handleTap(lastPos.x, lastPos.y);
    }
    this.moved = false;
  };

  private handleTap(x: number, y: number): void {
    const now = Date.now();
    const dt = now - this.lastTapTime;
    const dist = Math.hypot(x - this.lastTapPos.x, y - this.lastTapPos.y);
    const isDoubleTap = dt < DOUBLE_TAP_MS && dist < DOUBLE_TAP_DIST;
    this.lastTapTime = now;
    this.lastTapPos = { x, y };

    if (isDoubleTap) {
      if (this.pendingSingleTap !== null) {
        window.clearTimeout(this.pendingSingleTap);
        this.pendingSingleTap = null;
      }
      this.toggleZoom();
      return;
    }

    if (this.scale > MIN_SCALE) {
      this.resetZoom();
      return;
    }

    // Delay so a following second tap can still be recognized as a double-tap-to-zoom.
    this.pendingSingleTap = window.setTimeout(() => {
      this.pendingSingleTap = null;
      this.close();
    }, SINGLE_TAP_DELAY_MS);
  }
}

export default class FullscreenImagePlugin extends Plugin {
  settings: FullscreenImageSettings = DEFAULT_SETTINGS;
  private activeViewer: ImageViewer | null = null;

  async onload(): Promise<void> {
    const stored = (await this.loadData()) as Partial<FullscreenImageSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    this.addSettingTab(new FullscreenImageSettingTab(this.app, this));
    this.registerDomEvent(document, 'click', this.handleDocumentClick.bind(this));
  }

  onunload(): void {
    this.activeViewer?.close();
    this.activeViewer = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private handleDocumentClick(evt: MouseEvent): void {
    if (this.activeViewer) return;

    const target = evt.target;
    if (!(target instanceof Element)) return;

    const img = target.closest('img');
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.closest('.workspace-leaf-content')) return;

    evt.preventDefault();
    this.activeViewer = new ImageViewer(img, this.settings.trueFullscreen, () => {
      this.activeViewer = null;
    });
  }
}

class FullscreenImageSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: FullscreenImagePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('True fullscreen')
      .setDesc('Expand images to cover the entire window. Turn off to bound the expanded view to the note area, leaving sidebars visible.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.trueFullscreen)
        .onChange(async (value) => {
          this.plugin.settings.trueFullscreen = value;
          await this.plugin.saveSettings();
        }));
  }
}
