#!/bin/bash
cd "$(dirname "$0")"
export PGPASSWORD=fake123
export PORT=8022
export VIREO_LLM_PROVIDER=openrouter
export OPENROUTER_API_KEY=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
export OPENAI_MODEL=google/gemini-2.5-flash
node agents/studio/src/server.js
