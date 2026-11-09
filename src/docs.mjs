import { readFile, readdir } from 'node:fs/promises';
import { join, posix, relative, resolve, dirname } from 'node:path';

/**
 * The published sections of the Starforge repository, in navigation order.
 * `root` is the directory under the repository's docs/ tree.
 */
export const SECTIONS = [
  {
    key: 'user',
    title: 'User guide',
    lead: 'Day-to-day work on a Starforge instance: accounts, repositories, Trails, sessions, search, releases, and CI.',
    order: [
      'getting-started',
      'repositories-and-ssh-keys',
      'trails',
      'sessions',
      'search',
      'orgs-and-teams',
      'notifications',
      'releases',
      'sandbox',
      'ci',
      'api-and-webhooks',
    ],
  },
  {
    key: 'admin',
    title: 'Administration',
    lead: 'Install, configure, and operate a Starforge server: database, reverse proxy, SSH, SSO, backups, and abuse controls.',
    order: [
      'install',
      'configuration',
      'database',
      'reverse-proxy',
      'ssh',
      'sso-and-2fa',
      'mirrors-and-import',
      'backup-and-restore',
      'upgrades-and-migrations',
      'doctor',
      'monitoring',
      'abuse-controls',
      'ci',
      'site-administration',
    ],
  },
  {
    key: 'technical',
    title: 'Technical reference',
    lead: 'How the code works and why. Written in ASD-STE100 Simplified Technical English.',
    order: [
      'README',
      'architecture',
      'crates',
      'configuration',
      'storage-and-database',
      'accounts-and-permissions',
      'repositories',
      'git-hosting',
      'trails',
      'notifications',
      'releases',
      'web-and-auth',
      'http-api',
      'sessions',
      'ci-and-sandboxes',
      'trace-and-redaction',
      'search',
      'webhooks',
      'import-and-mirrors',
      'cli',
      'operations',
      'security',
      'testing',
      'glossary',
      'maintenance',
      'ste100',
    ],
  },
  {
    key: 'format',
    title: 'Trace format',
    lead: 'The normative session trace format, its event stream, and the CI job spec, with JSON Schema files.',
    order: ['README', 'session-v1', 'events-v1', 'ci-v1'],
  },
];

export function slugFor(relPath) {
  const withoutExt = relPath.replace(/\.md$/, '');
  if (withoutExt === 'README' || withoutExt.endsWith('/README')) {
    const dir = withoutExt.slice(0, -'README'.length);
    return `${dir}index`;
  }
  return withoutExt;
}

export function urlFor(relPath, base = '/') {
  return `${base}${slugFor(relPath)}.html`;
}

export function titleOf(source) {
  const match = source.match(/^#\s+(\S.*)$/m);
  return match ? match[1].trim() : null;
}

async function listMarkdownFiles(dir, order = []) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return found;
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
  const rank = new Map(order.map((stem, index) => [stem, index]));
  names.sort((a, b) => {
    const aStem = a.replace(/\.md$/, '');
    const bStem = b.replace(/\.md$/, '');
    const aRank = rank.has(aStem) ? rank.get(aStem) : order.length;
    const bRank = rank.has(bStem) ? rank.get(bStem) : order.length;
    return aRank - bRank || aStem.localeCompare(bStem);
  });
  for (const name of names) found.push(join(dir, name));
  return found;
}

/**
 * Non-markdown files under a docs section, relative to that section's
 * directory. The format pages cite `schema/*.json`; those files ship with the
 * site so the citation resolves.
 */
export async function listAssets(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.md'))
    .map((entry) => relative(dir, join(entry.parentPath ?? entry.path, entry.name)).split('\\').join('/'));
}

/**
 * Read every published page. Returns:
 *   sections: [{key, title, lead, pages: [{rel, slug, url, title, source}]}]
 *   pages:    flat list in navigation order
 *   byRel:    Map of docs-relative path -> page
 */
export async function loadDocs(docsRoot, base = '/') {
  const sections = [];
  const pages = [];
  const byRel = new Map();

  for (const section of SECTIONS) {
    const files = await listMarkdownFiles(join(docsRoot, section.key), section.order);
    const sectionPages = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const rel = posix.join(section.key, posix.basename(file));
      const title = titleOf(source) ?? posix.basename(file, '.md');
      const page = {
        rel,
        section: section.key,
        slug: slugFor(rel),
        url: urlFor(rel, base),
        title,
        source,
      };
      sectionPages.push(page);
      pages.push(page);
      byRel.set(rel, page);
    }
    sections.push({ ...section, pages: sectionPages });
  }

  return { sections, pages, byRel };
}

/**
 * Normalize a link target against the docs tree: resolves relative paths
 * without requiring the target file to exist.
 */
export function resolveTarget(fromRel, href) {
  const withoutHash = href.split('#')[0];
  const hash = href.includes('#') ? `#${href.split('#').slice(1).join('#')}` : '';
  if (!withoutHash) return { path: '', hash };
  const fromDir = posix.dirname(posix.join('docs', fromRel));
  let path = posix.normalize(posix.join(fromDir, withoutHash));
  // resolveTarget works inside the synthetic docs/ root.
  if (path.startsWith('docs/')) path = path.slice('docs/'.length);
  else if (path === 'docs') path = '';
  return { path: path.replace(/\/$/, ''), hash };
}

export function isExternal(href) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
}

export { relative as relPath, resolve as resolvePath, dirname };
