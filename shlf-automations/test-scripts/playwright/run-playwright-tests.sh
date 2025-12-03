#!/bin/bash

# Run the Playwright test suite with automatic screenshot capture
# This script will run the Node.js test and I (Claude) will execute the Playwright calls

echo "🚀 Starting Playwright Meeting Tests..."
echo "This will run 15 tests (3 locations × 5 meetings)"
echo ""

# Start the test
node test-meeting-playwright.js

echo ""
echo "✅ Test script completed"
echo "Screenshots are saved in: .playwright-screenshots/meeting-based-tasks/"
