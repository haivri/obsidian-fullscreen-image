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
const DEFAULT_DOUBLE_TAP_SCALE = 2;
const REOPEN_SUPPRESSION_MS = 500;
const CLOSE_ALL_VIEWERS_EVENT = 'fullscreen-image:close-all';

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
  private readonly previouslyFocused: HTMLElement | null;

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
  private closed = false;

  private readonly boundedContainer: HTMLElement | null;

  constructor(sourceImg: HTMLImageElement, trueFullscreen: boolean, onClosed: () => void) {
    this.onClosed = onClosed;
    this.previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.boundedContainer = trueFullscreen
      ? null
      : sourceImg.closest<HTMLElement>('.workspace-split.mod-root')
        ?? sourceImg.closest<HTMLElement>('.workspace-tabs')
        ?? null;

    this.overlay = document.body.createDiv({ cls: 'fsi-overlay' });
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', sourceImg.alt || 'Image viewer');
    this.overlay.tabIndex = -1;
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
    window.requestAnimationFrame(() => closeBtn.focus());

    this.overlay.addEventListener('click', this.onOverlayClick);
    this.overlay.addEventListener('pointerdown', this.onOverlayPointerDown);
    this.overlay.addEventListener('wheel', this.onWheel, { passive: false });
    closeBtn.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
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
    this.img.addEventListener('load', this.onImageLoad);
    this.img.addEventListener('pointerdown', this.onPointerDown);
    this.img.addEventListener('pointermove', this.onPointerMove);
    this.img.addEventListener('pointerup', this.onPointerUp);
    this.img.addEventListener('pointercancel', this.onPointerUp);

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener(CLOSE_ALL_VIEWERS_EVENT, this.onCloseAllViewers);
    window.addEventListener('resize', this.onWindowResize);
    if (this.img.complete) window.requestAnimationFrame(this.onImageLoad);
  }

  close(): void {
    document.dispatchEvent(new Event(CLOSE_ALL_VIEWERS_EVENT));
    // Also clear an overlay left behind by an older hot-reloaded build that
    // predates the shared close event.
    document.querySelectorAll('.fsi-overlay').forEach((overlay) => overlay.remove());
  }

  private dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pendingSingleTap !== null) {
      window.clearTimeout(this.pendingSingleTap);
      this.pendingSingleTap = null;
    }
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener(CLOSE_ALL_VIEWERS_EVENT, this.onCloseAllViewers);
    window.removeEventListener('resize', this.onWindowResize);
    this.overlay.remove();
    this.previouslyFocused?.focus();
    this.onClosed();
  }

  private readonly onCloseAllViewers = (): void => {
    this.dispose();
  };

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
    this.sizeImageToViewport();
    this.clampPan();
    this.applyTransform();
  };

  private readonly onImageLoad = (): void => {
    // Natural dimensions are only available after load. Reapply the bounds then,
    // so portrait and landscape images both remain stable from their first zoom.
    this.sizeImageToViewport();
    this.clampPan();
    this.applyTransform();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  private readonly onOverlayClick = (e: MouseEvent): void => {
    if (e.target !== this.overlay) return;
    this.close();
  };

  private readonly onOverlayPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || e.target !== this.overlay) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.setScale(this.scale - e.deltaY * 0.0015 * this.scale, { x: e.clientX, y: e.clientY });
  };

  private zoomBy(delta: number): void {
    this.setScale(this.scale + delta);
  }

  private setScale(nextScale: number, focalPoint?: Point): void {
    const previousScale = this.scale;
    this.scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);

    if (focalPoint && this.scale !== previousScale) {
      // Preserve the part of the image directly under the mouse or pinch center.
      // This prevents the image from drifting toward the viewport center mid-gesture.
      const rect = this.overlay.getBoundingClientRect();
      const focalX = focalPoint.x - rect.left - rect.width / 2;
      const focalY = focalPoint.y - rect.top - rect.height / 2;
      const imageX = (focalX - this.tx) / previousScale;
      const imageY = (focalY - this.ty) / previousScale;
      this.tx = focalX - imageX * this.scale;
      this.ty = focalY - imageY * this.scale;
    }

    if (this.scale === MIN_SCALE) {
      this.tx = 0;
      this.ty = 0;
    } else {
      this.clampPan();
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
      this.setScale(DEFAULT_DOUBLE_TAP_SCALE);
    }
  }

  /** Keep the visible image centered or bounded while panning. */
  private clampPan(): void {
    const viewportWidth = this.overlay.clientWidth;
    const viewportHeight = this.overlay.clientHeight;
    let imageWidth = viewportWidth;
    let imageHeight = viewportHeight;

    if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
      const fitScale = Math.min(
        viewportWidth / this.img.naturalWidth,
        viewportHeight / this.img.naturalHeight
      );
      imageWidth = this.img.naturalWidth * fitScale;
      imageHeight = this.img.naturalHeight * fitScale;
    }

    // Only permit panning in a direction once the rendered image exceeds the viewport.
    // At lower zoom levels this keeps the image centered instead of allowing it to drift.
    const maxX = Math.max(0, (imageWidth * this.scale - viewportWidth) / 2);
    const maxY = Math.max(0, (imageHeight * this.scale - viewportHeight) / 2);
    this.tx = clamp(this.tx, -maxX, maxX);
    this.ty = clamp(this.ty, -maxY, maxY);
  }

  private applyTransform(): void {
    this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.img.classList.toggle('fsi-zoomed', this.scale > MIN_SCALE);
  }

  private sizeImageToViewport(): void {
    if (this.img.naturalWidth <= 0 || this.img.naturalHeight <= 0) return;
    const fitScale = Math.min(
      this.overlay.clientWidth / this.img.naturalWidth,
      this.overlay.clientHeight / this.img.naturalHeight
    );
    this.img.setCssStyles({
      width: `${this.img.naturalWidth * fitScale}px`,
      height: `${this.img.naturalHeight * fitScale}px`
    });
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    // All touch interaction is handled through pointer events. Cancel the
    // compatibility click so a zoom-reset tap cannot be retargeted to the
    // backdrop after the image shrinks and close the viewer in the same tap.
    if (e.pointerType === 'touch') e.preventDefault();
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
      const focalPoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.moved = true;
      this.setScale(this.pinchStartScale * (dist / this.pinchStartDist), focalPoint);
      return;
    }

    if (this.pointers.size === 1 && this.dragStart && this.scale > MIN_SCALE) {
      const p = [...this.pointers.values()][0];
      const dx = p.x - this.dragStart.x;
      const dy = p.y - this.dragStart.y;
      if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD) this.moved = true;
      this.tx = this.dragOriginTx + dx;
      this.ty = this.dragOriginTy + dy;
      this.clampPan();
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
      // A zoom-reset tap is a complete action. Do not combine it with the
      // following close tap and accidentally interpret the pair as a double-tap.
      this.lastTapTime = 0;
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
  private suppressOpenUntil = 0;

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
    if (
      this.activeViewer
      || Date.now() < this.suppressOpenUntil
      || document.querySelector('.fsi-overlay')
    ) return;

    const target = evt.target;
    if (!(target instanceof Element)) return;

    const img = target.closest('img');
    if (!(img instanceof HTMLImageElement)) return;
    if (!this.isNoteImage(img)) return;

    evt.preventDefault();
    this.activeViewer = new ImageViewer(img, this.settings.trueFullscreen, () => {
      this.activeViewer = null;
      this.suppressOpenUntil = Date.now() + REOPEN_SUPPRESSION_MS;
    });
  }

  /** Excludes icons, settings artwork, and images from non-note workspace panes. */
  private isNoteImage(img: HTMLImageElement): boolean {
    if (!img.closest('.workspace-leaf-content')) return false;
    return Boolean(img.closest('.markdown-reading-view, .markdown-preview-view, .markdown-source-view'));
  }
}

class FullscreenImageSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: FullscreenImagePlugin) {
    super(app, plugin);
  }

  getSettingDefinitions() {
    return [
      {
        name: 'True fullscreen',
        desc: 'Expand images to cover the entire window. Turn off to keep the expanded view in the note area, leaving sidebars visible.',
        aliases: ['full screen', 'lightbox', 'bounded viewport'],
        control: {
          type: 'toggle' as const,
          key: 'trueFullscreen',
          defaultValue: DEFAULT_SETTINGS.trueFullscreen
        }
      }
    ];
  }

  getControlValue(key: string): unknown {
    return key === 'trueFullscreen' ? this.plugin.settings.trueFullscreen : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key !== 'trueFullscreen' || typeof value !== 'boolean') return;
    this.plugin.settings.trueFullscreen = value;
    await this.plugin.saveSettings();
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
