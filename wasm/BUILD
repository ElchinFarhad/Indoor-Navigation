#!/bin/sh
# Builds the Rust crate to WebAssembly and drops the result where the React
# client serves it from (react-client/public/wasm). The output is committed so
# the client can be run without a Rust toolchain.
set -e
cd "$(dirname "$0")"
OUT=../react-client/public/wasm
wasm-pack build --release --target no-modules --no-typescript --no-pack --out-dir "$OUT" --out-name qr
# wasm-pack marks its output directory as ignored; we want it tracked.
rm -f "$OUT/.gitignore"
