#!/usr/bin/env python3
"""Focused Python-3.9 integration tests for release workflow validation."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT
if not (SOURCE_ROOT / "app/package.json").is_file():
    private_root = ROOT.parents[2] if len(ROOT.parents) >= 3 else ROOT
    if (
        ROOT.name == "files"
        and ROOT.parent.name == "public-export"
        and (private_root / "app/package.json").is_file()
    ):
        SOURCE_ROOT = private_root
VALIDATOR = ROOT / "scripts/verify-ha-app.py"
WORKFLOW = Path(".github/workflows/quality-and-release.yml")

PUBLIC_FIXTURE_PATHS = (
    Path("repository.yaml"),
    Path("hauser/config.yaml"),
    Path("hauser/README.md"),
    Path("hauser/DOCS.md"),
    Path("hauser/CHANGELOG.md"),
    Path("hauser/icon.png"),
    Path("hauser/logo.png"),
    Path("Dockerfile"),
    Path("compose.yaml"),
    Path("container/healthcheck.mjs"),
    Path("container/start.mjs"),
    WORKFLOW,
    Path("README.md"),
    Path("TRADEMARKS.md"),
    Path("scripts/verify-license-boundary.sh"),
    Path("CHANGELOG.md"),
)
SOURCE_FIXTURE_PATHS = (Path("app/package.json"), Path("app/package-lock.json"))
TAG_BY_VERSION = "${{ steps.image.outputs.repository }}:${{ steps.image.outputs.version }}"
TEST_VALIDATOR_COMMAND = "python3 scripts/test-verify-ha-app-workflow.py"
APP_VALIDATOR_COMMAND = "python3 scripts/verify-ha-app.py"
PINNED_ADDON_LINTER = (
    "frenck/action-addon-linter@f995494fd84fae6310d23617e66d0e37de4f14eb"
)


def replace_once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise AssertionError(f"expected exactly one fixture occurrence of {old!r}")
    return text.replace(old, new, 1)


class ReleaseWorkflowValidationTests(unittest.TestCase):
    maxDiff = None

    def run_fixture(
        self, mutate_workflow: Callable[[str], str] | None = None
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="hauser-workflow-validator-") as temporary:
            fixture = Path(temporary)
            for relative in PUBLIC_FIXTURE_PATHS:
                destination = fixture / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, destination)
            for relative in SOURCE_FIXTURE_PATHS:
                destination = fixture / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(SOURCE_ROOT / relative, destination)

            if mutate_workflow is not None:
                workflow_path = fixture / WORKFLOW
                workflow_path.write_text(
                    mutate_workflow(workflow_path.read_text(encoding="utf-8")),
                    encoding="utf-8",
                )

            return subprocess.run(
                [sys.executable, str(VALIDATOR), "--root", str(fixture)],
                check=False,
                capture_output=True,
                text=True,
            )

    def assert_rejected(self, result: subprocess.CompletedProcess[str]) -> None:
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn("ha_app_contract=FAIL", output)
        self.assertNotIn("image_tags=", output)

    def test_real_workflow_passes(self) -> None:
        result = self.run_fixture()
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("ha_app_contract=PASS", output)
        self.assertIn("image_tags=0.4.0-beta.3,v0.4.0-beta.3", output)

    def test_second_tag_only_in_comment_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            return replace_once(
                workflow,
                f"            {TAG_BY_VERSION}\n",
                f"            # {TAG_BY_VERSION}\n",
            )

        self.assert_rejected(self.run_fixture(mutate))

    def test_second_tag_in_another_step_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            workflow = replace_once(workflow, f"            {TAG_BY_VERSION}\n", "")
            return replace_once(
                workflow,
                '        run: ./scripts/verify-release-metadata.sh "$GITHUB_REF_NAME"\n',
                '        run: ./scripts/verify-release-metadata.sh "$GITHUB_REF_NAME"\n'
                "        env:\n"
                f"          UNUSED_SECOND_TAG: {TAG_BY_VERSION}\n",
            )

        self.assert_rejected(self.run_fixture(mutate))

    def test_push_false_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            return replace_once(workflow, "          push: true\n", "          push: false\n")

        self.assert_rejected(self.run_fixture(mutate))

    def test_build_step_if_false_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            uses = (
                "        uses: docker/build-push-action@"
                "10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6\n"
            )
            return replace_once(workflow, uses, f"{uses}        if: false\n")

        self.assert_rejected(self.run_fixture(mutate))

    def test_build_step_continue_on_error_true_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            uses = (
                "        uses: docker/build-push-action@"
                "10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6\n"
            )
            return replace_once(
                workflow, uses, f"{uses}        continue-on-error: true\n"
            )

        self.assert_rejected(self.run_fixture(mutate))

    def test_quality_job_continue_on_error_true_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            return replace_once(
                workflow, "  quality:\n", "  quality:\n    continue-on-error: true\n"
            )

        self.assert_rejected(self.run_fixture(mutate))

    def test_release_job_continue_on_error_true_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            return replace_once(
                workflow,
                "  release-image:\n",
                "  release-image:\n    continue-on-error: true\n",
            )

        self.assert_rejected(self.run_fixture(mutate))

    def test_workflow_validator_step_if_false_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            command = f"        run: {TEST_VALIDATOR_COMMAND}\n"
            return replace_once(workflow, command, f"{command}        if: false\n")

        self.assert_rejected(self.run_fixture(mutate))

    def test_app_validator_step_continue_on_error_true_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            command = f"        run: {APP_VALIDATOR_COMMAND}\n"
            return replace_once(
                workflow, command, f"{command}        continue-on-error: true\n"
            )

        self.assert_rejected(self.run_fixture(mutate))

    def test_floating_linter_with_old_pin_only_in_comment_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            pinned = f"        uses: {PINNED_ADDON_LINTER} # v2.21\n"
            floating = (
                "        uses: frenck/action-addon-linter@v2\n"
                f"        # previous pin: {PINNED_ADDON_LINTER}\n"
            )
            return replace_once(workflow, pinned, floating)

        self.assert_rejected(self.run_fixture(mutate))

    def test_required_test_command_only_in_other_step_env_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            workflow = replace_once(
                workflow,
                f"        run: {TEST_VALIDATOR_COMMAND}\n",
                "        run: echo workflow-validator-test-skipped\n",
            )
            return replace_once(
                workflow,
                "        run: npm ci\n",
                "        run: npm ci\n"
                "        env:\n"
                f"          FALSE_GREEN_COMMAND: {TEST_VALIDATOR_COMMAND}\n",
            )

        self.assert_rejected(self.run_fixture(mutate))

    def test_required_app_validator_command_only_in_comment_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            return replace_once(
                workflow,
                f"        run: {APP_VALIDATOR_COMMAND}\n",
                f"        # {APP_VALIDATOR_COMMAND}\n"
                "        run: echo app-validator-skipped\n",
            )

        self.assert_rejected(self.run_fixture(mutate))

    def test_required_validator_steps_in_wrong_order_are_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            ordered = (
                "      - name: Test Home Assistant App workflow validator\n"
                f"        run: {TEST_VALIDATOR_COMMAND}\n\n"
                "      - name: Verify Home Assistant App contract\n"
                f"        run: {APP_VALIDATOR_COMMAND}\n"
            )
            reversed_commands = (
                "      - name: Test Home Assistant App workflow validator\n"
                f"        run: {APP_VALIDATOR_COMMAND}\n\n"
                "      - name: Verify Home Assistant App contract\n"
                f"        run: {TEST_VALIDATOR_COMMAND}\n"
            )
            return replace_once(workflow, ordered, reversed_commands)

        self.assert_rejected(self.run_fixture(mutate))

    def test_required_test_step_duplicate_run_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            command = f"        run: {TEST_VALIDATOR_COMMAND}\n"
            return replace_once(workflow, command, f"{command}{command}")

        self.assert_rejected(self.run_fixture(mutate))

    def test_linter_step_duplicate_uses_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            uses = f"        uses: {PINNED_ADDON_LINTER} # v2.21\n"
            return replace_once(workflow, uses, f"{uses}{uses}")

        self.assert_rejected(self.run_fixture(mutate))

    def test_linter_step_duplicate_continue_on_error_is_rejected(self) -> None:
        def mutate(workflow: str) -> str:
            uses = f"        uses: {PINNED_ADDON_LINTER} # v2.21\n"
            controls = (
                "        continue-on-error: false\n"
                "        continue-on-error: false\n"
            )
            return replace_once(workflow, uses, f"{uses}{controls}")

        self.assert_rejected(self.run_fixture(mutate))


if __name__ == "__main__":
    unittest.main(verbosity=2)
