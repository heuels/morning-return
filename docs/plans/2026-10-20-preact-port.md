# Preact Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `page/` as Preact components written with htm, so state
(dialogs, ticked findings, the session prompt) lives in components rather than
in hand-wired DOM. The page looks and behaves exactly as it does now, and it
still has no build step.

**Architecture:** Preact and htm come from one vendored file. In Task 1,
`renderBrief` and `renderEmpty` become Preact roots that mount into an
element. At that point the old DOM builders still render each part through a
`Legacy` bridge component. Tasks 2–6 each swap one layer for components and
delete the builders it replaces. Task 7 removes the bridge. All 71 existing
tests run at the end of every task.

**Tech Stack:** Preact 10 and htm 3.1.1, from htm's
`preact/standalone.module.js`. Plain ES modules. Tests use Node's test runner
with Playwright and Chromium, plus Python `unittest`.

**Spec:** The decision to port came from the 2026-10-20 session: Preact with
htm, chosen over web components, and planned after the shared-components
review. The page's rules are in `CLAUDE.md` under "The page". The brief
contract is `.claude/skills/morning-return-run/brief-format.md`. The decisions
from that session are recorded below as Global Constraints.

## Global Constraints

- **No build step.** `page/vendor/htm-preact.js` is htm@3.1.1's
  `preact/standalone.module.js`, byte for byte. Load nothing else: no CDN
  script and no import map. Modules import it by relative path.
- **Behaviour is preserved.** No assertion in the existing tests changes.
  Three things in the tests may change:
  - the harness's mount lines in `tests/render.test.mjs` (lines 20–25, 79 and
    445);
  - the three `window.ui.*` call sites (lines 645, 664, 720–723);
  - tests a task adds or deletes.
- **The DOM is preserved.** Element types, class names, `data-*` attributes,
  ARIA and tooltips stay as they are. The only `styles.css` changes allowed
  are the `.legacy` rule while migrating and the fix in Task 5.
- **Gathered text is only ever text.**
  - No `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` or
    `DOMParser` anywhere in `page/` outside `page/vendor/`.
  - Only `https://` URLs become anchors.
  - Images load only from `data:image/` URIs.
- **First paint is synchronous.** When `renderBrief(root, brief, opts)` or
  `renderEmpty(root, reason)` returns, all of the first paint is in the DOM.
  Nothing on first paint waits on `useEffect`. Use `useLayoutEffect` where a
  ref is needed. The one exception is the diff anchor's hash, which is
  already async.
- **Line numbers are computed before rendering.** Never use a counter that is
  mutated during render.
- Colours stay tokens; `tests/styles.test.mjs` checks this.
- No fonts in the repository.
- Never publish the page, update the Routine or fire it unless the user asks.

## Review Focus

1. **A module the port adds is missing from setup's publish list.** The
   published page then 404s on an import and shows nothing. The test is
   `tests/publish.test.mjs` (Task 1).
2. **Opening or closing a dialog re-renders the page and renumbers the
   lines** or changes the totals. Task 3's test pins the line numbers across
   an open and close.
3. **A brief field holds something other than text**, such as a JSON object
   shaped like a vnode (`{"type":"img","props":{…}}`) or a `javascript:` URL.
   It must not become an element or a link. The guard test is added in
   Task 1.
4. **An older brief shape is missing newer fields**, such as `linear`,
   `environment`, `day_blocks` or `out_of_office`. It must render without
   throwing. Test 22 covers meetings. Task 7 adds a test for a brief with
   none of the newer fields.
5. **At phone width (390×844)**, meeting times run into their titles (a known
   bug), and the session dialog must fit the viewport. Tests are added in
   Tasks 5 and 3.

---

### Task 1: Preact in, mounted roots, legacy bridge

**Files:**
- Create: `page/vendor/htm-preact.js`, `page/vendor/README.md`,
  `page/components/legacy.js`, `tests/publish.test.mjs`
- Modify: `page/render.js` (exports only), `page/app.js`, `page/styles.css`
  (one rule), `.claude/skills/morning-return-setup/SKILL.md` (publish list),
  `tests/render.test.mjs` (harness), `README.md` (layout row)

**Interfaces:**
- Produces:
  - `renderBrief(root: Element, brief, {reviews, people, today, startSession}): void`
  - `renderEmpty(root: Element, reason): void`
  - `Legacy({build: () => Node})`: a Preact component. It renders
    `<div class="legacy">` and, in `useLayoutEffect` with `[]` deps,
    replaces the div's children with `build()`.
  - `buildBrief(doc, brief, opts): Element` and `buildEmpty(doc, reason)`:
    the old bodies, kept unexported until deleted.

