#!/bin/bash
cd "$(dirname "$0")"
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY}"
export PGPASSWORD="${PGPASSWORD}"
export PORT="${PORT:-8022}"
export VIREO_LLM_PROVIDER="${VIREO_LLM_PROVIDER:-openrouter}"
export OPENAI_MODEL=google/gemini-2.5-flash
node agents/studio/src/server.js
