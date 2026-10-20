import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RUN_DIR = REPO / ".claude" / "skills" / "morning-return-run"
SCRIPTS = RUN_DIR / "scripts"
COPY = RUN_DIR / "review-prompt.md"
PR_REVIEW_SH = "plugins/pr-review/skills/pr-review/pr-review.sh"


def load(name):
    sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


review_queue = load("review_queue")
review_doc = load("review_doc")
review_prompt = load("review_prompt")


def pr(number, *, repo="taxwire/api", waiting="2026-10-10T00:00:00Z", size=10, draft=False, head_ref=None):
    return {
        "repo": repo,
        "number": number,
        "head_sha": f"{number:040d}",
        "head_ref": head_ref or f"branch-{number}",
        "base_ref": "main",
        "draft": draft,
        "created_at": waiting,
        "waiting_since": waiting,
        "additions": size,
        "deletions": 0,
    }


def rid(p):
    owner, name = p["repo"].split("/")
    return f"{owner}:{name}:{p['number']}:{p['head_sha']}"


def scratch_with(review_prs=(), my_prs=(), team=(), branches=(), pings=()):
    tmp = tempfile.TemporaryDirectory()
    scratch = Path(tmp.name)
    (scratch / "parts").mkdir()
    github = {
        "sources": {"github": {"ok": True}},
        "fields": {"review_prs": list(review_prs), "my_prs": list(my_prs), "team_review_prs": list(team), "stale_closed": []},
        "notes": [],
        "handoffs": {},
    }
    sessions = {"sources": {"sessions": {"ok": True}}, "fields": {}, "notes": [], "handoffs": {"branches": list(branches)}}
    slack = {
        "sources": {"slack": {"ok": True}},
        "fields": {"slack_asks": [], "slack_discussions": []},
        "notes": [],
        "handoffs": {"pr_links": list(pings)},
    }
    for name, value in (("github", github), ("sessions", sessions), ("slack", slack)):
        (scratch / "parts" / f"{name}.json").write_text(json.dumps(value))
    return tmp, scratch


def ping(p):
    return {"url": "https://example.slack.com/p1", "pr": {"repo": p["repo"], "number": p["number"]}, "from_email": "x@taxwire.com", "to_me": True, "when": "2026-10-19T10:00:00Z", "line": "Asked you."}


def reviews_part(scratch):
    return json.loads((scratch / "parts" / "reviews.json").read_text())["handoffs"]


