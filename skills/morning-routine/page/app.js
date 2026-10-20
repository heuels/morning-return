// Wires the page to its database: the newest document in `briefs`, plus the
// `reviews` documents that brief points at. The Routine writes both.

import { renderBrief, renderEmpty } from "./render.js";

const root = document.getElementById("app");
const show = (el) => root.replaceChildren(el);

function todayIn(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(),
    );
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const reviewIds = (brief) =>
  [...(brief.review_prs ?? []), ...(brief.my_prs ?? [])].map((pr) => pr.review_id).filter(Boolean);

function showError(error) {
  const box = document.createElement("div");
  box.className = "brief empty";
  const p = document.createElement("p");
  p.className = "source-error";
  p.textContent = `Couldn't load the brief (${error?.code ?? "unknown error"}). Reload the page to try again.`;
  box.append(p);
  show(box);
}

async function start() {
  const db = (await window.claude?.use?.("db")) ?? null;
  if (!db) {
    show(renderEmpty(document, "no-db"));
    return;
  }

  const reviews = {};
  let latest = null;
  const draw = () =>
    show(latest ? renderBrief(document, latest, reviews, todayIn(latest.timezone)) : renderEmpty(document, "no-brief"));

  async function loadReviews(brief) {
    const missing = reviewIds(brief).filter((id) => !(id in reviews));
    if (missing.length === 0) return;
    const snaps = await Promise.all(missing.map((id) => db.doc(`reviews/${id}`).get().catch(() => null)));
    snaps.forEach((snap, i) => {
      if (snap?.exists) reviews[missing[i]] = snap.data();
    });
    if (brief === latest) draw();
  }

  db.collection("briefs")
    .orderBy("run_date", "desc")
    .limit(1)
    .onSnapshot((snap) => {
      latest = snap.empty ? null : snap.docs[0].data();
      draw();
      if (latest) loadReviews(latest);
    }, showError);
}

start();
