#!/bin/sh
# No-curl path: from a clone of the repo, write .env once (secrets generated, existing values kept) and start the stack.
#   git clone https://github.com/FindMalek/skiffr && cd skiffr && ./scripts/setup.sh
# Options are the ones of install.sh (--port, --domain, --email, --autoupdate, --no-start), plus --build to build the images from this source.
set -eu
cd "$(dirname "$0")/.."
exec sh ./install.sh --here "$@"
