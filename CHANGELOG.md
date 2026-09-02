# Changelog

All notable changes to Fullscreen Image will be documented here.

## 1.3.0 - 2026-09-02

- New **Caption length** setting for the viewer's caption bar: **Full** (default) shows the whole caption, wrapping as needed — even when the gallery truncates its captions to a single line — while **Single line** truncates with an ellipsis here too.

## 1.2.0 - 2026-09-02

- The caption bar honors a gallery's `data-fullscreen-caption` stamp, enabling Simple Gallery's four-way caption visibility: "Fullscreen only" captions appear in the viewer even though they're hidden in the note, and "Gallery only" captions stay out of it. Without a stamp, visibility still decides.
- The caption bar keeps the typography its gallery gave the caption (e.g. the typewriter/monospace caption font), instead of restyling it.

## 1.1.1 - 2026-09-02

- The caption bar now follows the note's caption visibility: a figcaption hidden in the note (a gallery's captions turned off globally, per gallery, or per photo) no longer appears in the fullscreen viewer. Visible in the note = visible fullscreen.

## 1.1.0 - 2026-09-02

- The viewer now shows the image's caption in a translucent bar beneath the photo — read from the note's real `<figcaption>` (how Simple Gallery renders captions), never from alt text, so filenames are never mistaken for captions. It updates as you arrow through a gallery and can be turned off with the new **Show caption** setting.

## 1.0.9 - 2026-09-02

- Closing the viewer no longer scrolls the note back to the source image's position (most visible closing over a tall gallery): keyboard focus is still restored, but without scrolling the restored element into view.

## 1.0.8 - 2026-09-02

- Fixed the viewer buttons staying dark after a tap on touch devices: hover styling is now applied only on devices that hover, with a distinct momentary pressed state.

## 1.0.7 - 2026-09-02

- Gallery navigation: an image opened from a Simple Gallery block now knows its neighbors. Prev/next arrow buttons appear in the viewer alongside a position counter, the left/right arrow keys step through the gallery (wrapping at either end), and the adjacent images preload. Coupling is DOM-only, so neither plugin requires the other.

## 1.0.6 - 2026-08-05

- Prevented Obsidian's built-in image viewer from opening underneath Fullscreen Image.

## 1.0.5 - 2026-07-24

- Made every dismissal close and dispose all Fullscreen Image viewer layers together.
- Cleaned up stale overlays left by an older hot-reloaded mobile build.

## 1.0.4 - 2026-07-23

- Prevented a touch zoom-reset from also closing the viewer through a retargeted compatibility click.
- Removed the visible zoomed-to-fitted flash during mobile dismissal.

## 1.0.3 - 2026-07-23

- Prevented duplicate fullscreen overlays from opening for the same image tap.
- Prevented mobile compatibility clicks from reopening a viewer immediately after dismissal.
- Moved touch backdrop and close-button dismissal to the cancelable pointer-down event.

## 1.0.2 - 2026-07-23

- Fixed mobile backdrop and close-button taps so one tap dismisses the viewer.
- Limited the image hit area to its visible fitted bounds, making letterboxed space a true backdrop.
- Kept tap-to-reset for zoomed images without misreading the following close tap as a double-tap.

## 1.0.1 - 2026-07-21

- Stabilized touch pinch-to-zoom by keeping the image position beneath the gesture.
- Calculated pan bounds from the fitted image rather than the full viewport, preventing low-zoom drift.

## 1.0.0 - 2026-07-21

- First public release.
- Opens note images in a fullscreen or pane-bounded lightbox.
- Mouse-wheel, button, double-click, pinch, and drag controls for zooming and panning.
- Keyboard-safe close behavior, focus restoration, and bounded panning.
- Local-first operation with no telemetry or network requests.
