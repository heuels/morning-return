import importlib.util
import unittest
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
SKILL_DIR = PLUGIN_DIR / "skills" / "morning-routine"
PR_REVIEW_SH = PLUGIN_DIR.parent / "pr-review" / "skills" / "pr-review" / "pr-review.sh"

_spec = importlib.util.spec_from_file_location("assemble_prompt", SKILL_DIR / "assemble_prompt.py")
assemble_prompt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(assemble_prompt)

TEMPLATE = (
    "Page: {{ARTIFACT_URL}}\n"
    "GitHub login: {{GITHUB_LOGIN}}\n"
    "Timezone: {{TIMEZONE}}\n"
    "{{BRIEF_FORMAT}}\n"
    "{{REVIEW_PROMPT}}\n"
)
URL = "https://claude.ai/artifact/abc123"


def _assemble(template=TEMPLATE, **overrides):
    kwargs = {
        "review_prompt": "REVIEW TEXT",
        "brief_format": "FORMAT TEXT",
        "github_login": "heuels",
        "timezone": "Europe/Lisbon",
        "artifact_url": URL,
    }
    kwargs.update(overrides)
    return assemble_prompt.assemble(template, **kwargs)


class ExtractReviewPromptTest(unittest.TestCase):
    def test_extracts_real_review_prompt(self):
        prompt = assemble_prompt.extract_review_prompt(PR_REVIEW_SH.read_text())
        self.assertTrue(prompt.startswith("You are a panel of three senior engineers"))
        self.assertTrue(prompt.rstrip().endswith("- Fix: <= 2 sentences, concrete."))
        self.assertIn("@@HEAD_SHA@@", prompt)

    def test_extract_raises_without_markers(self):
        with self.assertRaises(ValueError):
            assemble_prompt.extract_review_prompt("echo hi")


class AssembleTest(unittest.TestCase):
    def test_assemble_fills_every_placeholder(self):
        out = _assemble()
        for expected in ("heuels", "Europe/Lisbon", URL, "FORMAT TEXT", "REVIEW TEXT"):
            self.assertIn(expected, out)
        self.assertNotIn("{{", out)

    def test_assemble_leaves_review_prompt_untouched(self):
        review = "x @@HEAD_SHA@@ {{NOT_OURS}}"
        self.assertIn(review, _assemble(review_prompt=review))

    def test_assemble_rejects_unknown_placeholder(self):
        with self.assertRaisesRegex(ValueError, "FOO"):
            _assemble(template=TEMPLATE + "{{FOO}}\n")

    def test_assemble_rejects_missing_placeholder(self):
        with self.assertRaisesRegex(ValueError, "REVIEW_PROMPT"):
            _assemble(template=TEMPLATE.replace("{{REVIEW_PROMPT}}", ""))

    def test_assemble_rejects_foreign_artifact_url(self):
        with self.assertRaises(ValueError):
            _assemble(artifact_url="https://evil.example/artifact/x")

    def test_real_templates_assemble(self):
        out = assemble_prompt.assemble(
            (SKILL_DIR / "run.md").read_text(),
            review_prompt=assemble_prompt.extract_review_prompt(PR_REVIEW_SH.read_text()),
            brief_format=(SKILL_DIR / "brief-format.md").read_text(),
            github_login="heuels",
            timezone="Europe/Lisbon",
            artifact_url=URL,
        )
        self.assertIn("heuels", out)
        self.assertIn("You are a panel of three senior engineers", out)
        self.assertNotIn("{{", out)
        self.assertLess(len(out.encode()), 60_000)


if __name__ == "__main__":
    unittest.main()
