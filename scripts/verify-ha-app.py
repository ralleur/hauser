#!/usr/bin/env python3
"""Validate the thin Home Assistant App packaging contract without dependencies.

By default the package root is derived from this script's location. ``--root``
accepts either an exported public repository or the canonical private
``tools/public-export/files`` overlay. In overlay mode, package-version metadata
is read from the private repository root while all public packaging files remain
validated in the overlay.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path
from typing import NoReturn

DEFAULT_ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help="exported package root or private tools/public-export/files overlay",
    )
    return parser.parse_args()


ROOT = parse_args().root.expanduser().resolve()
APP_DIR = ROOT / "hauser"
SOURCE_ROOT = ROOT
if not (SOURCE_ROOT / "app/package.json").is_file():
    private_root = ROOT.parents[2] if len(ROOT.parents) >= 3 else ROOT
    if ROOT.name == "files" and ROOT.parent.name == "public-export" and (private_root / "app/package.json").is_file():
        SOURCE_ROOT = private_root
VERSION = "0.4.0-beta.2"
IMAGE = "ghcr.io/ralleur/hauser"
ONE_CLICK = (
    "https://my.home-assistant.io/redirect/supervisor_add_addon_repository/"
    "?repository_url=https%3A%2F%2Fgithub.com%2Fralleur%2Fhauser"
)
BAD_PERMISSION_KEYS = {
    "apparmor", "audio", "devices", "docker_api", "full_access", "gpio", "hassio_api",
    "homeassistant_api", "host_dbus", "host_ipc", "host_network", "host_pid", "ingress",
    "kernel_modules", "map", "privileged", "serial", "uart", "udev",
}
REQUIRED_ENV = {
    "HMI_AI_CUSTOMIZING_ENABLED": "0",
    "HMI_HOUSEHOLD_CONFIG_PATH": "/data/household.json",
    "HMI_HOUSEHOLD_CONFIG_MODE": "active",
    "HMI_CONFIG_PATH": "/data/config.json",
    "HMI_FAMILY_DATA_PATH": "/data/family-data.json",
    "HMI_SONG_LIBRARY_DIR": "/data/songs",
    "HMI_REQUIRED_WRITABLE_DIRS": "/data,/data/songs",
}
PINNED_BUILD_PUSH_ACTION = (
    "docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8"
)
TAG_BY_RELEASE_REF = "${{ steps.image.outputs.repository }}:${{ github.ref_name }}"
TAG_BY_PACKAGE_VERSION = (
    "${{ steps.image.outputs.repository }}:${{ steps.image.outputs.version }}"
)
TAG_RELEASE_CONDITION = "startsWith(github.ref, 'refs/tags/v')"
WORKFLOW_VALIDATOR_COMMAND = "python3 scripts/test-verify-ha-app-workflow.py"
APP_VALIDATOR_COMMAND = "python3 scripts/verify-ha-app.py"
ADDON_LINTER_PREFIX = "frenck/action-addon-linter@"
PINNED_ADDON_LINTER = (
    "frenck/action-addon-linter@f995494fd84fae6310d23617e66d0e37de4f14eb"
)


def fail(message: str) -> NoReturn:
    raise SystemExit(f"ha_app_contract=FAIL\nreason={message}")


def strip_yaml_comment(value: str) -> str:
    """Remove an unquoted YAML comment from one physical line."""
    in_single = False
    in_double = False
    escaped = False
    for index, character in enumerate(value):
        if in_double and character == "\\" and not escaped:
            escaped = True
            continue
        if character == '"' and not in_single and not escaped:
            in_double = not in_double
        elif character == "'" and not in_double:
            in_single = not in_single
        elif (
            character == "#"
            and not in_single
            and not in_double
            and (index == 0 or value[index - 1].isspace())
        ):
            return value[:index].rstrip()
        escaped = False
    return value.rstrip()


def active_yaml_lines(text: str) -> list[tuple[int, int, str]]:
    """Return non-comment YAML lines as (line number, indentation, content)."""
    active = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        indentation = len(raw_line) - len(raw_line.lstrip(" "))
        if raw_line[indentation:].startswith("\t"):
            fail(f"quality/release workflow uses tab indentation on line {line_number}")
        content = strip_yaml_comment(raw_line[indentation:])
        if content:
            active.append((line_number, indentation, content))
    return active


def mapping_value(content: str, key: str) -> str | None:
    match = re.fullmatch(rf"{re.escape(key)}:\s*(.*)", content)
    return match.group(1).strip() if match else None


def block_end(
    lines: list[tuple[int, int, str]], start: int, indentation: int
) -> int:
    end = start + 1
    while end < len(lines) and lines[end][1] > indentation:
        end += 1
    return end


def unique_direct_value(
    lines: list[tuple[int, int, str]],
    start: int,
    end: int,
    indentation: int,
    key: str,
    owner: str,
) -> tuple[int, str]:
    matches = [
        (index, mapping_value(content, key))
        for index, (_, line_indent, content) in enumerate(lines[start:end], start=start)
        if line_indent == indentation and mapping_value(content, key) is not None
    ]
    if len(matches) != 1:
        fail(f"{owner} must contain exactly one active direct {key!r} key")
    index, value = matches[0]
    assert value is not None
    return index, value


def direct_values(
    lines: list[tuple[int, int, str]],
    start: int,
    end: int,
    indentation: int,
    key: str,
) -> list[str]:
    return [
        value
        for _, line_indent, content in lines[start:end]
        if line_indent == indentation
        for value in [mapping_value(content, key)]
        if value is not None
    ]


def sequence_step_values(
    lines: list[tuple[int, int, str]],
    start: int,
    end: int,
    indentation: int,
    key: str,
) -> list[str]:
    """Return direct values, including a key on the sequence item's first line."""
    values = []
    first_content = lines[start][2]
    if lines[start][1] == indentation and first_content.startswith("- "):
        first_value = mapping_value(first_content[2:].strip(), key)
        if first_value is not None:
            values.append(first_value)
    values.extend(direct_values(lines, start + 1, end, indentation + 2, key))
    return values


