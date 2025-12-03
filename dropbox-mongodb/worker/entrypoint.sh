#!/bin/bash
# DO NOT use set -e - we want to see errors, not exit silently

echo "=== Entrypoint script starting ===" >&2
echo "Python version:" >&2
python --version >&2 || echo "ERROR: Python not found" >&2

echo "Current directory:" >&2
pwd >&2

echo "Files in /app:" >&2
ls -la /app >&2

echo "Environment variables:" >&2
env | grep -E "^(MONGODB|SERVICE_BUS|BLOB|OPENAI|AZURE|LOG_LEVEL|CHUNK|MAX|TEMP_DIR)" >&2 || echo "No matching env vars" >&2

echo "=== Starting main.py ===" >&2

# Run Python with unbuffered output, capturing both stdout and stderr
python -u main.py 2>&1
exit_code=$?

echo "=== Python exited with code: $exit_code ===" >&2
exit $exit_code

