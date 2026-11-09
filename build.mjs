#!/usr/bin/env node
import { access, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SECTIONS, isExternal, listAssets, loadDocs, resolveTarget, titleOf } from './src/docs.mjs';
import {
  createMarkedRenderer,
  escapeHtml,
  escapePseudoTags,
  extractMermaid,
  renderDocBody,
  stripSteComments,
} from './src/render.mjs';
import { layout, landingPage, notFoundPage } from './src/theme.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function parseArgs(argv = []) {
  const options = {
    docsRoot: null,
    outDir: join(HERE, 'dist'),
    base: '/',
    diagrams: true,
    repoUrl: null,
    version: null,
    verbose: false,
  };
  for (const arg of argv) {
    if (arg === '--diagrams=off' || arg === '--no-diagrams') {
      options.diagrams = false;
    } else if (arg === '--diagrams=strict') {
      options.diagrams = 'strict';
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg.startsWith('--docs=')) {
      options.docsRoot = arg.slice('--docs='.length);
    } else if (arg.startsWith('--out=')) {
      options.outDir = arg.slice('--out='.length);
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
    } else if (arg.startsWith('--repo-url=')) {
      options.repoUrl = arg.slice('--repo-url='.length);
    } else if (arg.startsWith('--version=')) {
      options.version = arg.slice('--version='.length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.docsRoot === null) {
    const vendored = join(HERE, 'docs');
    const checkout = join(HERE, '..', 'starforge', 'docs');
    options.docsRoot = process.env.STARFORGE_DOCS
      ?? ((await exists(vendored)) ? vendored : checkout);
  }
  options.docsRoot = resolve(options.docsRoot);
  options.outDir = resolve(options.outDir);
  if (!options.base.endsWith('/')) options.base += '/';
  if (!options.base.startsWith('/')) options.base = `/${options.base}`;
  return options;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, { cwd } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolvePromise({ code: -1, stdout, stderr: error.message }));
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/** Read the workspace version out of the starforge checkout, when present. */
export async function detectVersion(docsRoot) {
  try {
    const manifest = await readFile(join(docsRoot, '..', 'Cargo.toml'), 'utf8');
    const match = manifest.match(/^version\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch {
    // No checkout next to the docs; fall through to the package version.
  }
  try {
    const pkg = JSON.parse(await readFile(join(HERE, 'package.json'), 'utf8'));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

async function createHighlighter() {
  const { createHighlighter: create } = await import('shiki');
  return create({
    themes: ['github-light', 'github-dark'],
    langs: ['rust', 'bash', 'shellscript', 'toml', 'sql', 'json', 'html', 'css', 'markdown', 'text'],
  });
}

const LANG_ALIASES = {
  sh: 'shellscript',
  shell: 'shellscript',
  bash: 'shellscript',
  rs: 'rust',
  md: 'markdown',
  txt: 'text',
  plaintext: 'text',
};

function makeHighlight(highlighter, { base, verbose }) {
  const cache = new Map();
  return (lang, text) => {
    if (!lang) return null;
    const resolved = LANG_ALIASES[lang] ?? lang;
    const loaded = highlighter.getLoadedLanguages();
    if (!loaded.includes(resolved)) return null;
    const key = `${resolved}\u0000${text}`;
    if (cache.has(key)) return cache.get(key);
    let html;
    try {
      html = highlighter.codeToHtml(text, {
        lang: resolved,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
      });
    } catch (error) {
      if (verbose) console.warn(`highlight failed for ${resolved}: ${error.message}`);
      return null;
    }
    cache.set(key, html);
    return html;
  };
}

const MMDC = join(HERE, 'node_modules', '.bin', 'mmdc');
const LICENSE_FILES = ['LICENSE-AGPL-3.0', 'LICENSE-MIT', 'LICENSE-APACHE-2.0'];
const PUPPETEER_CONFIG = join(HERE, 'puppeteer.json');

async function renderDiagram(source, outFile, theme) {
  await mkdir(dirname(outFile), { recursive: true });
  // Per-output input name: two builds writing the same diagrams directory
  // must not share a scratch file.
  const tmpInput = `${outFile}.mmd`;
  await writeFile(tmpInput, `${source}\n`, 'utf8');
  const result = await run(
    MMDC,
    [
      '-i', tmpInput,
      '-o', outFile,
      '--theme', theme,
      '--backgroundColor', 'transparent',
      '--puppeteerConfigFile', PUPPETEER_CONFIG,
      '--quiet',
    ],
    { cwd: HERE },
  );
  await rm(tmpInput, { force: true });
  if (result.code !== 0) {
    throw new Error(`mmdc failed for ${outFile}: ${(result.stderr || result.stdout).trim().slice(-400)}`);
  }
}

/** Pull width/height out of a rendered SVG so the page reserves layout space. */
async function svgSize(svgFile) {
  const svg = await readFile(svgFile, 'utf8');
  const viewBox = svg.match(/viewBox="([^"]+)"/);
  if (viewBox) {
    const parts = viewBox[1].split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  }
  const width = svg.match(/\swidth="(\d+(?:\.\d+)?)"/);
  const height = svg.match(/\sheight="(\d+(?:\.\d+)?)"/);
  if (width && height) return { width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
  return null;
}

async function diagramMarkup({ diagrams, pageSlug, outDir, base, mode, verbose }) {
  const markup = [];
  for (const [index, source] of diagrams.entries()) {
    const name = `${pageSlug.replace(/\//g, '-')}-${index + 1}`;
    const light = join(outDir, 'diagrams', `${name}-light.svg`);
    const dark = join(outDir, 'diagrams', `${name}-dark.svg`);
    let ok = true;
    try {
      await renderDiagram(source, light, 'neutral');
      await renderDiagram(source, dark, 'dark');
    } catch (error) {
      if (mode === 'strict') throw error;
      if (verbose) console.warn(`diagram ${name} not rendered: ${error.message}`);
      ok = false;
    }
    if (!ok) {
      markup.push(
        `<div class="diagram"><pre class="mermaid-source"><code class="language-mermaid">${escapeHtml(source)}</code></pre></div>`,
      );
      continue;
    }
    const size = await svgSize(light);
    const sizeAttr = size ? ` width="${size.width}" height="${size.height}"` : '';
    markup.push(
      `<div class="diagram"><picture>` +
        `<source srcset="${base}diagrams/${name}-dark.svg" media="(prefers-color-scheme: dark)">` +
        `<img src="${base}diagrams/${name}-light.svg" alt="Diagram ${index + 1} of the ${pageSlug} page"${sizeAttr} loading="lazy" decoding="async">` +
        `</picture></div>`,
    );
  }
  return markup;
}

function makeRewriter(page, ctx) {
  return (href) => {
    if (!href) return null;
    if (href.startsWith('#')) return href;
    if (isExternal(href)) return href;
    const { path, hash } = resolveTarget(page.rel, href);
    const target = ctx.byRel.get(path);
    if (target) return `${target.url}${hash}`;
    // A directory link lands on the section index or on the landing page.
    const section = SECTIONS.find((candidate) => candidate.key === path);
    if (section) {
      const index = ctx.sections.find((candidate) => candidate.key === section.key);
      const first = index?.pages.find((candidate) => candidate.slug.endsWith('index'));
      if (first) return `${first.url}${hash}`;
      return `${ctx.base}index.html#${section.key}${hash}`;
    }
    ctx.unresolved.push({ page: page.rel, href });
    return null;
  };
}

function stripLeadingTitle(source) {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.startsWith('# '));
  if (index === -1) return source;
  lines.splice(index, 1);
  return lines.join('\n');
}

/** Build the whole site. Returns a report about what was produced. */
export async function build(options) {
  const { docsRoot, outDir, base, diagrams: diagramMode, verbose } = options;
  if (!(await exists(docsRoot))) {
    throw new Error(
      `docs directory not found: ${docsRoot}\n` +
        'Pass --docs=/path/to/starforge/docs or set STARFORGE_DOCS.',
    );
  }

  const started = Date.now();
  const report = {
    docsRoot,
    outDir,
    base,
    pages: [],
    diagrams: 0,
    diagramFallbacks: 0,
    unresolved: [],
    dropped: [],
    warnings: [],
  };

  const { sections, pages, byRel } = await loadDocs(docsRoot, base);
  report.pages = pages.map((page) => ({ rel: page.rel, url: page.url, title: page.title }));

  const version = options.version ?? (await detectVersion(docsRoot));
  const metadata = {
    base,
    version,
    repoUrl: options.repoUrl,
    title: 'Starforge',
    tagline: 'A self-hostable git forge built around agent-assisted development.',
  };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, '.nojekyll'), '', 'utf8');

  const highlighter = await createHighlighter();
  const highlight = makeHighlight(highlighter, { base, verbose });
  const ctx = { byRel, sections, base, unresolved: report.unresolved };

  const mmdcAvailable = await exists(MMDC);
  if (diagramMode && !mmdcAvailable) {
    report.warnings.push('mermaid-cli is not installed; diagrams render as source text');
  }

  const sectionNav = sections.map((section) => ({
    key: section.key,
    title: section.title,
    pages: section.pages.map((page) => ({ title: page.title, url: page.url, rel: page.rel })),
  }));

  for (const page of pages) {
    const source = stripSteComments(page.source);
    const mermaidSources = extractMermaid(source);
    let diagramHtml = [];
    if (mermaidSources.length) {
      if (diagramMode && mmdcAvailable) {
        diagramHtml = await diagramMarkup({
          diagrams: mermaidSources,
          pageSlug: page.slug,
          outDir,
          base,
          mode: diagramMode,
          verbose,
        });
        report.diagrams += diagramHtml.filter((html) => html.includes('<picture>')).length;
        report.diagramFallbacks += diagramHtml.filter((html) => html.includes('mermaid-source')).length;
      } else {
        diagramHtml = mermaidSources.map(
          (text) =>
            `<div class="diagram"><pre class="mermaid-source"><code class="language-mermaid">${escapeHtml(text)}</code></pre></div>`,
        );
        report.diagramFallbacks += diagramHtml.length;
      }
    }

    const body = renderDocBody(
      { rel: page.rel, source: stripLeadingTitle(source) },
      {
        rewriteHref: makeRewriter(page, ctx),
        highlight,
        diagrams: diagramHtml,
        onDropped: (href) => report.dropped.push({ page: page.rel, href }),
      },
    );

    const position = pages.indexOf(page);
    const prev = position > 0 ? pages[position - 1] : null;
    const next = position >= 0 && position < pages.length - 1 ? pages[position + 1] : null;

    const description = firstParagraph(page.source);

    const html = layout({
      title: page.title,
      description,
      section: page.section,
      sections: sectionNav,
      base,
      version,
      repoUrl: options.repoUrl,
      body: `<article>\n${body}\n</article>`,
      prev,
      next,
      current: page.rel,
    });

    const outFile = join(outDir, `${page.slug}.html`);
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, html, 'utf8');
  }

  const landing = landingPage({
    sections: sectionNav,
    leads: Object.fromEntries(sections.map((section) => [section.key, section.lead])),
    base,
    version,
    repoUrl: options.repoUrl,
    title: metadata.title,
    tagline: metadata.tagline,
  });
  await writeFile(join(outDir, 'index.html'), landing, 'utf8');
  await writeFile(join(outDir, '404.html'), notFoundPage({ base, version, repoUrl: options.repoUrl }), 'utf8');
  await cp(join(HERE, 'src', 'styles.css'), join(outDir, 'style.css'));
  for (const name of LICENSE_FILES) {
    // `.txt` so every static host serves the text in the browser instead of
    // downloading an extensionless file.
    await cp(join(HERE, name), join(outDir, `${name}.txt`));
  }
  // Non-markdown assets under a published section (the JSON Schemas the
  // format pages cite) ship next to the pages that reference them.
  for (const section of SECTIONS) {
    const source = join(docsRoot, section.key);
    for (const rel of await listAssets(source)) {
      const target = join(outDir, section.key, rel);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(source, rel), target);
    }
  }
  await writeFile(join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');

  if (report.unresolved.length) {
    report.warnings.push(
      `${report.unresolved.length} internal link(s) did not resolve: ` +
        report.unresolved.map((entry) => `${entry.page} -> ${entry.href}`).join(', '),
    );
  }
  report.elapsedMs = Date.now() - started;
  report.title = metadata.title;
  report.version = version;
  return report;
}

function firstParagraph(source) {
  const text = stripSteComments(source)
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('```'));
  const block = text
    .slice(0, 4)
    .join(' ')
    .replace(/[`*_]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (block.length <= 160) return block;
  const cut = block.slice(0, 160);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 100 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

async function main() {
  let options;
  try {
    options = await parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  try {
    const report = await build(options);
    const summary = [
      `${report.pages.length} pages`,
      `${report.diagrams} diagrams`,
      report.diagramFallbacks ? `${report.diagramFallbacks} diagram fallbacks` : null,
      `${Math.round(report.elapsedMs / 100) / 10}s`,
    ]
      .filter(Boolean)
      .join(', ');
    console.log(`built ${report.outDir} (${summary})`);
    for (const warning of report.warnings) console.warn(`warning: ${warning}`);
    if (report.dropped.length) {
      console.warn(`dropped ${report.dropped.length} unresolvable link(s)`);
    }
  } catch (error) {
    console.error(`build failed: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
