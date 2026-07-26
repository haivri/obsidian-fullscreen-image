# Fullscreen Image development

- This directory is the authoritative source repository. Do not develop from the installed copy in an Obsidian vault.
- `origin` is the private Forgejo repository; `github` is the public GitHub repository.
- Keep `main` clean and release the exact same commit to both remotes.
- Run lint and the production build before publishing.
- Publish through `/Users/robertfleming/vaults/obsidian-vault/_obsidian-os/scripts/release-obsidian-plugin fullscreen-image`.
- The publisher installs only runtime artifacts into the primary vault and preserves its existing `data.json` settings.
- Never add a vault's `data.json` or other user-specific settings to this source repository.
