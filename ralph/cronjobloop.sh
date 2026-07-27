#!/bin/bash

RALPH_DIR=$(cd "$(dirname "$0")" && pwd -P)
PROJECT_DIR=$(dirname "$RALPH_DIR")

pkill -f "$RALPH_DIR/afk[.]sh claude 20" 2>/dev/null || true
cd "$PROJECT_DIR" && exec "$RALPH_DIR/afk.sh" claude 20
