#!/bin/bash

# Script to start local development environment for save-the-wildlife project

set -e  # Exit on error

echo "Starting local dev environment..."

# Navigate to project root (assuming script is in scripts/)
cd "$(dirname "$0")/.."

# Start Coherence (assuming start_coherence.mjs exists)
echo "Starting Coherence..."
npx zx scripts/start_coherence.mjs

# Start Score service (assuming it's a Gradle project)
echo "Starting Score service..."
cd score
./gradlew bootRun &
cd ..

# Start Server
echo "Starting Server..."
cd server
REALTIME_CLUSTER_BACKEND="${REALTIME_CLUSTER_BACKEND:-coherence}" ENABLE_COHERENCE_BACKEND="${ENABLE_COHERENCE_BACKEND:-true}" npm start &
cd ..

# Start Web dev server
echo "Starting Web dev server..."
cd web
npm run dev &
cd ..

# Optionally start Bots if needed
# echo "Starting Bots..."
# cd bots
# npm start &
# cd ..

echo "Local dev environment started. Check terminals for logs."
echo "Web should be available at http://localhost:8080 (adjust ports as needed)."

# Wait for all background processes
wait