def unique_job_block(
    lines: list[tuple[int, int, str]],
    jobs_index: int,
    jobs_end: int,
    name: str,
) -> tuple[int, int]:
    matches = [
        index
        for index in range(jobs_index + 1, jobs_end)
        if lines[index][1] == 2 and mapping_value(lines[index][2], name) == ""
    ]
    if len(matches) != 1:
        fail(f"jobs must contain exactly one active {name} job")
    start = matches[0]
    return start, block_end(lines, start, 2)


def direct_steps(
    lines: list[tuple[int, int, str]],
    job_start: int,
    job_end: int,
    owner: str,
) -> list[tuple[int, int]]:
    steps_index, steps_value = unique_direct_value(
        lines, job_start + 1, job_end, 4, "steps", owner
    )
    if steps_value:
        fail(f"{owner} steps must be an indented sequence")
    steps_end = block_end(lines, steps_index, 4)
    starts = [
        index
        for index in range(steps_index + 1, steps_end)
        if lines[index][1] == 6 and lines[index][2].startswith("- ")
    ]
    if not starts:
        fail(f"{owner} must contain active steps")
    return [
        (start, starts[position + 1] if position + 1 < len(starts) else steps_end)
        for position, start in enumerate(starts)
    ]


def validate_continue_on_error(values: list[str], owner: str) -> None:
    if values not in ([], ["false"]):
        fail(f"{owner} continue-on-error must be absent or literal false")


def validate_required_step_controls(
    lines: list[tuple[int, int, str]], start: int, end: int, owner: str
) -> None:
    if sequence_step_values(lines, start, end, 6, "if"):
        fail(f"{owner} must not contain a direct 'if' key")
    validate_continue_on_error(
        sequence_step_values(lines, start, end, 6, "continue-on-error"), owner
    )


