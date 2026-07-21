# Fullscreen Image

Click any image in a note to expand it fullscreen. Zoom with the on-screen buttons, mouse wheel,
or pinch; drag to pan once zoomed in. Close with the X button, Escape, double-tap/click to close,
or by clicking outside the image.

## Usage

- **Click/tap an image** — opens it fullscreen, filling the screen regardless of the size it's
  displayed at in the note.
- **Zoom** — `+`/`−` buttons, mouse wheel, pinch (touch), or double-click/double-tap to toggle
  between fit and 2x zoom.
- **Pan** — drag once zoomed in.
- **Close** — X button, Escape key, click/tap the background, or a single click/tap on the image
  while it's at its default (non-zoomed) size.

## Scope

Works for images rendered in Reading view and Live Preview, including embedded/transcluded images.
Not currently supported: images inside iframes, and images inside Canvas file nodes.

## Development

```bash
npm install
npm run dev     # esbuild watch mode
npm run build    # type-check + production build
npm run lint
```

## License

MIT
