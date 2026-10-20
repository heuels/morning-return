import copy
import importlib.util
import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RUN_DIR = REPO / ".claude" / "skills" / "morning-return-run"


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, RUN_DIR / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


contract = load_script("contract")
FORMAT = (RUN_DIR / "brief-format.md").read_text()
PARTS = (RUN_DIR / "parts.md").read_text()
FIXTURE = json.loads((REPO / "tests" / "fixtures" / "brief.json").read_text())


class BriefFieldsTest(unittest.TestCase):
    def setUp(self):
        self.fields = contract.brief_fields(FORMAT)

    def test_the_fixture_brief_meets_the_contract(self):
        self.assertEqual(contract.validate(FIXTURE, self.fields), [])

    def test_a_missing_pr_field_is_named_with_its_path(self):
        brief = copy.deepcopy(FIXTURE)
        del brief["my_prs"][1]["head_sha"]
        self.assertIn("my_prs[1]: missing head_sha", contract.validate(brief, self.fields))

    def test_an_unknown_field_is_named(self):
        brief = copy.deepcopy(FIXTURE)
        brief["my_prs"][0]["headSha"] = "x"
        self.assertIn("my_prs[0]: unknown headSha", contract.validate(brief, self.fields))

    def test_a_meeting_action_is_checked_too(self):
        brief = copy.deepcopy(FIXTURE)
        meeting = next(m for m in brief["meetings"] if m["action"])
        meeting["action"]["href"] = "x"
        index = brief["meetings"].index(meeting)
        self.assertIn(f"meetings[{index}].action: unknown href", contract.validate(brief, self.fields))

    def test_a_list_written_as_null_is_named(self):
        brief = copy.deepcopy(FIXTURE)
        brief["my_prs"] = None
        self.assertIn("my_prs: not a list", contract.validate(brief, self.fields))

    def test_a_missing_source_is_named(self):
        brief = copy.deepcopy(FIXTURE)
        del brief["sources"]["linear"]
        self.assertIn("sources: missing linear", contract.validate(brief, self.fields))

    def test_multi_name_cells_give_every_name(self):
        self.assertLessEqual({"number", "title", "url", "author"}, self.fields["PR"])
        self.assertLessEqual({"start", "end"}, self.fields["Meeting"])

    def test_sources_are_read_from_the_contract(self):
        self.assertEqual(contract.sources(FORMAT), {"github", "sessions", "slack", "gmail", "calendar", "linear"})


class OwnershipTest(unittest.TestCase):
    def setUp(self):
        self.parts = contract.ownership(PARTS)
        self.fields = contract.brief_fields(FORMAT)

    def test_every_brief_field_has_exactly_one_owner(self):
        owned = [field for part in self.parts.values() for field in part.fields]
        self.assertEqual(sorted(owned), sorted(set(owned)), "a field has two owners")
        self.assertEqual(set(owned), self.fields["brief"] - {"sources"})

    def test_every_source_has_one_owner_and_it_is_a_base_part(self):
        owners = {}
        for name, part in self.parts.items():
            for source in part.sources:
                self.assertNotIn(source, owners, f"{source} has two owners")
                owners[source] = name
                self.assertEqual(part.wave, 1, f"{name} owns {source} but isn't a base part")
        self.assertEqual(set(owners), contract.sources(FORMAT))

    def test_parts_form_a_dag_by_wave(self):
        for name, part in self.parts.items():
            for read in part.reads:
                self.assertIn(read, self.parts, f"{name} reads {read}, which isn't a part")
                self.assertIsNotNone(part.wave, name)
                self.assertLess(self.parts[read].wave, part.wave, f"{name} reads {read} from its own wave or later")

    def test_at_most_two_passes_per_source(self):
        passes = {}
        for name, part in self.parts.items():
            if part.tools:
                passes.setdefault(part.tools, []).append(name)
        for tools, names in passes.items():
            self.assertLessEqual(len(names), 2, f"{tools}: {names}")

    def test_enrichments_own_no_fields_or_sources(self):
        for name, part in self.parts.items():
            if part.reads and name != "meetings":
                self.assertEqual(part.fields, set(), name)
                self.assertEqual(part.sources, set(), name)

    def test_models_and_efforts_are_known(self):
        for name, part in self.parts.items():
            if part.model:
                self.assertIn(part.model, contract.MODELS, name)
                self.assertIn(part.effort, contract.EFFORTS, name)
        review = contract.reviewers(PARTS)
        self.assertIn(review.model, contract.MODELS)
        self.assertIn(review.effort, contract.EFFORTS)

    def test_every_pass_with_tools_has_a_model(self):
        for name, part in self.parts.items():
            if part.tools:
                self.assertTrue(part.model and part.effort, name)

    def test_every_handoff_has_a_shape(self):
        shapes = contract.handoff_shapes(PARTS)
        for name, part in self.parts.items():
            for handoff in part.handoffs:
                self.assertIn(handoff, shapes, f"{name}: {handoff} has no shape in parts.md")


if __name__ == "__main__":
    unittest.main()
