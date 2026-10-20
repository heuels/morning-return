// A small Markdown reader for pr-review write-ups: headings, paragraphs,
// lists, tables, fenced code, and inline code, bold and links. It builds DOM
// nodes directly, so nothing in a review is ever parsed as HTML, and only
// https:// links become anchors.

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https:\/\/[^)\s]+)\))/;

function inline(doc, text) {
  const out = [];
  let rest = String(text);
  for (let m = rest.match(INLINE); m; m = rest.match(INLINE)) {
    if (m.index > 0) out.push(doc.createTextNode(rest.slice(0, m.index)));
    const [token] = m;
    let node;
    if (m[1]) {
      node = doc.createElement("code");
      node.textContent = token.slice(1, -1);
    } else if (m[2]) {
      node = doc.createElement("strong");
      node.textContent = token.slice(2, -2);
    } else {
      node = doc.createElement("a");
      node.href = m[4];
      node.target = "_blank";
      node.rel = "noopener noreferrer";
      node.textContent = token.slice(1, token.indexOf("]("));
    }
    out.push(node);
    rest = rest.slice(m.index + token.length);
  }
  if (rest) out.push(doc.createTextNode(rest));
  return out;
}

const el = (doc, tag, children = []) => {
  const node = doc.createElement(tag);
  node.append(...children);
  return node;
};

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

export function renderMarkdown(doc, markdown) {
  const root = doc.createElement("div");
  root.className = "md";
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
    } else if (line.startsWith("```")) {
      const body = [];
      for (i += 1; i < lines.length && !lines[i].startsWith("```"); i += 1) body.push(lines[i]);
      i += 1;
      root.append(el(doc, "pre", [el(doc, "code", [doc.createTextNode(body.join("\n"))])]));
    } else if (/^#{1,6}\s/.test(line)) {
      const level = Math.min(line.match(/^#+/)[0].length + 1, 6);
      root.append(el(doc, `h${level}`, inline(doc, line.replace(/^#+\s*/, ""))));
      i += 1;
    } else if (line.trim().startsWith("|")) {
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i += 1) rows.push(cells(lines[i]));
      const body = rows.filter((r, n) => !(n === 1 && r.every((c) => /^:?-+:?$/.test(c))));
      const [head, ...rest] = body;
      const table = el(doc, "table", [
        el(doc, "thead", [el(doc, "tr", head.map((c) => el(doc, "th", inline(doc, c))))]),
        el(doc, "tbody", rest.map((r) => el(doc, "tr", r.map((c) => el(doc, "td", inline(doc, c)))))),
      ]);
      root.append(el(doc, "div", [table]));
      root.lastChild.className = "md-table";
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i += 1) {
        items.push(el(doc, "li", inline(doc, lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))));
      }
      root.append(el(doc, ordered ? "ol" : "ul", items));
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i]); i += 1) {
        para.push(lines[i].trim());
      }
      root.append(el(doc, "p", inline(doc, para.join(" "))));
    }
  }
  return root;
}
