import { escapeHtml } from './render.mjs';

const MARK = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0.8 9.9 6.1 15.2 8 9.9 9.9 8 15.2 6.1 9.9 0.8 8 6.1 6.1z"/></svg>`;

const TOP_LINKS = [
  { key: 'user', label: 'User guide' },
  { key: 'admin', label: 'Administration' },
  { key: 'technical', label: 'Technical' },
  { key: 'format', label: 'Format' },
];

const SECTION_TITLES = {
  user: 'User guide',
  admin: 'Administration',
  technical: 'Technical reference',
  format: 'Trace format',
};

function topbar({ base, section, version, repoUrl }) {
  const links = TOP_LINKS.map((link) => {
    const href = sectionIndexHref(link.key, base);
    const current = section === link.key ? ' aria-current="true"' : '';
    return `<a href="${href}"${current}>${link.label}</a>`;
  }).join('');

  const repo = repoUrl ? `<a href="${escapeHtml(repoUrl)}" rel="noreferrer">Source</a>` : '';
  const tag = version ? `<span class="eyebrow" style="margin:0">${escapeHtml(version)}</span>` : '';

  return `<header class="topbar">
  <a class="brand" href="${base}index.html">${MARK}<span>Starforge</span></a>
  <nav class="topnav" aria-label="Sections">${links}${repo}</nav>
  <div style="margin-left:auto">${tag}</div>
</header>`;
}

function sectionIndexHref(key, base) {
  return `${base}index.html#${key}`;
}

function sidebar({ sections, base, current, activeSection }) {
  const groups = sections
    .map((section) => {
      const items = section.pages
        .map((page) => {
          const isCurrent = page.rel === current ? ' aria-current="page"' : '';
          return `<li><a href="${page.url}"${isCurrent}>${escapeHtml(page.title)}</a></li>`;
        })
        .join('\n');
      return `<h2>${escapeHtml(section.title)}</h2>\n<ul>\n${items}\n</ul>`;
    })
    .join('\n');
  return `<nav class="sidebar" aria-label="Documentation">${groups}</nav>`;
}

function pager({ prev, next }) {
  const parts = [];
  if (prev) {
    parts.push(
      `<a class="prev" href="${prev.url}"><span class="label">Previous</span>${escapeHtml(prev.title)}</a>`,
    );
  }
  if (next) {
    parts.push(
      `<a class="next" href="${next.url}"><span class="label">Next</span>${escapeHtml(next.title)}</a>`,
    );
  }
  if (!parts.length) return '';
  return `<nav class="pager" aria-label="Page navigation">${parts.join('')}</nav>`;
}

function footer({ base, version, repoUrl }) {
  const repo = repoUrl ? `<a href="${escapeHtml(repoUrl)}" rel="noreferrer">Starforge repository</a>` : '';
  const versionTag = version ? `<span>Version ${escapeHtml(version)}</span>` : '';
  return `<footer><div class="inner">
  <div>${repo}${repo ? ' · ' : ''}<a href="${base}index.html">Documentation index</a> · <a href="${base}index.html#format">Trace Format v1</a></div>
  <div>${versionTag}${versionTag ? ' · ' : ''}Documentation from the Starforge server, <a href="${base}LICENSE-AGPL-3.0.txt">AGPL-3.0-or-later</a></div>
</div></footer>`;
}

