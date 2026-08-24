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

# AGPL section 13: the image has to tell its users where the corresponding
# source of exactly this revision lives. Forks override HAUSER_SOURCE_URL so
# they point at their own repository instead of the upstream one.
source_url="${HAUSER_SOURCE_URL:-https://github.com/ralleur/hauser/tree/${revision}}"

output="type=image,name=${image},rewrite-timestamp=true,unpack=false"
if [[ "${HAUSER_BUILD_LOAD:-false}" == "true" ]]; then
  output="type=docker,name=${image}"
fi

docker buildx build \
  --pull=false \
  --provenance=false \
  --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
  --build-arg "HAUSER_VERSION=${tag}" \
  --build-arg "HAUSER_REVISION=${revision}" \
  --build-arg "HAUSER_SOURCE_URL=${source_url}" \
  --build-arg "HAUSER_RELEASE=1" \
  --label "org.opencontainers.image.revision=${revision}" \
  --output "$output" \
  .

image_id="$(docker image inspect "$image" --format '{{.Id}}')"
printf 'image=%s\nrevision=%s\nsource_url=%s\nsource_date_epoch=%s\nimage_id=%s\n' \
  "$image" "$revision" "$source_url" "$source_date_epoch" "$image_id"