class QueueTest(unittest.TestCase):
    def test_candidates_in_order(self):
        a, b, c = pr(1, waiting="2026-10-10T00:00:00Z", size=100), pr(2, waiting="2026-10-01T00:00:00Z", size=50), pr(3, waiting="2026-10-10T00:00:00Z", size=5)
        d, e, f, g = pr(4, waiting="2026-10-05T00:00:00Z"), pr(5, waiting="2026-10-01T00:00:00Z", draft=True), pr(6, waiting="2026-09-01T00:00:00Z", draft=True), pr(7, waiting="2026-10-02T00:00:00Z")
        team = pr(8)
        branches = [{"repo": "taxwire/api", "branch": e["head_ref"], "finished": True}, {"repo": "taxwire/api", "branch": f["head_ref"], "finished": False}]
        tmp, scratch = scratch_with([c, b, a], [d, e, f, g], [team], branches, [ping(a)])
        with tmp:
            order = [cand["number"] for cand in review_queue.candidates(scratch)]
        self.assertEqual(order, [1, 2, 3, 5, 7, 4])

    def test_existing_reviews_are_dropped_and_recorded(self):
        a, b = pr(1), pr(2, waiting="2026-10-11T00:00:00Z")
        tmp, scratch = scratch_with([a, b])
        with tmp:
            (scratch / "existing" / "reviews").mkdir(parents=True)
            (scratch / "existing" / "reviews" / f"{rid(a)}.json").write_text("{}")
            result = review_queue.pick(scratch, existing=review_queue.existing_ids(scratch / "existing"), limit=8)
            self.assertEqual([r["id"] for r in result["run"]], [rid(b)])
            self.assertEqual(result["run"][0]["clone"], "https://github.com/taxwire/api.git")
            self.assertEqual(reviews_part(scratch)["review_ids"], {"taxwire/api#1": rid(a)})

    def test_past_the_limit_is_queued(self):
        prs = [pr(n, waiting=f"2026-10-{n:02d}T00:00:00Z") for n in range(1, 7)]
        tmp, scratch = scratch_with(prs)
        with tmp:
            result = review_queue.pick(scratch, existing={rid(prs[0])}, limit=2)
            self.assertEqual([r["number"] for r in result["run"]], [2, 3])
            self.assertEqual(result["queued"], 3)
            self.assertEqual(reviews_part(scratch)["queued"], 3)

    def test_pick_cli_reads_the_saved_reviews(self):
        a, b = pr(1), pr(2, waiting="2026-10-11T00:00:00Z")
        tmp, scratch = scratch_with([a, b])
        with tmp:
            (scratch / "existing" / "reviews").mkdir(parents=True)
            (scratch / "existing" / "reviews" / f"{rid(a)}.json").write_text("{}")
            out = subprocess.run(
                [sys.executable, str(SCRIPTS / "review_queue.py"), "pick", "--scratch", str(scratch), "--existing-dir", str(scratch / "existing")],
                capture_output=True, text=True, check=True,
            )
        self.assertEqual([r["id"] for r in json.loads(out.stdout)["run"]], [rid(b)])

    def test_malformed_prs_and_hand_offs_never_crash_the_queue(self):
        good = pr(1)
        bad = [
            pr(2) | {"waiting_since": None},
            pr(3) | {"additions": None},
            pr(4) | {"repo": "example-api"},
            pr(5) | {"head_sha": None},
            pr(6) | {"head_sha": "abc"},
            pr(7) | {"number": "7"},
            "not a PR",
        ]
        pings = [{"url": "u1", "pr": None, "to_me": True}, {"url": "u2", "pr": {"repo": "x"}, "to_me": True}]
        branches = [{"branch": "b", "finished": True}, "b"]
        tmp, scratch = scratch_with([good, *bad], [None], [], branches, pings)
        with tmp:
            numbers = [c["number"] for c in review_queue.candidates(scratch)]
        self.assertEqual(sorted(numbers), [1, 2, 3, 7])

    def test_the_clone_url_is_always_githubs(self):
        tmp, scratch = scratch_with([pr(1) | {"repo": "taxwire/api"}])
        with tmp:
            (cand,) = review_queue.candidates(scratch)
        self.assertEqual(cand["clone"], "https://github.com/taxwire/api.git")

    def test_a_branch_name_that_could_be_an_option_skips_the_review(self):
        tmp, scratch = scratch_with([pr(1) | {"head_ref": "--upload-pack=touch /tmp/x"}, pr(2)])
        with tmp:
            result = review_queue.pick(scratch, existing=set(), limit=8)
            self.assertEqual([r["number"] for r in result["run"]], [2])
            notes = json.loads((scratch / "parts" / "reviews.json").read_text())["notes"]
        self.assertTrue(any("taxwire/api#1" in note for note in notes), notes)

    def test_ids_cli_prints_one_id_per_line(self):
        a = pr(1)
        tmp, scratch = scratch_with([a])
        with tmp:
            out = subprocess.run([sys.executable, str(SCRIPTS / "review_queue.py"), "ids", "--scratch", str(scratch)], capture_output=True, text=True, check=True)
        self.assertEqual(out.stdout.split(), [rid(a)])


SUMMARY = """# Code Review — taxwire/api `b` @ 1

## Summary
- Base: `main`
- Totals: Critical 1, High 2, Medium 0, Low 3 (Total 6)
- Verdict: needs-work

## Issues
"""
ID = "taxwire:api:7:" + "7" * 40


def write_review(text):
    tmp = tempfile.TemporaryDirectory()
    scratch = Path(tmp.name)
    (scratch / "parts").mkdir()
    (scratch / "review.md").write_bytes(text.encode())
    return tmp, scratch


def run_doc(scratch):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "review_doc.py"), "--scratch", str(scratch), "--markdown", str(scratch / "review.md"), "--id", ID, "--reviewed-at", "2026-10-20T07:00:00Z"],
        capture_output=True,
        text=True,
    )


