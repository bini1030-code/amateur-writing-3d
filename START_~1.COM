#!/bin/sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
 echo 'Node.js 18+ needed. Install from https://nodejs.org/'
 read -r -p 'Press Enter to close'
 exit 1
fi
node server.js &
pid=$!
sleep 2
open http://localhost:3000
wait "$pid"
