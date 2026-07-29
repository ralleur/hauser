# Release notes contract

Use this structure for every public Hauser release. Replace these instructions
with concrete facts from the final commit and workflow output before publishing;
do not guess tags, commits or image digests.

## Release identity

State all of the following and verify that they agree:

- semantic version and Git tag;
- full source commit;
- GHCR image reference by immutable manifest digest;
- supported image platforms;
- configuration schema version and included migration path.

## What changed

Summarise only user-visible additions, fixes and operational changes from
[`CHANGELOG.md`](../CHANGELOG.md). Do not repeat internal task history.

## Installation or update

Provide the exact commands for a fresh install and, from the second beta onward,
for the supported upgrade path. Require a backup before changing images. Name the
previous immutable image reference used for rollback.

## Verification evidence

Report the actual results for:

- tests, typecheck, production build and static demo build;
- container health, setup-required start, configured start and persistence after
  recreation;
- backup/restore, invalid-config fail-closed behavior and rollback;
- export/privacy gate;
- post-publish pull and smoke test of the exact manifest digest.

## Known limitations

Copy the limitations that apply from the changelog and README. Every beta must
state whether an external real-home installation has occurred; maintainer-run
clean-room evidence must never be described as external-user or real-device
coverage.

## Security and support

Link [`SECURITY.md`](../SECURITY.md), state that Hauser is a hobby project without
an SLA, and warn against direct internet exposure without an authentication and
TLS boundary.
