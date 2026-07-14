#!/usr/bin/env bash
#
# Fetch the object detector I Spy plays with.
#
# These four files are 14MB, and they are the only binary artifacts the app has.
# They are NOT in git, for two reasons: 14MB of float weights would sit in the
# history for ever and never change, and git is not a CDN. They land in the image
# instead, fetched here at build time -- the build already needs the network to
# pip install, so this is not a new kind of dependency, only more bytes over the
# same wire.
#
# Every file is pinned by SHA-256. Upstream is a Google storage bucket, and a
# bucket is not a promise: if the bytes behind a URL change, this fails the build
# loudly rather than shipping a detector nobody reviewed. Re-pinning is
# deliberate work -- run with --print to get the new sums.
#
# Only the SIMD wasm is fetched. MediaPipe also ships a no-SIMD fallback, another
# 9MB, for browsers that predate WebAssembly SIMD -- Chrome 90 and Safari 16.3.
# Neither can run this app anyway, and doubling the download for them is a bad
# trade for everybody who can.

set -euo pipefail

MEDIAPIPE_VERSION="0.10.14"
CDN="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}"
MODELS="https://storage.googleapis.com/mediapipe-models/object_detector"

VENDOR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/waiting_games/static/vendor"

# path-under-vendor <TAB> url <TAB> sha256
#
# FLOAT16, not int8, and this is not a preference -- the int8 build of the same model
# DOES NOT WORK ON THE GPU. MediaPipe's GPU delegate cannot run a fully quantised
# graph, and what it does instead of saying so is return junk: pointed at a
# photograph of a dog, a bicycle and a truck, int8-on-GPU reported "dining table,
# 0.17" and then nothing at all, while float16 on the same frame found all three at
# 0.65. It does not throw, so nothing catches it, and every phone has a GPU. It would
# have shipped as a game that simply never finds anything.
#
# int8 is 4.4MB and float16 is 7.2MB. That is the whole cost, and a detector that
# detects nothing is not worth 4.4MB.
ASSETS="\
mediapipe/vision_bundle.mjs	${CDN}/vision_bundle.mjs	e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669
mediapipe/wasm/vision_wasm_internal.js	${CDN}/wasm/vision_wasm_internal.js	9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c
mediapipe/wasm/vision_wasm_internal.wasm	${CDN}/wasm/vision_wasm_internal.wasm	f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc
models/efficientdet_lite0.tflite	${MODELS}/efficientdet_lite0/float16/1/efficientdet_lite0.tflite	4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993"

main() {
  local printing=""
  [[ "${1:-}" == "--print" ]] && printing=1

  local path url want got target
  while IFS=$'\t' read -r path url want; do
    target="${VENDOR}/${path}"
    mkdir -p "$(dirname "${target}")"

    if [[ -z "${printing}" && -f "${target}" ]] &&
      got="$(sha256sum "${target}" | cut -d' ' -f1)" && [[ "${got}" == "${want}" ]]; then
      echo "have ${path}"
      continue
    fi

    echo "get  ${path}"
    curl -sfL --retry 3 --max-time 300 "${url}" -o "${target}"

    got="$(sha256sum "${target}" | cut -d' ' -f1)"
    if [[ -n "${printing}" ]]; then
      printf '%s\t%s\t%s\n' "${path}" "${url}" "${got}"
      continue
    fi

    if [[ "${got}" != "${want}" ]]; then
      # Leave nothing half-verified on disk: a partial vendor tree is how you get
      # a detector that loads and is not the one that was pinned.
      rm -f "${target}"
      echo "checksum mismatch for ${path}" >&2
      echo "  expected ${want}" >&2
      echo "  got      ${got}" >&2
      echo "upstream changed. review it, then re-pin with: $0 --print" >&2
      exit 1
    fi
  done <<<"${ASSETS}"
}

main "$@"
