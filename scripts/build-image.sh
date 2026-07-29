#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  printf '%s\n' 'Refusing to build a revision tag from a dirty working tree.' >&2
  exit 2
fi

revision="$(git rev-parse --verify HEAD)"
short_revision="${revision:0:12}"
source_date_epoch="$(git show -s --format=%ct HEAD)"
repository="${HAUSER_IMAGE_REPOSITORY:-hauser}"
tag="${1:-sha-${short_revision}}"
image="${repository}:${tag}"

output="type=image,name=${image},rewrite-timestamp=true,unpack=false"
if [[ "${HAUSER_BUILD_LOAD:-false}" == "true" ]]; then
  output="type=docker,name=${image}"
fi

docker buildx build \
  --pull=false \
  --provenance=false \
  --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
  --build-arg "HAUSER_VERSION=${tag}" \
  --label "org.opencontainers.image.revision=${revision}" \
  --output "$output" \
  .

image_id="$(docker image inspect "$image" --format '{{.Id}}')"
printf 'image=%s\nrevision=%s\nsource_date_epoch=%s\nimage_id=%s\n' \
  "$image" "$revision" "$source_date_epoch" "$image_id"
