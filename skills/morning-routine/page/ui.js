// The page's shared pieces: one builder for each thing the page repeats, with
// its variants as arguments, so a chip on one row can't drift into a slightly
// different chip on the next. render.js decides what to show; this module
// decides how each piece looks (see styles.css for the matching classes).
//
// Everything is built with createElement and set as text, never as markup.
// Only https:// links become anchors, and photos load only from data:image/
// URIs.

import { icon } from "./icons.js";

export function h(doc, tag, attrs, ...children) {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === "") continue;
    el.append(typeof child === "object" ? child : String(child));
  }
  return el;
}

export const isHttps = (url) => typeof url === "string" && url.startsWith("https://");
export const isPhoto = (src) => typeof src === "string" && src.startsWith("data:image/");

export function link(doc, url, attrs, ...children) {
  return isHttps(url)
    ? h(doc, "a", { ...attrs, href: url, target: "_blank", rel: "noopener noreferrer" }, ...children)
    : h(doc, "span", attrs, ...children);
}

// What an element needs to name itself on hover and keyboard focus.
export const tip = (text, label = text) => ({ "data-tip": text, tabindex: "0", "aria-label": label });

// A note beside a title or a row of tags: an organisation, a project, a count.
export const note = (doc, text, { mono = false } = {}) => h(doc, "span", { class: `note${mono ? " mono" : ""}` }, text);

// ---- chips --------------------------------------------------------------------------

const TONES = new Set(["ok", "warn", "bad", "alarm", "brand"]);

// A chip is neutral grey unless it takes a tone; sans for words, mono for ids
// and numbers; filled, or outlined when it sits beside the row's own ref;
// square for a single digit.
export function chipClass({ tone, mono = false, outline = false, square = false } = {}) {
  return ["chip", TONES.has(tone) ? tone : null, mono && "mono", outline && "outline", square && "sq"].filter(Boolean).join(" ");
}

// One small label for every tag on the page: badges, repo refs, Linear ids,
// sizes, stack segments and section counts. A <b> inside is the part to read
// first. With an https `href` it's a link. `cls` names its role for tests and
// for styling that only one kind of chip needs.
export function chip(doc, content, { href, cls, attrs, ...look } = {}) {
  return link(doc, href, { ...attrs, class: `${chipClass(look)}${cls ? ` ${cls}` : ""}` }, content);
}

// ---- buttons ------------------------------------------------------------------------

// One button for the page. `sm` sits in a row of chips at their height; the
// default size sits in a dialog. `kind` is primary (filled), quiet (muted
// text) or plain (no border or fill, coloured like what's around it).
// `as: "a"` makes it a link that opens in a new tab; the caller sets its href.
export function button(doc, { size, kind, iconOnly = false, as = "button", attrs, onClick } = {}, ...children) {
  const cls = ["btn", size, kind, iconOnly && "icon"].filter(Boolean).join(" ");
  const el =
    as === "a"
      ? h(doc, "a", { ...attrs, class: cls, target: "_blank", rel: "noopener noreferrer" }, children)
      : h(doc, "button", { ...attrs, type: "button", class: cls }, children);
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

// ---- people -------------------------------------------------------------------------

// A teammate's circle: their photo, or their initials when there's none.
export function avatar(doc, { photo, initials, label }) {
  return h(doc, "span", { class: "av", ...tip(label) }, isPhoto(photo) ? h(doc, "img", { src: photo, alt: "" }) : h(doc, "b", null, initials));
}

// Everyone on the page is the same rounded pill: a teammate with their face
// and first name, a guest in grey with only a name that names them on hover.
export function pill(doc, { name, face, guest = false, label, attrs }) {
  return guest
    ? h(doc, "span", { ...attrs, class: "pp guest", "data-external": "", ...tip(label ?? name) }, name)
    : h(doc, "span", { ...attrs, class: "pp" }, face, name);
}

// Faces overlapping in a row, for when there are too many to name.
export const pile = (doc, faces) =>
  h(doc, "span", { class: "pile" }, faces.map(({ face, attrs }) => h(doc, "span", { ...attrs, class: "pile-face" }, face)));

// ---- the line -----------------------------------------------------------------------

// A status icon in its own column, explained on hover.
export function cell(doc, signal, name, tone, text, ...extra) {
  return h(doc, "span", { class: "ic", "data-signal": signal, ...(text ? tip(text) : null) }, name ? icon(doc, name, tone) : null, ...extra);
}

// The one thing to do about a line, in the right-hand column. Without an
// https link it's a plain cell that says why there's nothing to click.
export function action(doc, { tone, verb, url, sub }) {
  const linked = isHttps(url);
  return link(
    doc,
    url,
    { class: `act ${linked ? tone : "idle"}`, "data-action": "" },
    h(doc, "span", { class: "v" }, verb, linked ? icon(doc, "arrow") : null),
    sub ? h(doc, "span", { class: "sub" }, sub) : null,
  );
}

export function row(doc, { ln, title, tags, meta, extra, sig, when, lateness, act, cls, attrs }) {
  return h(
    doc,
    "div",
    { class: `row${cls ? ` ${cls}` : ""}`, ...attrs },
    h(doc, "span", { class: "ln" }, ln ?? ""),
    h(
      doc,
      "div",
      { class: "body" },
      h(doc, "div", { class: "t" }, title),
      tags?.flat(Infinity).some(Boolean) ? h(doc, "div", { class: "tags" }, tags) : null,
      (Array.isArray(meta) ? meta.length : meta) ? h(doc, "div", { class: "m" }, meta) : null,
      extra,
    ),
    h(doc, "span", { class: "sig" }, sig),
    h(doc, "span", { class: `when${lateness ? ` ${lateness}` : ""}` }, when ?? ""),
    act,
  );
}

// A numbered part of the form: a heading band over its lines. With `columns`
// the band carries column icons lined up with the rows below it.
export function section(doc, { id, numeral, label, count, columns, children }) {
  const heading = h(
    doc,
    "h2",
    { class: `caps${columns ? " cols-h" : ""}` },
    h(doc, "span", { class: "lbl" }, h(doc, "span", { class: "pn" }, numeral), label),
    columns,
    chip(doc, h(doc, "b", null, count), { tone: "brand", mono: true, cls: "cnt" }),
  );
  return h(doc, "section", { class: "part", id, "data-section": id, "data-slot": id }, heading, children);
}

// A <details> whose summary leads with a chevron that turns when it opens.
export function fold(doc, { cls, open = false, attrs, summaryClass }, summary, ...children) {
  return h(doc, "details", { ...attrs, class: `fold ${cls}`, open }, h(doc, "summary", { class: summaryClass }, icon(doc, "chev"), summary), children);
}

// ---- dialogs ------------------------------------------------------------------------

// A modal with a forest title bar and a close button; the caller fills `body`.
export function dialogShell(doc, kind, heading) {
  const title = h(doc, "h2", null, heading);
  const body = h(doc, "div", { class: "dlg-body" });
  const dialog = h(
    doc,
    "dialog",
    { class: `dlg ${kind}`, [`data-${kind}-dialog`]: "", "aria-label": heading },
    h(
      doc,
      "header",
      { class: "dlg-head" },
      title,
      button(doc, { kind: "plain", iconOnly: true, attrs: { "aria-label": "Close" }, onClick: () => dialog.close() }, icon(doc, "close")),
    ),
    body,
  );
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return { dialog, title, body };
}

export function showDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}