function document({ title, description, base, body, version, repoUrl, bodyClass }) {
  const desc = description ? `<meta name="description" content="${escapeHtml(description)}">` : '';
  const descLine = desc ? `${desc}\n` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Starforge</title>
${descLine}<link rel="stylesheet" href="${base}style.css">
</head>
<body class="${bodyClass}">
${body}
</body>
</html>
`;
}

export function layout({
  title,
  description,
  section,
  sections,
  base,
  version,
  repoUrl,
  body,
  prev,
  next,
  current,
}) {
  const crumbs = `<p class="eyebrow">${escapeHtml(SECTION_TITLES[section] ?? section)}</p>`;
  return document({
    title,
    description,
    base,
    version,
    repoUrl,
    bodyClass: 'docs',
    body: `<a class="skip" href="#content">Skip to content</a>
${topbar({ base, section, version, repoUrl })}
<div class="shell">
${sidebar({ sections, base, current, activeSection: section })}
<main id="content">
<h1 class="page-title">${escapeHtml(title)}</h1>
${crumbs}
${body}
${pager({ prev, next })}
</main>
</div>
${footer({ base, version, repoUrl })}`,
  });
}

function sectionCard(section, lead, base) {
  const items = section.pages
    .map((page) => {
      const slug = page.rel.replace(/\.md$/, '');
      return `<a href="${page.url}"><span>${escapeHtml(page.title)}</span><span class="meta">${escapeHtml(slug)}</span></a>`;
    })
    .join('\n');
  return `<section class="section" id="${section.key}">
  <h2>${escapeHtml(section.title)}</h2>
  <p>${escapeHtml(lead ?? '')}</p>
  <div class="grid">
${items}
  </div>
</section>`;
}

export function landingPage({ sections, leads, base, version, repoUrl, title, tagline }) {
  const repo = repoUrl ? `<a class="button" href="${escapeHtml(repoUrl)}" rel="noreferrer">Browse the source</a>` : '';
  return document({
    title: 'Documentation',
    description: tagline,
    base,
    version,
    repoUrl,
    bodyClass: 'home',
    body: `<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
  <a class="brand" href="${base}index.html">${MARK}<span>${escapeHtml(title)}</span></a>
  <nav class="topnav" aria-label="Sections">${TOP_LINKS.map((link) => `<a href="#${link.key}">${link.label}</a>`).join('')}${repoUrl ? `<a href="${escapeHtml(repoUrl)}" rel="noreferrer">Source</a>` : ''}</nav>
  <div style="margin-left:auto">${version ? `<span class="eyebrow" style="margin:0">${escapeHtml(version)}</span>` : ''}</div>
</header>
<div class="hero">
  <h1>${escapeHtml(tagline)}</h1>
  <p>Self-hosted git hosting, Trails, agent session traces, search, webhooks, mirrors, releases, and opt-in CI runners. The documentation is published here from the Starforge repository.</p>
  <div class="actions">
    <a class="button primary" href="${base}admin/install.html">Install Starforge</a>
    <a class="button" href="${base}user/getting-started.html">Getting started</a>
    <a class="button" href="${base}technical/http-api.html">HTTP API</a>
    ${repo}
  </div>
</div>
<div class="tiles">
  <div class="tile"><h3>Git hosting</h3><p>Smart HTTP and SSH, personal access tokens, collaborators, code and history browsing, and ref protection.</p></div>
  <div class="tile"><h3>Trails</h3><p>Issue-like objects with changes, revisions, reviews, and gates that keep agent work reviewable.</p></div>
  <div class="tile"><h3>Sessions</h3><p>Agent session traces captured, redacted on the client, and rendered with commit links.</p></div>
  <div class="tile"><h3>CI runners</h3><p>Opt-in sandboxed jobs declared in <code>.starforge/ci.toml</code>, with checks that gates can require.</p></div>
</div>
<main id="content">
${sections.map((section) => sectionCard(section, leads[section.key], base)).join('\n')}
</main>
${footer({ base, version, repoUrl })}`,
  });
}

export function notFoundPage({ base, version, repoUrl }) {
  return document({
    title: 'Page not found',
    description: 'This page is not part of the Starforge documentation.',
    base,
    version,
    repoUrl,
    bodyClass: 'docs',
    body: `${topbar({ base, version, repoUrl })}
<div class="shell">
<main id="content">
<h1 class="page-title">Page not found</h1>
<p>The page you asked for is not part of this site. Start from the
<a href="${base}index.html">documentation index</a>.</p>
</main>
</div>
${footer({ base, version, repoUrl })}`,
  });
}