def validate_quality_job(
    lines: list[tuple[int, int, str]], quality_index: int, quality_end: int
) -> None:
    """Prove the three required, unconditional direct quality steps."""
    steps = direct_steps(lines, quality_index, quality_end, "quality job")
    inventory = []
    for start, end in steps:
        run_values = sequence_step_values(lines, start, end, 6, "run")
        uses_values = sequence_step_values(lines, start, end, 6, "uses")
        if len(run_values) > 1:
            fail("a quality step contains duplicate active direct run keys")
        if len(uses_values) > 1:
            fail("a quality step contains duplicate active direct uses keys")
        inventory.append((start, end, run_values, uses_values))

    required_runs = {}
    for command in (WORKFLOW_VALIDATOR_COMMAND, APP_VALIDATOR_COMMAND):
        matches = [item for item in inventory if item[2] == [command]]
        if len(matches) != 1:
            fail(f"quality job must contain exactly one direct run step for {command!r}")
        required_runs[command] = matches[0]

    if required_runs[WORKFLOW_VALIDATOR_COMMAND][0] >= required_runs[APP_VALIDATOR_COMMAND][0]:
        fail("quality workflow-validator test step must run before the App validator step")

    linter_steps = [
        item
        for item in inventory
        if item[3] and item[3][0].startswith(ADDON_LINTER_PREFIX)
    ]
    if len(linter_steps) != 1:
        fail("quality job must contain exactly one active addon-linter step")
    if linter_steps[0][3] != [PINNED_ADDON_LINTER]:
        fail("quality addon-linter step is not pinned to the approved commit")

    for owner, item in (
        ("workflow-validator test step", required_runs[WORKFLOW_VALIDATOR_COMMAND]),
        ("App validator step", required_runs[APP_VALIDATOR_COMMAND]),
        ("addon-linter step", linter_steps[0]),
    ):
        validate_required_step_controls(lines, item[0], item[1], owner)


def validate_release_workflow(workflow: str) -> str:
    """Structurally prove the tag-gated, dual-tag release-image contract."""
    lines = active_yaml_lines(workflow)
    jobs_matches = [
        index
        for index, (_, indentation, content) in enumerate(lines)
        if indentation == 0 and mapping_value(content, "jobs") == ""
    ]
    if len(jobs_matches) != 1:
        fail("quality/release workflow must contain exactly one active top-level jobs block")
    jobs_index = jobs_matches[0]
    jobs_end = block_end(lines, jobs_index, 0)

    quality_index, quality_end = unique_job_block(
        lines, jobs_index, jobs_end, "quality"
    )
    release_index, release_end = unique_job_block(
        lines, jobs_index, jobs_end, "release-image"
    )
    validate_continue_on_error(
        direct_values(lines, quality_index + 1, quality_end, 4, "continue-on-error"),
        "quality job",
    )
    validate_continue_on_error(
        direct_values(lines, release_index + 1, release_end, 4, "continue-on-error"),
        "release-image job",
    )
    validate_quality_job(lines, quality_index, quality_end)

    _, condition = unique_direct_value(
        lines, release_index + 1, release_end, 4, "if", "release-image job"
    )
    if condition != TAG_RELEASE_CONDITION:
        fail("release-image job must be gated directly by refs/tags/v")
    _, needs = unique_direct_value(
        lines, release_index + 1, release_end, 4, "needs", "release-image job"
    )
    if needs != "quality":
        fail("release-image job needs must be exactly quality")

    build_steps = []
    build_action_steps = []
    for step_start, step_end in direct_steps(
        lines, release_index, release_end, "release-image job"
    ):
        uses_values = sequence_step_values(lines, step_start, step_end, 6, "uses")
        if len(uses_values) > 1:
            fail("a release-image step contains duplicate active uses keys")
        if uses_values and uses_values[0].startswith("docker/build-push-action@"):
            build_action_steps.append((step_start, step_end, uses_values[0]))
        if uses_values == [PINNED_BUILD_PUSH_ACTION]:
            build_steps.append((step_start, step_end))

    if len(build_action_steps) != 1 or len(build_steps) != 1:
        fail("release-image must contain exactly one pinned docker/build-push-action step")
    if build_action_steps[0][2] != PINNED_BUILD_PUSH_ACTION:
        fail("release-image docker/build-push-action step is not pinned to the approved commit")

    build_start, build_end = build_steps[0]
    validate_required_step_controls(
        lines, build_start, build_end, "pinned build-push step"
    )

    with_index, with_value = unique_direct_value(
        lines, build_start + 1, build_end, 8, "with", "pinned build-push step"
    )
    if with_value:
        fail("pinned build-push step with must be an indented mapping")
    with_end = block_end(lines, with_index, 8)

    _, push = unique_direct_value(
        lines, with_index + 1, with_end, 10, "push", "pinned build-push step with"
    )
    if push != "true":
        fail("pinned build-push step must set push: true in its own with block")

    tags_index, tags_style = unique_direct_value(
        lines, with_index + 1, with_end, 10, "tags", "pinned build-push step with"
    )
    if tags_style != "|":
        fail("pinned build-push step must use an active tags: | block")
    tags_end = block_end(lines, tags_index, 10)
    tag_entries = [
        content.strip()
        for _, indentation, content in lines[tags_index + 1 : tags_end]
        if indentation > 10
    ]
    for required_tag in (TAG_BY_RELEASE_REF, TAG_BY_PACKAGE_VERSION):
        if tag_entries.count(required_tag) != 1:
            fail(
                "pinned build-push step tags block must contain exactly one active "
                f"entry {required_tag!r}"
            )

    return f"{VERSION},v{VERSION}"


