#!/bin/bash

# Create Clio Webhook Subscription
# This will return a webhook secret that you need to save

CLIO_ACCESS_TOKEN="22622-NzOiZh6w2NhRwMzR27dWhIS3i3NtZC3QAj"
WEBHOOK_URL="https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/matters"

curl -X POST "https://app.clio.com/api/v4/webhooks.json" \
  -H "Authorization: Bearer $CLIO_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "url": "'"$WEBHOOK_URL"'",
      "events": ["matter.updated", "task.created", "task.updated", "calendar_entry.created", "calendar_entry.updated"],
      "status": "active"
    }
  }'

echo ""
echo ""
echo "Save the 'secret' value from the response above - this is your CLIO_WEBHOOK_SECRET"