- [ ] **Step 1: Vendor the library.**
  1. `npm pack htm@3.1.1`.
  2. Copy `package/preact/standalone.module.js` to `page/vendor/htm-preact.js`
     unchanged.
  3. Write `page/vendor/README.md`. It holds the source (the npm package and
     path), the version, the file's `sha256sum`, and the licences: htm is
     Apache-2.0 and Preact is MIT. Copy the licence texts from the package
     into the README.

- [ ] **Step 2: Write `tests/publish.test.mjs`.** It runs in Node only, with
  no browser.
  - `test("every module the page imports is published")`:
    1. Collect the static imports (`from "./…"`) reachable from
       `page/app.js`, recursively.
    2. Parse the `files: [...]` list in setup `SKILL.md` step 3.
    3. Assert every reachable module is in the list.
  - `test("every published file exists")`.
  - `test("the vendored library is the one the README names")`: the
    `sha256` of `page/vendor/htm-preact.js` equals the one in the README.

- [ ] **Step 3: Run it to watch it fail.**
  Run `NODE_PATH=$(npm root -g) node --test tests/publish.test.mjs`.
  It should FAIL on the hash, because the README has none yet; add it.
  After Step 5, the first test fails on `vendor/htm-preact.js` and
  `components/legacy.js` until setup's list names them.

- [ ] **Step 4: Add a guard test to `tests/render.test.mjs`.**
  `test("brief fields that aren't text never become elements or links")`:
  - a PR title set to `{"type":"img","props":{"src":"https://evil.example/x"}}`;
  - a meeting `url` set to `javascript:alert(1)`;
  - an Item `url` set to `JAVASCRIPT:x`.

  Assert all of these:
  - no `img[src^="https:"]`;
  - no `a[href^="javascript" i]`;
  - the number of `script` elements is unchanged.

  It passes on the legacy code, and it guards Tasks 2–7.

- [ ] **Step 5: Switch to mounted roots.**
  1. `render.js` renders ``html`<${Legacy} build=${() => buildBrief(document, brief, opts)} />` ``
     into `root`.
  2. Add `.legacy { display: contents; }` to `styles.css`, so the wrapper adds
     no box.
  3. In `app.js`, call `renderBrief(root, …)` and `renderEmpty(root, …)`
     instead of `show(…)`.
  4. Change the harness the same way: line 79 becomes
     `window.renderBrief(document.body, b, o)`.
  5. Change line 445 to read
     `(window.renderEmpty(document.body, r), document.body.textContent)`.
  6. Add the two new files to setup's `files:` list.

- [ ] **Step 6: Run everything.**
  - `NODE_PATH=$(npm root -g) node --test tests/*.test.mjs`
  - `python3 -m unittest discover -s tests -p 'test_*.py'`

  Expected: every test passes, including the 4 new ones.

- [ ] **Step 7: Sabotage.**
  1. Remove `legacy.js` from setup's list; the publish test must fail.
  2. Make `Legacy` use `useEffect` instead of `useLayoutEffect`; the render
     tests must fail.
  3. Restore both.

- [ ] **Step 8: Commit** with `refactor(page): mount the page with Preact behind a legacy bridge`.

### Task 2: The shared pieces as components

**Files:**
- Create: `page/components/ui.js`, `page/components/icons.js`,
  `tests/parity.test.mjs`
- Modify: `page/ui.js` and `page/icons.js` (import the shared predicates from
  the component modules; no other changes), `tests/render.test.mjs` (the
  three `window.ui` tests)

**Interfaces:**
- Produces, in `page/components/ui.js`:
  - `isHttps`, `isPhoto`, `tip`, `chipClass`, moved here; legacy `ui.js`
    imports them.
  - Components: `Link({url, ...attrs, children})`,
    `Chip({href, cls, attrs, tone, mono, outline, square, children})`,
    `Button({size, kind, iconOnly, as, attrs, onClick, children})`,
    `Avatar({photo, initials, label})`,
    `Pill({name, face, guest, label, attrs})`,
    `Pile({faces})`, `Cell({signal, name, tone, text, children})`,
    `Action({tone, verb, url, sub})`,
    `Row({ln, title, tags, meta, extra, sig, when, lateness, act, cls, attrs})`,
    `Section({id, numeral, label, count, columns, children})`,
    `Fold({cls, open, attrs, summaryClass, summary, children})`.
  - Each keeps the name and props of its builder in `page/ui.js`, minus
    `doc`.
