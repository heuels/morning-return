// The page's icon set: drawn on a 16px grid with a 1.6 stroke and round caps,
// so every status reads at the same weight. The paths are constants, never
// gathered data.

const PATHS = {
  "ci-ok": '<circle cx="8" cy="8" r="6.2"/><path d="m5.4 8.2 1.8 1.8 3.4-3.6"/>',
  "ci-fail": '<circle cx="8" cy="8" r="6.2"/><path d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4"/>',
  "ci-run": '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.2 1.4"/>',
  none: '<path d="M5.5 8h5"/>',
  merge:
    '<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="8" r="1.6"/><path d="M4.5 5.1v5.8M4.5 5.6c0 2 2 2.4 5.4 2.4"/>',
  conflict: '<path d="M8 2.2 14.2 13H1.8Z"/><path d="M8 6.4v3m0 1.9v.1"/>',
  behind: '<path d="M8 2.5v8m-3.5-3.5L8 10.5l3.5-3.5M3.5 13.5h9"/>',
  approved:
    '<path d="M8 1.8 13.6 4v4c0 3.2-2.4 5.4-5.6 6.2C4.8 13.4 2.4 11.2 2.4 8V4Z"/><path d="m5.6 8 1.7 1.7 3.2-3.4"/>',
  changes: '<path d="M8 1.8 13.6 4v4c0 3.2-2.4 5.4-5.6 6.2C4.8 13.4 2.4 11.2 2.4 8V4Z"/><path d="m6 6 4 4m0-4-4 4"/>',
  shield: '<path d="M8 1.8 13.6 4v4c0 3.2-2.4 5.4-5.6 6.2C4.8 13.4 2.4 11.2 2.4 8V4Z"/>',
  "needs-review": '<path d="M1.6 8s2.4-4.6 6.4-4.6S14.4 8 14.4 8s-2.4 4.6-6.4 4.6S1.6 8 1.6 8Z"/><circle cx="8" cy="8" r="1.9"/>',
  thread:
    '<path d="M3.6 2.6h8.8c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H7.4l-3 2.4V11h-.8c-.7 0-1.2-.5-1.2-1.2v-6c0-.7.5-1.2 1.2-1.2Z"/>',
  hourglass: '<path d="M4 1.8h8M4 14.2h8M5 1.8v2.6L8 8l3-3.6V1.8M5 14.2v-2.6L8 8l3 3.6v2.6"/>',
  video: '<rect x="1.6" y="4" width="9" height="8" rx="1.6"/><path d="m10.6 7 3.8-2.2v6.4L10.6 9"/>',
  phone:
    '<path d="M3.2 2.2h2.6l1.2 3-1.6 1.1a8 8 0 0 0 4.3 4.3l1.1-1.6 3 1.2v2.6c0 .7-.6 1.2-1.3 1.2A11.6 11.6 0 0 1 2 3.5c0-.7.5-1.3 1.2-1.3Z"/>',
  mail: '<rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.6"/><path d="m2.4 4.4 5.6 4.4 5.6-4.4"/>',
  slack: '<path d="M6 2.2v11.6M10 2.2v11.6M2.2 6h11.6M2.2 10h11.6"/>',
  alert: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8v3.6m0 2.6v.1"/>',
  issue: '<circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="2.1"/>',
  terminal: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="m4.6 6.4 2 1.6-2 1.6M8.4 10.2h3"/>',
  book: '<path d="M2.4 3.2h4.2c.8 0 1.4.6 1.4 1.4v8.6c0-.7-.6-1.2-1.3-1.2H2.4ZM13.6 3.2H9.4c-.8 0-1.4.6-1.4 1.4v8.6c0-.7.6-1.2 1.3-1.2h4.3Z"/>',
  close: '<path d="m4 4 8 8m0-8-8 8"/>',
  arrow: '<path d="M4.5 11.5 11.5 4.5M5.8 4.5h5.7v5.7"/>',
  chev: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
};

const SVG = "http://www.w3.org/2000/svg";

export function icon(doc, name, tone = "") {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", `i${tone ? ` ${tone}` : ""}`);
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = PATHS[name];
  return svg;
}

const LOGO_PATH =
  "M33.97.09H51.43l-.04 11.05h-7.76a7.2 7.2 0 0 0-5.3 2.18c-.3.36-.5.77-.63 1.21l-.54 1.97c-.16.58-.24 1.18-.24 1.79v17.76c0 .44-.07.88-.21 1.3a5.6 5.6 0 0 1-2.16 2.82l-6.99 4.06V5.82A5.76 5.76 0 0 1 33.97.09Zm-5.79 49.1v10.88l18.55-10.7c.76-.44 1.49-.94 2.17-1.5a6.9 6.9 0 0 0 2.21-3.97l.15-1.1.1-26.85h-6.98c-.45 0-.89.16-1.23.46-.5.43-.86 1-1.03 1.63l-.12.44c-.06.23-.1.47-.1.71v16.57c0 .64-.06 1.28-.19 1.91l-.07.35a10 10 0 0 1-4.58 5.76l-9.33 5.43ZM17.46.09H0l.04 11.05H7.8c2.03 0 3.86.8 5.3 2.18.3.36.5.77.63 1.21l.54 1.97c.16.58.24 1.18.24 1.79v17.76c0 .44.07.88.21 1.3a5.6 5.6 0 0 0 2.16 2.82l6.99 4.06V5.82A5.76 5.76 0 0 0 17.46.09Zm5.79 49.1v10.88L4.7 49.37c-.76-.44-1.49-.94-2.17-1.5a6.9 6.9 0 0 1-2.21-3.97l-.15-1.1-.1-26.85h6.98c.45 0 .89.16 1.23.46.5.43.86 1 1.03 1.63l.12.44c.06.23.1.47.1.71v16.57c0 .64.06 1.28.19 1.91l.07.35a10 10 0 0 0 4.58 5.76l9.33 5.43Z";

// The Taxwire mark, drawn in currentColor: white on the forest header.
export function logo(doc) {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "logo");
  svg.setAttribute("viewBox", "0 0 52 61");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Taxwire");
  const path = doc.createElementNS(SVG, "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", LOGO_PATH);
  svg.append(path);
  return svg;
}
