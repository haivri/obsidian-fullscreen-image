# Changelog

All notable changes to Fullscreen Image will be documented here.

## 1.0.1 - 2026-07-21

- Stabilized touch pinch-to-zoom by keeping the image position beneath the gesture.
- Calculated pan bounds from the fitted image rather than the full viewport, preventing low-zoom drift.

## 1.0.0 - 2026-07-21

- First public release.
- Opens note images in a fullscreen or pane-bounded lightbox.
- Mouse-wheel, button, double-click, pinch, and drag controls for zooming and panning.
- Keyboard-safe close behavior, focus restoration, and bounded panning.
- Local-first operation with no telemetry or network requests.
