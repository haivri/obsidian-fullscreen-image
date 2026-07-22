# Contributing

Bug reports and pull requests are welcome.

Before submitting a change:

1. Run `npm ci`.
2. Run `npm run build`.
3. Run `npm run lint`.
4. Test Reading view and Live Preview in both light and dark themes.
5. Test mouse-wheel zoom, double-click, drag-to-pan, touch pinch, Escape, and the pane-bounded
   setting where available.

Keep the plugin simple and local-first. New functionality must not transmit vault content without
explicit user action and clear documentation. Do not include vault content or `data.json` in commits.
