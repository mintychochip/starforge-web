import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTarget, slugFor, titleOf, urlFor } from '../src/docs.mjs';
import {
  createMarkedRenderer,
  escapePseudoTags,
  extractMermaid,
  renderDocBody,
  stripSteComments,
} from '../src/render.mjs';

describe('slugFor', () => {
  it('maps README to a section index', () => {
    assert.equal(slugFor('technical/README.md'), 'technical/index');
    assert.equal(slugFor('README.md'), 'index');
  });

  it('keeps nested paths', () => {
    assert.equal(slugFor('user/trails.md'), 'user/trails');
    assert.equal(urlFor('user/trails.md', '/x/'), '/x/user/trails.html');
  });
});

describe('titleOf', () => {
  it('reads the first H1', () => {
    assert.equal(titleOf('# Trails\n\nbody\n'), 'Trails');
    assert.equal(titleOf('no title here'), null);
  });
});

describe('resolveTarget', () => {
  it('resolves same-directory and parent links', () => {
    assert.deepEqual(resolveTarget('technical/crates.md', 'architecture.md'), {
      path: 'technical/architecture.md',
      hash: '',
    });
    assert.deepEqual(resolveTarget('technical/web-and-auth.md', '../user/ci.md'), {
      path: 'user/ci.md',
      hash: '',
    });
    assert.deepEqual(resolveTarget('user/ci.md', './sessions.md#the-end'), {
      path: 'user/sessions.md',
      hash: '#the-end',
    });
  });

  it('resolves a directory link to the bare directory', () => {
    assert.deepEqual(resolveTarget('technical/web-and-auth.md', '../user/'), {
      path: 'user',
      hash: '',
    });
  });
});

describe('escapePseudoTags', () => {
  it('escapes bare angle placeholders outside backticks', () => {
    assert.equal(escapePseudoTags('prints <dir> now'), 'prints &lt;dir&gt; now');
  });

  it('leaves code spans, including spans that cross a newline, untouched', () => {
    const source = 'with `{"session":\n"<ulid>"}` and `<dir>`';
    assert.equal(escapePseudoTags(source), source);
  });

  it('leaves fenced blocks untouched', () => {
    const source = '```bash\ngit push <repo>\n```\n\nafter <x>';
    assert.equal(escapePseudoTags(source), '```bash\ngit push <repo>\n```\n\nafter &lt;x&gt;');
  });

  it('does not touch comparisons without a tag shape', () => {
    assert.equal(escapePseudoTags('a < b and c > d'), 'a < b and c > d');
  });

  it('escapes placeholders that follow an unmatched backtick run', () => {
    assert.equal(escapePseudoTags('`unclosed <tag>'), '`unclosed &lt;tag&gt;');
  });
});

describe('stripSteComments', () => {
  it('removes the ste-sources bookkeeping comment', () => {
    const source = '# T\n\n<!-- ste-sources\nCargo.toml\n-->\n\nBody.\n';
    assert.equal(stripSteComments(source), '# T\n\nBody.\n');
  });
});

describe('extractMermaid', () => {
  it('returns each diagram body in order', () => {
    const source = '```mermaid\nflowchart LR\n  A --> B\n```\n\ntext\n\n```mermaid\nflowchart TD\n  C --> D\n```\n';
    assert.deepEqual(extractMermaid(source), ['flowchart LR\n  A --> B', 'flowchart TD\n  C --> D']);
  });

  it('ignores other fences', () => {
    assert.deepEqual(extractMermaid('```rust\nfn a() {}\n```\n'), []);
  });
});

describe('markdown renderer', () => {
  const render = (source, options = {}) =>
    renderDocBody({ rel: 'user/example.md', source }, options);

  it('rewrites links and keeps anchors', () => {
    const html = render('See [Sessions](sessions.md#use) and [Secrets](#secrets).', {
      rewriteHref: (href) => (href.endsWith('.md#use') ? '/user/sessions.html#use' : href),
    });
    assert.match(html, /href="\/user\/sessions\.html#use"/);
    assert.match(html, /href="#secrets"/);
  });

  it('drops an unresolvable link but keeps its text', () => {
    const dropped = [];
    const html = render('[gone](missing.md) here', {
      rewriteHref: () => null,
      onDropped: (href) => dropped.push(href),
    });
    assert.equal(dropped[0], 'missing.md');
    assert.doesNotMatch(html, /href="missing\.md"/);
    assert.match(html, /gone/);
  });

  it('marks external links as noreferrer', () => {
    const html = render('[up](https://example.com/x)');
    assert.match(html, /rel="noreferrer"/);
  });

  it('applies heading ids from GFM slugs', () => {
    const html = render('## Secrets\n\n## Matrix\n');
    assert.match(html, /<h2 id="secrets">/);
    assert.match(html, /<h2 id="matrix">/);
  });

  it('renders highlighted code through the supplied function', () => {
    const html = render('```rust\nfn a() {}\n```', {
      highlight: (lang, text) => `<pre class="shiki">${lang}:${text}</pre>`,
    });
    assert.match(html, /class="shiki">rust:fn a\(\) \{\}<\/pre>/);
  });

  it('escapes code when no highlighter is given', () => {
    const html = render('```text\n<a>&\n```');
    assert.match(html, /&lt;a&gt;&amp;/);
  });

  it('consumes prepared diagram markup in fence order', () => {
    const html = render('```mermaid\nA\n```\n\n```mermaid\nB\n```', {
      diagrams: ['<div class="diagram">one</div>', '<div class="diagram">two</div>'],
    });
    assert.match(html, /one/);
    assert.match(html, /two/);
    assert.ok(html.indexOf('one') < html.indexOf('two'));
  });

  it('removes the leading H1 so the layout owns the page title', () => {
    const html = render('# Trails\n\nBody text.\n');
    assert.doesNotMatch(html, /<h1/);
    assert.match(html, /Body text/);
  });
});