def load_yaml_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"{path.relative_to(ROOT)} must be valid JSON-compatible YAML: {error}")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain an object")
    return value


def png_size(path: Path) -> tuple[int, int]:
    try:
        data = path.read_bytes()
    except OSError as error:
        fail(f"cannot read {path.relative_to(ROOT)}: {error}")
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        fail(f"{path.relative_to(ROOT)} is not a valid PNG")
    return struct.unpack(">II", data[16:24])


required_files = [
    ROOT / "repository.yaml",
    APP_DIR / "config.yaml",
    APP_DIR / "README.md",
    APP_DIR / "DOCS.md",
    APP_DIR / "CHANGELOG.md",
    APP_DIR / "icon.png",
    APP_DIR / "logo.png",
]
missing = [str(path.relative_to(ROOT)) for path in required_files if not path.is_file() or path.stat().st_size == 0]
if missing:
    fail(f"missing required files: {', '.join(missing)}")

repository = load_yaml_json(ROOT / "repository.yaml")
if repository != {
    "name": "Hauser Home Assistant App Repository",
    "url": "https://github.com/ralleur/hauser",
    "maintainer": "ralleur",
}:
    fail("repository.yaml metadata does not match the public repository contract")

config = load_yaml_json(APP_DIR / "config.yaml")
expected_scalars = {
    "name": "Hauser",
    "slug": "hauser",
    "version": VERSION,
    "image": IMAGE,
    "stage": "experimental",
    "backup": "cold",
    "webui": "http://[HOST]:[PORT:4173]",
    "legacy": True,
    "init": False,
}
for key, expected in expected_scalars.items():
    if config.get(key) != expected:
        fail(f"hauser/config.yaml {key!r} must be {expected!r}")
if config.get("arch") != ["aarch64", "amd64"]:
    fail("architectures must be exactly aarch64 and amd64")
if config.get("ports") != {"4173/tcp": 4173}:
    fail("port 4173/tcp must be exposed as the direct App port")
if "watchdog" in config:
    fail("hauser/config.yaml must not contain obsolete watchdog metadata; use the OCI healthcheck")
if config.get("environment") != REQUIRED_ENV:
    fail("environment does not map every Hauser write path to /data")
