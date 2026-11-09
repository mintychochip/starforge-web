import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';

/** Drop the `<!-- ste-sources ... -->` bookkeeping comment from a page. */
export function stripSteComments(source) {
  return source.replace(/<!--\s*ste-sources[\s\S]*?-->\s*/g, '');
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a literal `<value>` placeholder so markdown does not treat it as HTML. */
export function escapeAngles(text) {
  return text.replace(/<([A-Za-z][^<>]*?)>/g, '&lt;$1&gt;');
}

/**
 * Apply `escapeAngles` everywhere except inside code: fenced blocks stay
 * verbatim, and backtick spans (which may cross single newlines) are copied
 * through untouched.
 */
export function escapePseudoTags(source) {
  const lines = source.split('\n');
  const out = [];
  let text = [];
  const flush = () => {
    if (text.length) {
      out.push(escapeOutsideCode(text.join('\n')));
      text = [];
    }
  };

  let fence = null;
  for (const line of lines) {
    const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      const length = fenceMatch[2].length;
      if (!fence) {
        flush();
        fence = { marker, length };
        out.push(line);
        continue;
      }
      if (fenceMatch[2][0] === fence.marker && fenceMatch[2].length >= fence.length) {
        fence = null;
        out.push(line);
        continue;
      }
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }
    text.push(line);
  }
  flush();
  return out.join('\n');
}

function escapeOutsideCode(text) {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('`', index);
    if (open === -1) {
      out += escapeAngles(text.slice(index));
      break;
    }
    out += escapeAngles(text.slice(index, open));
    const runLength = (text.slice(open).match(/^`+/) ?? [''])[0].length;
    const paragraphEnd = text.indexOf('\n\n', open);
    const limit = paragraphEnd === -1 ? text.length : paragraphEnd;
    const closing = findClosingRun(text, open + runLength, limit, runLength);
    if (closing === -1) {
      out += text.slice(open, open + runLength);
      index = open + runLength;
      continue;
    }
    out += text.slice(open, closing + runLength);
    index = closing + runLength;
  }
  return out;
}

function findClosingRun(text, from, limit, length) {
  let cursor = from;
  while (cursor < limit) {
    const tick = text.indexOf('`', cursor);
    if (tick === -1 || tick >= limit) return -1;
    const runLength = (text.slice(tick).match(/^`+/) ?? [''])[0].length;
    if (runLength === length) return tick;
    cursor = tick + runLength;
  }
  return -1;
}

/** The mermaid diagram sources of a page, in document order. */
export function extractMermaid(source) {
  const diagrams = [];
  const pattern = /^```mermaid[^\n]*\n([\s\S]*?)^```[^\n]*$/gm;
  for (const match of source.matchAll(pattern)) {
    diagrams.push(match[1].replace(/\n$/, ''));
  }
  return diagrams;
}

const DIAGRAM_PLACEHOLDER = (index) => `\u0000diagram:${index}\u0000`;

/**
 * Build a marked instance for one page.
 *
 * options:
 *   rewriteHref(href)  -> string | null   (null drops the link, keeps the text)
 *   highlight(lang, text) -> string | null
 *   diagrams           -> array of HTML strings, consumed in fence order
 *   onMissing          -> function(href)
 */
export function createMarkedRenderer({
  rewriteHref = (href) => href,
  highlight = () => null,
  diagrams = [],
  onDropped = () => {},
} = {}) {
  let diagramIndex = 0;
  let missingLinks = 0;

  const marked = new Marked({
    gfm: true,
    renderer: {
      link(token) {
        const text = this.parser.parseInline(token.tokens);
        const href = rewriteHref(token.href);
        if (href === null) {
          missingLinks += 1;
          onDropped(token.href);
          return text;
        }
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        const rel = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) ? ' rel="noreferrer"' : '';
        return `<a href="${escapeHtml(href)}"${title}${rel}>${text}</a>`;
      },
      image(token) {
        const href = rewriteHref(token.href);
        if (href === null) return escapeHtml(token.text ?? '');
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(token.text ?? '')}"${title}>`;
      },
      code(token) {
        const lang = (token.lang ?? '').trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'mermaid') {
          const html = diagrams[diagramIndex];
          const placeholder = DIAGRAM_PLACEHOLDER(diagramIndex);
          diagramIndex += 1;
          return html ?? placeholder;
        }
        const highlighted = highlight(lang, token.text);
        if (highlighted !== null && highlighted !== undefined) return highlighted;
        const classAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        return `<pre><code${classAttr}>${escapeHtml(token.text)}</code></pre>`;
      },
    },
  });

  marked.use(gfmHeadingId());
  return { marked, stats: () => ({ missingLinks, diagrams: diagramIndex }) };
}

/** Render the body of a documentation page. */
export function renderDocBody(page, options) {
  const source = escapePseudoTags(stripSteComments(page.source));
  const { marked } = createMarkedRenderer(options);
  let html = marked.parse(source);
  // Remove the leading H1; the layout prints the title itself.
  html = html.replace(/<h1[^>]*>[\s\S]*?<\/h1>\n?/, '');
  return html;
}
