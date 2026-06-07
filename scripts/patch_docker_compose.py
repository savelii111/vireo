#!/usr/bin/env python3
"""Patch docker-compose.yml: add 'npm install' to all Node service commands."""
import re
from pathlib import Path

p = Path("docker-compose.yml")
text = p.read_text(encoding="utf-8")

# Pattern: lines like '    command: ["node", "src/server.js"]' or '    command: ["node", "index.js"]'
# Replace with: '    command: ["sh", "-c", "test -d node_modules || (npm install --omit=dev --no-save --silent); exec node src/server.js"]'
def fix(m):
    cmd = m.group(1)
    return f'    command: ["sh", "-c", "(test -d node_modules || npm install --omit=dev --no-save --silent --no-audit --no-fund) && exec {cmd}"]'

# Only replace simple node commands, not python (we don't want to break style-learner/editor/video)
new = re.sub(r'command:\s*\["node",\s*"([^"]+)"\]', fix, text)

# Also handle orchestrator which has command: ["node", "index.js"]
# (already matched by the same pattern)

if new == text:
    print("No changes made")
else:
    p.write_text(new, encoding="utf-8")
    print(f"Patched. {text.count('node', 0, len(text))} node occurrences before.")
    print(f"After: {new.count('npm install')} 'npm install' added.")

# Verify
import subprocess
subprocess.run(["grep", "-c", "npm install", "docker-compose.yml"])
