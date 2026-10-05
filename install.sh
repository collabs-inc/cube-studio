#!/bin/sh
# Cube runs this after every clone and update, in the app's folder. Everything it installs is either inside this
# folder (node_modules, with ffmpeg) or in a shared cache (Chromium, ~/.cache/ms-playwright). The user's work
# lives in ~/Studio, which is created once and never touched again.
set -eu
npm ci --no-audit --no-fund
npx --no-install playwright-core install chromium-headless-shell
node engine/setup-home.mjs