- Produces, in `page/components/icons.js`: `Icon({name, tone})`.
  - Its paths are htm templates, one per icon, with the same `PATHS` keys.
    No markup strings.

- [ ] **Step 1: Write `tests/parity.test.mjs`.**
  1. Open the harness, and import both `/ui.js` and `/components/ui.js`.
  2. For each builder, take a table of argument cases: every tone, mono,
     outline and square for chips; each button `size`/`kind`/`as`; an avatar
     with and without a photo; a teammate pill and a guest pill; a row with
     and without tags, meta and lateness; a section with and without
     columns; a fold open and closed; every icon name.
  3. For each case, assert the component's `outerHTML` equals the builder's.

  This test is scaffolding and is deleted in Task 7.

- [ ] **Step 2: Run it to watch it fail** (the module is missing).

- [ ] **Step 3: Implement the components** in `page/components/ui.js` and
  `page/components/icons.js`. Use the same attribute order as the builders,
  so the HTML strings compare equal.

- [ ] **Step 4: Point the three tests at the components.**
  In `tests/render.test.mjs`, rewrite tests 47, 48 and 52 to render through
  `window.mount(vnode)`. That is a new harness helper: it renders `vnode`
  into a fresh box and returns the box. Expose `window.html` and
  `window.C = components` in the harness. The assertions stay the same.

- [ ] **Step 5: Run everything, then sabotage.**
  1. Run both suites. Expected: all pass.
  2. Change `Chip`'s outline class, and drop `rel` from `Link`; parity and
     test 48 must fail.
  3. Restore both.

- [ ] **Step 6: Commit** with `refactor(page): shared pieces as Preact components`.

### Task 3: Dialogs as components

**Files:**
- Create: `page/components/dialogs.js`, `page/components/markdown.js`
- Modify: `page/render.js` (`ctx.session$` and `ctx.reviews$` become
  adapters; delete `reviewDialog`, `sessionDialog` and `dialogShell` use),
  `page/ui.js` (delete `dialogShell` and `showDialog`), `tests/render.test.mjs`

**Interfaces:**
- Consumes: `Button`, `Link`, `Icon` (Task 2); `prefillUrl` from
  `session.js`.
- Produces:
  - `markdown(text: string): VNode[]`. It is `renderMarkdown`'s grammar,
    emitting vnodes; only `https://` links become anchors.
  - `Dialogs({brief, startSession, api})`. It owns
    `useState<{kind: "review"|"session", args}|null>` and fills
    `api.openReview(pr, review)` and `api.openSession({title, text, repo, branch})`.
    `api` is a `useRef` object created once per mount, so a dialog opening
    never re-renders the sections.
  - `ReviewDialog({pr, review, onClose})` and
    `SessionDialog({request, environment, startSession, onClose})`.
    - Both use a native `<dialog>`, `showModal()` in `useLayoutEffect`, a
      backdrop click to close, and the close button.
    - They keep the current `data-review-dialog`, `data-session-dialog`,
      `data-start`, `data-session-link` and `role="status"` hooks.
- Legacy rows keep calling `ctx.reviews$.open(pr, review)` and
  `ctx.session$.open({...})`. Those become one-line adapters over `api`.

- [ ] **Step 1: Write the failing tests.**
  - `test("opening and closing a dialog leaves line numbers and totals as they were")`:
    1. Record every `.row .ln` text and the `.totals` text.
    2. Open a review dialog, close it, then open and close a session dialog.
    3. Assert both are unchanged.
  - `test("the session dialog fits a phone screen")`: at 390×844, open the
    session dialog and assert its bounding box is inside the viewport.

- [ ] **Step 2: Run them.** The new tests pass or fail as the legacy code
  stands. Write down which, so Step 5 shows the port didn't change that.

- [ ] **Step 3: Implement** `markdown`, `Dialogs`, `ReviewDialog` and
  `SessionDialog`.
  - Mount `Dialogs` beside the `Legacy` root in `renderBrief`.
  - The session dialog's state: the title, the prompt (controlled inputs),
    `status: {tone, text, url}` and `busy`.
  - The prefill link follows the prompt as it changes. Keep the error text
    from `startSession` as it is.

