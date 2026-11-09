#!/usr/bin/env node
/**
 * Serve `dist/` over HTTP for local review.
 *
 *   node scripts/serve.mjs [--port=8080] [--dir=dist]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

function parseArgs(argv) {
  const options = { port: 8080, dir: join(REPO, 'dist') };
  for (const arg of argv) {
    if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length));
    else if (arg.startsWith('--dir=')) options.dir = resolve(arg.slice('--dir='.length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const { port, dir } = parseArgs(process.argv.slice(2));
  await stat(dir).catch(() => {
    console.error(`no build output at ${dir}; run npm run build first`);
    process.exit(1);
  });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const target = join(dir, normalize(pathname).replace(/^\/+/, ''));
    try {
      const body = await readFile(target);
      response.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      const fallback = await readFile(join(dir, '404.html')).catch(() => Buffer.from('not found'));
      response.writeHead(404, { 'content-type': TYPES['.html'] });
      response.end(fallback);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`serving ${dir} at http://127.0.0.1:${port}/`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
