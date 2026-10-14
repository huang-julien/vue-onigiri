const VOID_HTML_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAWTEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

/** Comment data the marker transport acts on: onigiri prefixes and Vue's fragment anchors. */
const RESERVED_COMMENT_DATA = /^(?:o:[cts]\[|\/o:[cs]$|\[$|\]$)/;
// Browsers also build comment nodes from bogus openers: `<!x>` and `</` + non-letter.
const RESERVED_HTML_COMMENT =
  /<(?:!--(?=o:[cts]\[|(?:\/o:[cs]|\[|\])--!?>)|!(?!--)(?=o:[cts]\[|(?:\/o:[cs]|\[|\])>)|\/(?=[[\]]>))/g;

/**
 * Count the number of root nodes in an HTML string.
 * Use for StaticVNode to determine how many nodes will be hydrated on the client.
 */
export function countHtmlRootNodes(html: string): number {
  return scanHtmlRootNodes(html);
}

/** True when comment data would be read as an onigiri marker or a Vue fragment anchor. */
export function isReservedCommentData(data: string): boolean {
  return RESERVED_COMMENT_DATA.test(data);
}

/** Prefix reserved comment data with a space so the client walker treats it as a plain comment. */
export function neutralizeCommentData(data: string): string {
  return isReservedCommentData(data) ? ` ${data}` : data;
}

/** Rewrite every comment in raw HTML, at any depth, whose data collides with reserved marker data. */
export function neutralizeHtmlComments(html: string): string {
  return html.includes("<!") || html.includes("</[") || html.includes("</]")
    ? html.replace(RESERVED_HTML_COMMENT, "$& ")
    : html;
}

/** Split raw HTML at root comments so static runs never adopt a comment first. */
export function splitHtmlRootComments(html: string): [html: string, isComment: boolean][] {
  const parts: [string, boolean][] = [];
  let offset = 0;
  scanHtmlRootNodes(html, (start, end) => {
    if (start > offset) parts.push([html.slice(offset, start), false]);
    parts.push([html.slice(start + 4, end - 3), true]);
    offset = end;
  });
  if (offset < html.length) parts.push([html.slice(offset), false]);
  return parts;
}

function scanHtmlRootNodes(html: string, onComment?: (start: number, end: number) => void): number {
  if (!html) return 0;

  let count = 0;
  let depth = 0;
  let i = 0;

  while (i < html.length) {
    if (html[i] !== "<") {
      // Text run up to the next tag; whitespace-only runs are real text nodes.
      if (depth === 0) count++;
      while (i < html.length && html[i] !== "<") i++;
      continue;
    }

    const next = html[i + 1] ?? "";

    if (next === "/") {
      if (depth > 0) depth--;
      const end = html.indexOf(">", i);
      if (end === -1) break;
      i = end + 1;
    } else if (html.startsWith("<!--", i)) {
      if (depth === 0) count++;
      const end = html.indexOf("-->", i + 4);
      if (end === -1) break;
      if (depth === 0) onComment?.(i, end + 3);
      i = end + 3;
    } else if (next === "!" || next === "?") {
      // Doctype / processing instruction: dropped by fragment parsing.
      const end = html.indexOf(">", i);
      if (end === -1) break;
      i = end + 1;
    } else if (/[a-zA-Z]/.test(next)) {
      const end = findTagEnd(html, i + 1);
      if (end === -1) break;
      const tagName =
        html
          .slice(i + 1, end)
          .match(/^([a-zA-Z][\w-]*)/)?.[1]
          ?.toLowerCase() ?? "";
      if (depth === 0) count++;
      const selfClosing = html[end - 1] === "/";
      i = end + 1;

      if (VOID_HTML_ELEMENTS.has(tagName) || selfClosing) continue;

      if (RAWTEXT_ELEMENTS.has(tagName)) {
        const close = html.toLowerCase().indexOf(`</${tagName}`, i);
        if (close === -1) break;
        const closeEnd = html.indexOf(">", close);
        if (closeEnd === -1) break;
        i = closeEnd + 1;
        continue;
      }

      depth++;
    } else {
      if (depth === 0) count++;
      i++;
      while (i < html.length && html[i] !== "<") i++;
    }
  }

  return Math.max(1, count);
}

function findTagEnd(html: string, from: number): number {
  let quote: string | undefined;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}