for key, value in config["environment"].items():
    if key.endswith(("_PATH", "_DIR")) and not value.startswith("/data/"):
        fail(f"{key} escapes /data")
if any(path != "/data" and not path.startswith("/data/") for path in config["environment"]["HMI_REQUIRED_WRITABLE_DIRS"].split(",")):
    fail("HMI_REQUIRED_WRITABLE_DIRS escapes /data")
for key in sorted(BAD_PERMISSION_KEYS):
    if key in config:
        fail(f"unnecessary permission or integration key present: {key}")

package = json.loads((SOURCE_ROOT / "app/package.json").read_text(encoding="utf-8"))
lock = json.loads((SOURCE_ROOT / "app/package-lock.json").read_text(encoding="utf-8"))
versions = [package.get("version"), lock.get("version"), lock.get("packages", {}).get("", {}).get("version")]
if versions != [VERSION, VERSION, VERSION]:
    fail(f"App/package version chain differs: {versions}")
dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
if f"ARG HAUSER_VERSION={VERSION}" not in dockerfile:
    fail("Dockerfile version differs from App version")
if 'HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3' not in dockerfile \
        or 'CMD ["node", "container/healthcheck.mjs"]' not in dockerfile:
    fail("Dockerfile must retain the OCI healthcheck command")
healthcheck = (ROOT / "container/healthcheck.mjs").read_text(encoding="utf-8")
if "`http://${host}:${port}/api/health`" not in healthcheck:
    fail("OCI healthcheck must probe /api/health")

workflow = (ROOT / ".github/workflows/quality-and-release.yml").read_text(encoding="utf-8")
validated_image_tags = validate_release_workflow(workflow)

readme = (ROOT / "README.md").read_text(encoding="utf-8")
for fragment in [
    "Recommended — Home Assistant OS",
    ONE_CLICK,
    "https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg",
    "Settings → Apps → App Store → Repositories",
    "Home Assistant Container",
    "Docker/Compose",
]:
    if fragment not in readme:
        fail(f"README is missing required install text: {fragment}")

trademarks = (ROOT / "TRADEMARKS.md").read_text(encoding="utf-8")
for brand_path in ("`hauser/icon.png`", "`hauser/logo.png`"):
    if brand_path not in trademarks:
        fail(f"TRADEMARKS.md does not reserve {brand_path}")
license_verifier = (ROOT / "scripts/verify-license-boundary.sh").read_text(encoding="utf-8")
for fragment in ("Path('hauser/icon.png')", "Path('hauser/logo.png')", "Path('hauser')"):
    if fragment not in license_verifier:
        fail(f"license verifier does not scan/classify {fragment}")

icon_size = png_size(APP_DIR / "icon.png")
logo_size = png_size(APP_DIR / "logo.png")
if icon_size[0] != icon_size[1] or icon_size[0] < 128:
    fail(f"icon must be square and at least 128px, got {icon_size}")
if logo_size[0] <= logo_size[1] or min(logo_size) < 64:
    fail(f"logo must be a legible landscape PNG, got {logo_size}")

for changelog in (ROOT / "CHANGELOG.md", APP_DIR / "CHANGELOG.md"):
    changelog_text = changelog.read_text(encoding="utf-8")
    if not re.search(
        r"^## (?:\[0\.4\.0-beta\.2\]|0\.4\.0-beta\.2) - "
        r"(?:Unreleased|[0-9]{4}-[0-9]{2}-[0-9]{2})$",
        changelog_text,
        flags=re.MULTILINE,
    ):
        fail(f"{changelog.relative_to(ROOT)} lacks a valid beta.2 entry")

print("ha_app_contract=PASS")
print(f"version_chain={VERSION}")
print(f"image_tags={validated_image_tags}")
print("architectures=aarch64,amd64")
print("persistence=/data")
print("ingress=absent")
print("privileged_permissions=absent")
print(f"icon_dimensions={icon_size[0]}x{icon_size[1]}")
print(f"logo_dimensions={logo_size[0]}x{logo_size[1]}")
