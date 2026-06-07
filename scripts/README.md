# Vireo — dev runner.

Starts all 5 agents + auth + billing + dashboard in a single terminal.
Use Ctrl+C to stop everything.

Requires: Python 3.13+, Node 24+, npm.

## First time

```bash
cd vireo
python -m pip install -e agents/style-learner
python -m pip install -e agents/editor
```

## Run

In one terminal:

```bash
./scripts/dev.sh
```

In another:

```bash
node tests/run-all.mjs
```

Open dashboard at http://localhost:3000.