- [ ] **Step 4: Delete** `reviewDialog`, `sessionDialog`, `dialogShell` and
  `showDialog`.

- [ ] **Step 5: Run everything.** Expected: all pass, including tests 18
  and 42–45.

- [ ] **Step 6: Sabotage.**
  1. Make `api` a plain object recreated on every render; the line-number
     test must fail if the sections re-render.
  2. Drop the `https` check in `markdown`; the "non-https links" test must
     fail.
  3. Restore both.

- [ ] **Step 7: Commit** with `refactor(page): dialogs as Preact components`.

### Task 4: The PR column (sections I, II, III)

**Files:**
- Create: `page/components/prs.js`
- Modify: `page/rank.js`, `page/render.js` (delete the PR builders),
  `tests/rank.test.mjs`

**Interfaces:**
- Produces, in `rank.js` (pure, tested in Node):
  `myPrRows(prs, linearIssues): Array<{kind: "pr"|"stack"|"band", ...}>`.
  It holds the grouping `myPrsSection`, `stackRow` and `linearBand` do today,
  in display order.
- Produces, in `page/components/prs.js`:
  - `ReviewSection({ctx, start})`, `MyPrsSection({ctx, start})`,
    `StaleSection({ctx, start})`;
  - `prColumnNumbers(brief, linearIssues): {review: number, mine: number, closed: number, fix: number, merge: number}`,
    which gives each section's first line number and the totals' counts.
- Consumes: Task 2 components; `api` from Task 3, via `ctx.api`.

- [ ] **Step 1: Write the failing test** in `tests/rank.test.mjs`.
  `test("my PR rows come grouped by Linear issue, then stacks, in ranking order")`
  takes the fixture's `my_prs` and `linear_issues`. It asserts the kinds and
  PR numbers of `myPrRows` against the order test 10 and test 36 show today.

- [ ] **Step 2: Run it to watch it fail** (`myPrRows` is missing).

- [ ] **Step 3: Implement `myPrRows`.** Then implement the PR components:
  - `Signals`, `SizeBadge`, `ReviewRow`, `CompactRow`, `MyRow`, `StackRow`,
    `LinearBand`.
  - `CodeLink`: the diff hash is set in `useEffect`, as before.
  - `ReviewDetails`: the ticked findings live in `useState`, all ticked to
    start.
  - The three sections.

  In `renderBrief`, the left column renders these components followed by the
  remaining legacy parts. A source error at the top of a column renders as a
  component, because `.col > .source-error:first-child` needs it unwrapped.

- [ ] **Step 4: Delete** the PR builders from `render.js`.

- [ ] **Step 5: Run everything.** Expected: all pass, including tests 1–20,
  29 and 36–37.

- [ ] **Step 6: Sabotage.**
  1. Swap two branches of `myPrRows`; the rank test and test 10 must fail.
  2. Restore.

- [ ] **Step 7: Commit** with `refactor(page): the PR column in Preact`.

### Task 5: Meetings (section A), with the phone-width fix

**Files:**
- Create: `page/components/meetings.js`
- Modify: `page/render.js` (delete the meeting builders), `page/styles.css`
  (`@media (max-width: 600px)`, `.row.mtg`), `tests/render.test.mjs`

**Interfaces:**
- Produces: `MeetingsSection({ctx})`. It holds `MeetingRow`, `DayStrip`,
  `OutLine`, `AttendeeTags` and `AwayBadges`. These are the builders between
  `render.js:635` and `:730`, together with `externals`, `face`, `teammate`
  and `faces`. Those helpers move to `page/components/people.js` when another
  section needs them too.

- [ ] **Step 1: Write the failing test.**
  `test("at phone width a meeting's time never runs into its title")`:
  1. Use a 390×844 viewport.
  2. Give one meeting at 17:30 a 40-character title.
  3. For each `.row.mtg`, take the right edge of a `Range` over the `.ln`
     text and the left edge of `.body`.
  4. Assert right ≤ left.

- [ ] **Step 2: Run it to watch it fail** on today's CSS.

- [ ] **Step 3: Fix it in CSS.** At ≤600px, `.row.mtg` gets an `ln` column
  wide enough for `HH:MM` at its font size. Set that with
  `grid-template-columns` on `.row.mtg`. Leave other rows as they are.

- [ ] **Step 4: Port the section** to `MeetingsSection`, and delete its
  builders.

