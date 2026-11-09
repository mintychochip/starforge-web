# Licensing

This repository holds two different kinds of material, under two different
licences.

- **The published documentation** in `docs/` is copied from the Starforge
  server repository and derived from the server's source and behaviour. It is
  licensed under the GNU Affero General Public License, version 3 or (at your
  option) any later version. See `LICENSE-AGPL-3.0`. The rendered pages in
  `dist/` are the same material in another form and keep that licence.
- **The site generator** — `build.mjs`, `scripts/`, `src/`, and `test/` — is
  dual-licensed under the MIT license or the Apache License 2.0, at your
  option, matching the other `starforge-*` tools. See `LICENSE-MIT` and
  `LICENSE-APACHE-2.0`.

The documentation names the server `starforged` and every `crates/starforged*`
crate, so the serving side stays AGPL. The site adds no server code.
