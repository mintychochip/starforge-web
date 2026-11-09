#!/usr/bin/env node
/**
 * Copy the published documentation sections out of a Starforge checkout into
 * `docs/`, so the site builds without that checkout.
 *
 *   node scripts/sync-docs.mjs --docs=/path/to/starforge/docs
 *
 * Only `user/`, `admin/`, `technical/`, and `format/` are copied. Plans and
 * specs under `docs/superpowers/` stay out of the site.
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SECTIONS = ['user', 'admin', 'technical', 'format'];

function parseArgs(argv) {
  let source = process.env.STARFORGE_DOCS ?? join(REPO, '..', 'starforge', 'docs');
  for (const arg of argv) {
    if (arg.startsWith('--docs=')) source = arg.slice('--docs='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/sync-docs.mjs [--docs=/path/to/starforge/docs]');
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return resolve(source);
}

async function main() {
  const source = parseArgs(process.argv.slice(2));
  const target = join(REPO, 'docs');
  try {
    await stat(source);
  } catch {
    console.error(`no docs directory at ${source}; pass --docs=/path/to/starforge/docs`);
    process.exit(1);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  let count = 0;
  for (const section of SECTIONS) {
    const from = join(source, section);
    const to = join(target, section);
    try {
      await stat(from);
    } catch {
      console.error(`missing section: ${from}`);
      process.exit(1);
    }
    await cp(from, to, { recursive: true });
    const entries = await readdir(to, { withFileTypes: true });
    count += entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length;
  }

  console.log(`synced ${count} markdown files from ${source} into ${target}`);

  // Record the Starforge version the copies came from, so the site footer
  // names the release and not this repository's own version.
  const manifest = await readFile(join(source, '..', 'Cargo.toml'), 'utf8').catch(() => null);
  const version = manifest?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (version) {
    await writeFile(join(target, 'VERSION'), `${version}\n`, 'utf8');
    console.log(`recorded Starforge version ${version}`);
  } else {
    console.error(`no workspace version in ${join(source, '..', 'Cargo.toml')}`);
  }
}

main().catch((error) => {
  console.error(`sync failed: ${error.message}`);
  process.exit(1);
});