class ReviewDocTest(unittest.TestCase):
    def test_the_template_summary_parses(self):
        self.assertEqual(review_doc.parse_summary(SUMMARY), ({"critical": 1, "high": 2, "medium": 0, "low": 3}, "needs-work"))

    def test_capitals_and_spaces_parse(self):
        text = SUMMARY.replace("- Totals: Critical 1, High 2", "-  Totals:  CRITICAL 1,  high  2").replace("- Verdict: needs-work", "- Verdict:  Needs-Work")
        self.assertEqual(review_doc.parse_summary(text), ({"critical": 1, "high": 2, "medium": 0, "low": 3}, "needs-work"))

    def test_summary_variations_parse(self):
        variations = [
            "- **Totals:** Critical 1, High 2, Medium 0, Low 3\n- **Verdict:** needs-work",
            "* Totals: Critical 1, High 2, Medium 0, Low 3\n* Verdict: needs-work",
            "- Totals: Critical: 1, High: 2, Medium: 0, Low: 3\n- Verdict: needs-work",
            "- Totals: Critical 1, High 2, Medium 0, Low 3\n- Verdict: `needs-work`",
        ]
        for text in variations:
            with self.subTest(text):
                self.assertEqual(review_doc.parse_summary(text), ({"critical": 1, "high": 2, "medium": 0, "low": 3}, "needs-work"))

    def test_an_id_without_a_full_sha_is_refused(self):
        for bad in ("taxwire:api:7:None", "taxwire:api:7:abc", "taxwire:api:7", "taxwire:api:x:" + "7" * 40):
            with self.subTest(bad):
                with self.assertRaises(ValueError):
                    review_doc.parse_id(bad)

    def test_no_totals_line_is_rejected_and_writes_nothing(self):
        tmp, scratch = write_review(SUMMARY.replace("- Totals: Critical 1, High 2, Medium 0, Low 3 (Total 6)\n", ""))
        with tmp:
            result = run_doc(scratch)
            self.assertEqual(result.returncode, 1)
            self.assertIn("no Totals line", result.stderr)
            self.assertFalse((scratch / "reviews").exists() and any((scratch / "reviews").iterdir()))

    def test_the_document_matches_the_contract_and_keeps_the_markdown_byte_for_byte(self):
        text = SUMMARY + "| ID | Sev |\n|---|---|\n| SEC-1 | High | `a.py:1` — “quoted” — é\n"
        tmp, scratch = write_review(text)
        with tmp:
            result = run_doc(scratch)
            self.assertEqual(result.returncode, 0, result.stderr)
            doc = json.loads((scratch / "reviews" / f"{ID}.json").read_text())
            self.assertEqual(doc["markdown"], text)
            self.assertEqual(
                {k: v for k, v in doc.items() if k != "markdown"},
                {"repo": "taxwire/api", "number": 7, "head_sha": "7" * 40, "reviewed_at": "2026-10-20T07:00:00Z", "verdict": "needs-work", "counts": {"critical": 1, "high": 2, "medium": 0, "low": 3}},
            )
            self.assertEqual(reviews_part(scratch)["review_ids"], {"taxwire/api#7": ID})


def script_around(prompt):
    return f"#!/usr/bin/env bash\nset -u\nprompt=$(cat <<'PROMPT_EOF'\n{prompt}\nPROMPT_EOF\n)\necho done\n"


class ReviewPromptTest(unittest.TestCase):
    def choose(self, script_text):
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            (scratch / "parts").mkdir()
            script = scratch / "pr-review.sh"
            if script_text is not None:
                script.write_text(script_text)
            review_prompt.choose(scratch, script if script_text is not None else None, COPY)
            return (scratch / "review-prompt.md").read_text(), reviews_part(scratch)["prompt"]

    def test_the_live_prompt_is_used_when_it_still_fits(self):
        live = COPY.read_text().strip().replace("Focus on technical debt", "Focus first on technical debt")
        text, prompt = self.choose(script_around(live))
        self.assertEqual(prompt, "live")
        self.assertEqual(text.strip(), live)

    def test_a_live_prompt_without_the_summary_lines_falls_back(self):
        live = "\n".join(line for line in COPY.read_text().splitlines() if not line.startswith("- Verdict:"))
        text, prompt = self.choose(script_around(live))
        self.assertEqual(prompt, "copy: no Verdict line")
        self.assertEqual(text, COPY.read_text())

    def test_a_live_prompt_missing_a_placeholder_falls_back(self):
        live = COPY.read_text().replace("@@BASE_BRANCH@@", "main")
        _, prompt = self.choose(script_around(live))
        self.assertEqual(prompt, "copy: no @@BASE_BRANCH@@")

    def test_a_missing_script_falls_back(self):
        _, prompt = self.choose(None)
        self.assertEqual(prompt, "copy: pr-review.sh couldn't be read")

    def test_a_script_without_the_prompt_falls_back(self):
        _, prompt = self.choose("#!/bin/bash\necho hi\n")
        self.assertEqual(prompt, "copy: no prompt in pr-review.sh")

    def test_the_copy_matches_pr_review_today(self):
        skills = REPO.parent / "taxwire-skills"
        shown = subprocess.run(["git", "-C", str(skills), "show", f"origin/main:{PR_REVIEW_SH}"], capture_output=True, text=True)
        if shown.returncode != 0:
            self.skipTest("taxwire-skills isn't checked out next to this repository")
        self.assertEqual(review_prompt.extract_review_prompt(shown.stdout).strip(), COPY.read_text().strip())


if __name__ == "__main__":
    unittest.main()
