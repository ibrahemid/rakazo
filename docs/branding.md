# Branding the web app

Set `RAKAZO_BRAND_DIR` when building `@rakazo/web` to replace the product name, icons, manifest, page title and description, and colour tokens. The path is resolved against the repository root (or used as-is when absolute). When the variable is unset or empty, the build is unchanged.

```sh
RAKAZO_BRAND_DIR=apps/web/brand/fixture pnpm --filter @rakazo/web build
```

The build fails if the brand directory is invalid or if the string `Rakazo` remains in any `.js`, `.css`, `.html`, `.webmanifest`, `.json`, `.svg` or `.txt` file under `dist`.

## Brand directory

[`apps/web/brand/fixture`](../apps/web/brand/fixture) is a complete example.

`brand.json` (required):

```json
{
  "name": "Acme Bots",
  "description": "Bots that work for your team.",
  "colors": {
    "dark": { "background": "#101418", "primary": "#4f8cff" },
    "light": { "background": "#f6f8fb", "primary": "#1f5fd1" }
  }
}
```

- `name` replaces the product name in the page title, the home screen title and the UI.
- `description` replaces the page description.
- `colors.dark` and `colors.light` are optional and override any `ColorTokens` key from `@rakazo/ui-tokens` with a hex colour (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`). Unknown keys fail the build. `background` also sets the browser theme colour.

`strings.json` overrides catalog messages by exact source msgid, per locale:

```json
{ "de": { "Sign in to Rakazo": "Bei Acme Bots anmelden" } }
```

Every message that would still contain `Rakazo` in any locale must be overridden. The build lists each missing locale and msgid, and rejects overrides for locales or msgids that are not in the catalogs.

`public/` must contain exactly these files, which replace the ones in `apps/web/public`:

| File | Format |
| --- | --- |
| `favicon.ico` | ICO |
| `favicon.png` | 128x128 PNG |
| `favicon-16x16.png` | 16x16 PNG |
| `favicon-32x32.png` | 32x32 PNG |
| `apple-touch-icon.png` | 180x180 PNG |
| `icon-192.png` | 192x192 PNG |
| `icon-512.png` | 512x512 PNG |
| `site.webmanifest` | JSON |

Other files fail the build; dotfiles are ignored.

## Docker

The app image build takes the brand directory from the build context. Copy it to `.brand/` at the repository root (ignored by git) and build with `RAKAZO_BRAND_DIR=.brand`, which the Compose files pass to the image build as a build argument.
