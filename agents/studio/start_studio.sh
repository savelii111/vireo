#!/usr/bin/env bash
# Day 26 / Phase 0: starts the Studio backend with the
# dev-login flag enabled. This is for LOCAL DEVELOPMENT
# ONLY — the /api/dev/issue-token endpoint and the
# frontend constant __VIREO_DEV_LOGIN__ both gate on this
# flag and refuse to do anything if it isn't set, so
# running without it is safe in production.
#
# Usage: ./agents/studio/start_studio.sh
set -euo pipefail
export VIREO_DEV_LOGIN=1
export VIREO_JWT_SECRET=vireo
export VIREO_VIDEO_URL="${VIREO_VIDEO_URL:-http://127.0.0.1:8007}"
export VIREO_MEDIA_ROOT="${VIREO_MEDIA_ROOT:-/c/Users/koval/vireo-data}"
cd "$(dirname "$0")/.."
exec node agents/studio/src/server.js
