import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';

import { build } from '../build.mjs';
import { SECTIONS } from '../src/docs.mjs';

const DOCS_ROOT =
  process.env.STARFORGE_DOCS ??
  (await exists(join(import.meta.dirname, '..', 'docs'))
    ? join(import.meta.dirname, '..', 'docs')
    : join(import.meta.dirname, '..', '..', 'starforge', 'docs'));
const BASE = '/';

let outDir;
let report;
let docsAvailable = false;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  docsAvailable = await exists(DOCS_ROOT);
  if (!docsAvailable) return;
  outDir = await mkdtemp(join(tmpdir(), 'starforge-web-'));
  report = await build({
    docsRoot: DOCS_ROOT,
    outDir,
    base: BASE,
    diagrams: process.env.STARFORGE_DIAGRAMS === '1',
    verbose: false,
  });
});

after(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

function gated(name, fn) {
  it(name, async (t) => {
    if (!docsAvailable) {
      t.skip(`no starforge checkout at ${DOCS_ROOT}`);
      return;
    }
    await fn(t);
  });
}

async function readPage(url) {
  const rel = url.replace(BASE, '').replace(/\.html$/, '.html');
  return readFile(join(outDir, rel), 'utf8');
}

describe('site build', () => {
  gated('writes one page per published markdown file', async () => {
    const expected = report.pages.length;
    assert.ok(expected > 40, `expected the full documentation set, got ${expected} pages`);
    for (const page of report.pages) {
      const info = await stat(join(outDir, `${posix.dirname(page.url.replace(BASE, ''))}/${posix.basename(page.url)}`));
      assert.equal(info.isFile(), true, page.url);
    }
    assert.equal(await exists(join(outDir, 'index.html')), true);
    assert.equal(await exists(join(outDir, '404.html')), true);
    assert.equal(await exists(join(outDir, 'style.css')), true);
  });

  gated('publishes exactly the four documented sections', async () => {
    const keys = new Set(report.pages.map((page) => page.url.replace(BASE, '').split('/')[0]));
    assert.deepEqual([...keys].sort(), SECTIONS.map((section) => section.key).sort());
    assert.equal(
      report.pages.some((page) => page.url.includes('superpowers')),
      false,
      'docs/superpowers must stay unpublished',
    );
  });

  gated('resolves every internal link', async () => {
    assert.deepEqual(report.unresolved, [], JSON.stringify(report.unresolved.slice(0, 5)));
    assert.deepEqual(report.dropped, []);
  });

  gated('emits no raw markdown hrefs', async () => {
    for (const page of report.pages) {
      const html = await readPage(page.url);
      assert.doesNotMatch(html, /href="[^"]*\.md(?:[#"]|$)/, page.url);
    }
  });

  gated('links only to pages that exist', async () => {
    for (const page of report.pages) {
      const html = await readPage(page.url);
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        const href = match[1];
        if (/^(?:https?:|mailto:|#|javascript:)/.test(href)) continue;
        if (!href.startsWith(BASE)) continue;
        const target = href.slice(BASE.length).split('#')[0];
        if (!target) continue;
        assert.equal(await exists(join(outDir, target)), true, `${page.url} -> ${href}`);
      }
    }
  });

  gated('keeps anchor links working inside a page', async () => {
    const html = await readPage(`${BASE}user/ci.html`);
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    assert.ok(anchors.length >= 2, `expected anchors in the CI page, got ${anchors.length}`);
    for (const anchor of anchors) {
      assert.match(html, new RegExp(`id="${anchor}"`), `missing heading id for #${anchor}`);
    }
  });

  gated('escapes placeholder angle brackets instead of making tags', async () => {
    for (const page of report.pages) {
      const html = await readPage(page.url);
      const body = html.replace(/<pre[\s\S]*?<\/pre>/g, '');
      assert.doesNotMatch(body, /<ulid>/i, `${page.url} rendered a bare <ulid> tag`);
      assert.doesNotMatch(body, /<handle>/i, `${page.url} rendered a bare <handle> tag`);
    }
    const trails = await readPage(`${BASE}user/trails.html`);
    assert.match(trails, /&lt;ulid&gt;/);
  });

  gated('renders highlighted code blocks', async () => {
    const html = await readPage(`${BASE}technical/crates.html`);
    assert.match(html, /class="shiki/);
    assert.match(html, /<table>/);
  });

  gated('prints one navigation entry per published page', async () => {
    const html = await readPage(`${BASE}user/trails.html`);
    for (const section of SECTIONS) {
      assert.match(html, new RegExp(`<h2>${section.title}</h2>`));
    }
    for (const page of report.pages) {
      assert.match(html, new RegExp(`href="${page.url}"`), `navigation misses ${page.url}`);
    }
  });

  gated('links the previous and next page in reading order', async () => {
    const html = await readPage(`${BASE}user/sessions.html`);
    assert.match(html, /class="pager"/);
    assert.match(html, /Next/);
  });

  gated('lists every page on the landing page', async () => {
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    for (const page of report.pages) {
      assert.match(html, new RegExp(`href="${page.url}"`), `landing page misses ${page.url}`);
    }
    assert.match(html, /Install Starforge/);
  });

  gated('renders every mermaid fence as an image when diagrams are enabled', async () => {
    if (process.env.STARFORGE_DIAGRAMS !== '1') {
      const html = await readPage(`${BASE}technical/architecture.html`);
      assert.match(html, /mermaid-source/, 'fallback source should be shown when diagram rendering is off');
      return;
    }
    assert.ok(report.diagrams >= 12, `expected rendered diagrams, got ${report.diagrams}`);
    assert.equal(report.diagramFallbacks, 0);
    const html = await readPage(`${BASE}technical/architecture.html`);
    assert.match(html, /<picture>/);
    assert.match(html, /prefers-color-scheme: dark/);
    for (const match of html.matchAll(/src="([^"]+\.svg)"/g)) {
      assert.equal(await exists(join(outDir, match[1].replace(BASE, '')), true), true, match[1]);
    }
  });

  gated('ships the assets the pages cite', async () => {
    for (const asset of ['format/schema/session-v1.json', 'format/schema/events-v1.json']) {
      assert.equal(await exists(join(outDir, asset)), true, asset);
    }
    const schema = JSON.parse(await readFile(join(outDir, 'format/schema/session-v1.json'), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(await exists(join(outDir, 'LICENSE-AGPL-3.0.txt')), true);
  });

  gated('keeps the ste-sources bookkeeping comment out of the output', async () => {
    const html = await readPage(`${BASE}technical/crates.html`);
    assert.doesNotMatch(html, /ste-sources/);
  });
});

describe('site build under a subdirectory', () => {
  const PREFIX = '/starforge-web/';
  let subDir;

  before(async () => {
    if (!docsAvailable) return;
    subDir = await mkdtemp(join(tmpdir(), 'starforge-web-sub-'));
    await build({
      docsRoot: DOCS_ROOT,
      outDir: subDir,
      base: PREFIX,
      diagrams: false,
      verbose: false,
    });
  });

  after(async () => {
    if (subDir) await rm(subDir, { recursive: true, force: true });
  });

  gated('prefixes every root-absolute link and image source', async () => {
    const files = await readdir(subDir, { recursive: true });
    for (const file of files.filter((name) => name.endsWith('.html'))) {
      const html = await readFile(join(subDir, file), 'utf8');
      for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:|#|data:)/.test(target)) continue;
        assert.ok(target.startsWith(PREFIX), `${file} -> ${target} misses ${PREFIX}`);
        const path = target.slice(PREFIX.length).split('#')[0];
        if (path) assert.ok(files.includes(path), `${file} -> ${target} does not exist`);
      }
    }
  });
});
