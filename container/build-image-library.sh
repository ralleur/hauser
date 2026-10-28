#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# The npm Linux x64 binaries require SSE4.2; their Wasm fallback still needs
# SSE4.1. Build the same sharp/libvips versions for baseline x86-64 instead.
set -eu

apk add --no-cache build-base clang python3 meson ninja pkgconf curl xz \
  glib-dev expat-dev libjpeg-turbo-dev libpng-dev libwebp-dev libheif-dev \
  libheif-aom libheif-dav1d tiff-dev lcms2-dev pango-dev librsvg-dev

curl -fsSL https://github.com/libvips/libvips/releases/download/v8.18.7/vips-8.18.7.tar.xz -o /tmp/vips.tar.xz
echo '5baaead3b0bb20ffdb9e9ff09aa9fda08620923df77b63b436654cb5e0b3bf94  /tmp/vips.tar.xz' | sha256sum -c -
tar -xJf /tmp/vips.tar.xz -C /tmp
export CFLAGS='-O2 -march=x86-64 -mtune=generic'
export CXXFLAGS="$CFLAGS"
export CC=clang
export CXX=clang++
export LDFLAGS='-Wl,-rpath,/opt/hauser-vips/lib'
meson setup /tmp/vips-build /tmp/vips-8.18.7 --prefix=/opt/hauser-vips --libdir=lib \
  --buildtype=release -Dmodules=disabled -Dintrospection=disabled \
  -Dexamples=false -Dhighway=disabled -Dorc=disabled
meson compile -C /tmp/vips-build -j 2
meson install -C /tmp/vips-build
mkdir -p /opt/hauser-vips/share/licenses/libvips
cp /tmp/vips-8.18.7/LICENSE /opt/hauser-vips/share/licenses/libvips/LICENSE

cd /build/app
npm ci --omit=dev
# Only install the build tools here. Sharp is built explicitly below; lifecycle
# hooks of unrelated application dependencies are not needed in this stage.
npm install --ignore-scripts --omit=dev --no-save --package-lock=false node-addon-api@8.9.2 node-gyp@12.4.0
export PKG_CONFIG_PATH=/opt/hauser-vips/lib/pkgconfig
export LD_LIBRARY_PATH=/opt/hauser-vips/lib
export SHARP_FORCE_GLOBAL_LIBVIPS=1
npm run build --prefix node_modules/sharp
cp node_modules/sharp/src/build/Release/sharp-linuxmusl-x64-0.35.5.node /opt/hauser-vips/lib/sharp.node