- [ ] **Step 5: Run everything.** Expected: all pass, including tests 21–26,
  38–39 and the new one.

- [ ] **Step 6: Sabotage.**
  1. Revert the CSS; the new test must fail.
  2. Restore.

- [ ] **Step 7: Commit** with `fix(page): meeting times clear their titles on phones; meetings in Preact`.

### Task 6: Replies (B), Linear (C) and worth-knowing (D)

**Files:**
- Create: `page/components/asks.js`, `page/components/linear.js`
- Modify: `page/render.js` (delete `itemRow`, `linearSection` and the B/D
  assembly)

**Interfaces:**
- Produces:
  - `RepliesSection({ctx})`, which covers `mail_asks`, `slack_asks` and
    `linear_asks`;
  - `FyiSection({ctx})`;
  - `LinearSection({ctx})`, whose rows are numbered `C1…` from the data,
    not from a render counter;
  - `ItemRow({ctx, item, ln, source, defaults})`.

- [ ] **Step 1: Port** the three sections, and delete their builders.

- [ ] **Step 2: Run everything.** Expected: all pass, including tests 27–28,
  30, 40–41 and the guard from Task 1.

- [ ] **Step 3: Sabotage.**
  1. Number Linear rows with a counter incremented in render, then open and
     close a dialog; Task 3's line-number test must fail.
  2. Restore.

- [ ] **Step 4: Commit** with `refactor(page): replies, Linear and worth-knowing in Preact`.

### Task 7: The shell; remove the bridge

**Files:**
- Create: `page/components/brief.js`, `tests/source.test.mjs`
- Modify: `page/render.js` (it keeps only `renderBrief`/`renderEmpty`), setup
  `SKILL.md` (publish list), `CLAUDE.md` (The page), `README.md`,
  `tests/render.test.mjs`
- Delete: `page/ui.js`, `page/icons.js`, `page/markdown.js`,
  `page/components/legacy.js`, `tests/parity.test.mjs`, the `.legacy` rule

**Interfaces:**
- Produces: `Brief({brief, reviews, people, today, startSession})` and
  `Empty({reason})`. The header, totals, source errors, notes, the
  older-brief banner and the two columns move from `buildBrief`.

- [ ] **Step 1: Write the failing tests.**
  - `test("a brief from before Linear, calendars and sessions were gathered still renders")`
    (render test). The brief has only `run_date`, `generated_at`,
    `timezone`, `sources` (github, slack, gmail, calendar), `today`,
    `review_prs`, `team_review_prs`, `my_prs`, `stale_closed`, `slack_asks`,
    `slack_discussions`, `mail_asks` and `notes`. Assert no page error and
    that sections I and B render.
  - `test("the page never parses markup")` (`tests/source.test.mjs`). In
    every `page/**/*.js` outside `vendor/`, there is no `innerHTML`,
    `outerHTML =`, `insertAdjacentHTML`, `dangerouslySetInnerHTML` or
    `DOMParser`.

- [ ] **Step 2: Run them.** The source test fails until legacy `icons.js` is
  deleted.

- [ ] **Step 3: Implement the shell.**
  1. Implement `Brief` and `Empty`, and make `renderBrief`/`renderEmpty`
     render them.
  2. Delete the legacy modules, the bridge, the parity test and `.legacy`.
  3. Update setup's `files:` list to what remains. The publish test checks
     it.
  4. Update `CLAUDE.md` "The page": shared components live in
     `page/components/ui.js`; gathered text is never parsed as markup; the
     page loads only `page/vendor/htm-preact.js`. Update the README's layout
     row for `page/` to match.

- [ ] **Step 4: Run everything.** Expected: all tests pass. The count is 71
  existing, plus the new ones, minus the parity test.

- [ ] **Step 5: Sabotage.**
  1. Put `dangerouslySetInnerHTML` in `Icon`; the source test must fail.
  2. Drop a module from setup's list; the publish test must fail.
  3. Restore both.

- [ ] **Step 6: Look at it.** Use Playwright to screenshot the fixture brief
  at 1280×900 and 390×844, in light and in dark. Compare the screenshots with
  the same shots taken from `main` before Task 1. Nothing should move except
  the meeting times at 390.

- [ ] **Step 7: Commit** with `refactor(page): the whole page in Preact; drop the DOM builders`.

- [ ] **Step 8: Hand off.** Ask the user whether to publish the page (setup
  step 3). Don't publish unasked.
