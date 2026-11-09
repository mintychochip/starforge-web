# starforge-web

The public site for Starforge: landing page, user guide, administration
guide, technical reference, and the Trace Format v1 specification.

The application UI (`crates/starforged-web`, the server-rendered HTML pages
and git smart HTTP) stays in the Starforge repository. This repository holds
only the published documentation site, so it has no Rust, no askama, and no
dependency on any Starforge crate.

## Requirements

- Node 22 or newer
- A Starforge checkout, only when you refresh the documentation
- Chromium or Chrome, only for diagram rendering (`mermaid-cli` downloads one
  on first use)

## Layout

```text
build.mjs            generator: docs/ + src/ -> dist/
src/docs.mjs         section list, slugs, link resolution
src/render.mjs       markdown pipeline (marked, shiki, mermaid hooks)
src/theme.mjs        page chrome: top bar, sidebar, pager, landing page
src/styles.css       stylesheet, light and dark
docs/                a copy of the published docs from the Starforge repo
scripts/sync-docs.mjs  copy user/ admin/ technical/ format/ from a checkout
scripts/serve.mjs      preview dist/ over HTTP
test/                node:test suites for the pipeline and the built site
```

## Build

```bash
npm ci
npm run build            # -> dist/ (55 pages, 12 diagrams)
npm run build:offline    # diagrams render as their mermaid source
npm run serve            # http://127.0.0.1:8080/
npm test
```

Options: `--docs=<path>` (default `docs/`, then `../starforge/docs`),
`--out=<path>` (default `dist/`), `--base=/prefix/` for a site served from a
subdirectory, `--diagrams=off|strict`, `--repo-url=<url>` for a "Source"
link, `--version=<x.y.z>`.

An internal link that resolves to no page is reported as a warning and loses
its anchor: the link text stays, the `href` goes. `--diagrams=strict` turns a
failed diagram render into a build error instead of a source-text fallback.

## Documentation input

`docs/` is a copy, not a source of truth. Refresh it from the Starforge
checkout whenever the documents change:

```bash
npm run sync-docs -- --docs=/path/to/starforge/docs
```

Only `user/`, `admin/`, `technical/`, and `format/` are copied. Plans and
specs under `docs/superpowers/` are not published.

## How the pages are produced

- The slug comes from the docs-relative path: `user/trails.md` ->
  `/user/trails.html`; `technical/README.md` -> `/technical/index.html`.
- The title is the first `# ` heading; the page body drops that heading and
  the layout prints it.
- Relative links are rewritten to site URLs, and `#fragment` anchors are kept.
  Heading ids come from `marked-gfm-heading-id`, so the two in-page links in
  `user/ci.md` (`#secrets`, `#matrix`) resolve.
- Bare `<placeholder>` spellings outside backticks (`<ulid>`, `<handle>`, and
  about 90 others) are escaped so markdown cannot read them as HTML tags.
- Every `<!-- ste-sources ... -->` comment is dropped from the output; it is
  a checker annotation, not documentation.
- Code fences are highlighted at build time with shiki, in both themes; the
  page picks colours with `prefers-color-scheme`.
- A `mermaid` fence is rendered to `<page>-<n>-light.svg` and
  `-dark.svg` by `mermaid-cli` and embedded in a `<picture>`. With
  `--diagrams=off`, or when rendering fails, the fence renders as its source
  text.

Besides the pages, the build copies:

- `format/schema/*.json`, the JSON Schemas the format pages cite;
- `LICENSE-AGPL-3.0.txt`, `LICENSE-MIT.txt`, and `LICENSE-APACHE-2.0.txt`,
  renamed to `.txt` so a static host serves them as text;
- `style.css`, `robots.txt`, and `.nojekyll`.

The footer links the AGPL text, because the documentation derives from the
AGPL-licensed server. See `LICENSE.md` for the split.

The site ships no JavaScript. Every page is a document that works with
scripts disabled, and the CSS carries the only interactivity (navigation
and colour scheme).

## Tests

`npm test` runs two suites:

- `test/render.test.mjs`: slugs, link resolution, angle-bracket escaping,
  the `ste-sources` strip, mermaid extraction, and each renderer hook.
- `test/build.test.mjs`: builds the site and asserts one output page per
  input document, four published sections only, zero unresolved links, no
  `.md` hrefs, only existing link targets, working in-page anchors, no
  rendered placeholder tags, highlighted code, a complete sidebar, pager
  links, a complete landing index, and diagram output when
  `STARFORGE_DIAGRAMS=1`.

The build suite skips itself when no documentation is available, so the
pipeline tests still run in a bare clone.

## License

The Starforge server is AGPL-3.0-or-later; the CLI and trace format are
MIT OR Apache-2.0. The generator in this repository is MIT OR Apache-2.0
like the other `starforge-*` tooling.
