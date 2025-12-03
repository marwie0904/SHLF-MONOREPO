# Testing Setup - Complete ✅

## ✅ What's Been Done

### 1. Supabase Tables Created
All missing tables have been created and populated with default data:

- ✅ **calendar_event_mappings** (1 row)
  - Maps calendar event type 334801 (Initial Consultation) to task templates

- ✅ **attempt_sequences** (3 rows)
  - Attempt 1 → Attempt 2 (7 days)
  - Attempt 2 → Attempt 3 (7 days)
  - Attempt 3 → No Response (7 days)

- ✅ **location_keywords** (6 rows)
  - Fort Myers Office, Fort Myers
  - Naples Office, Naples
  - Cape Coral Office, Cape Coral

### 2. Clio Credentials Added
Your Clio credentials have been added to `.env`:
```
CLIO_ACCESS_TOKEN=22622-NzOiZh6w2NhRwMzR27dWhIS3i3NtZC3QAj
CLIO_REFRESH_TOKEN=JM2nqmaYBXpjQrirTp0nPlhaYWDKTp6JRymWt9pZ
```

## ⚠️ What You Need to Provide

### Digital Ocean Server URL
Update the `.env` file with your Digital Ocean server URL:

```bash
# In .env file, replace this line:
TEST_SERVER_URL=https://your-digitalocean-server-url.com

# With your actual server URL, for example:
TEST_SERVER_URL=https://shlf-automations.yourdomain.com
```

### Webhook Secret (Optional)
If you have a webhook secret configured in Clio, add it:

```bash
# In .env file, replace:
CLIO_WEBHOOK_SECRET=your_webhook_secret_here

# With your actual webhook secret
CLIO_WEBHOOK_SECRET=actual_secret_from_clio
```

## 🚀 Running the Tests

Once you've updated the server URL in `.env`:

```bash
npm test
```

## 📊 What the Tests Will Do

The tests will connect to your **Digital Ocean server** and:

1. **Discovery Suite** (3 tests)
   - Verify server is running and responding
   - Query all Supabase configurations
   - Capture baseline state for matter 1675950832

2. **Stage Change Suite** (4 tests)
   - Test matter stage changes via Clio API
   - Verify tasks are created correctly
   - Test validation and error handling
   - Verify idempotency (no duplicate tasks)

3. **Meeting Suite** (3 tests)
   - Create calendar meetings via Clio API
   - Test meeting date updates
   - Verify meeting-related tasks

4. **Task Completion Suite** (2 tests)
   - Complete attempt tasks
   - Verify next attempt tasks are created

5. **Critical Fixes Suite** (5 tests)
   - Validate all 5 critical fixes are working
   - Test timestamp validation
   - Test partial failure tracking
   - Test webhook signature validation

6. **Validation Suite** (3 tests)
   - Check database integrity
   - Verify no orphaned tasks
   - Analyze webhook success rate

## 🔍 Test Flow

```
Tests (Local) → Clio API → Digital Ocean Server → Supabase
     ↓                            ↓                    ↓
  Read/Write              Process Webhooks      Store Results
  via Clio API           Create Tasks          Track Events
```

**Important:** Tests will:
- ✅ Use real Clio API calls
- ✅ Connect to your Digital Ocean server
- ✅ Store results in your Supabase database
- ✅ Only modify test matter ID 1675950832

## 📝 Quick Start Checklist

- [ ] 1. Provide your Digital Ocean server URL in `.env`
- [ ] 2. Optionally: Add webhook secret if you have one
- [ ] 3. Run `npm test`
- [ ] 4. Review test results

## 🎯 Expected Results

If everything is set up correctly:
- Discovery tests should pass (verify server is running)
- Stage change tests should create tasks for matter 1675950832
- Meeting tests should create calendar entries
- All critical fixes should be validated
- Final report will show overall pass/fail status

## ❓ Troubleshooting

**"Server not running" error:**
- Verify Digital Ocean server URL is correct
- Check server is accessible (try opening URL in browser)
- Ensure server is running on Digital Ocean

**"401 Unauthorized" from Clio:**
- Verify CLIO_ACCESS_TOKEN is valid
- Check if token has expired
- Ensure token has access to matter 1675950832

**"Table not found" errors:**
- All tables have been created ✅
- If you see this, try refreshing Supabase connection

**Webhook signature errors:**
- Add CLIO_WEBHOOK_SECRET to .env
- Or temporarily disable signature validation for testing

## 📞 Next Steps

1. Provide your Digital Ocean server URL
2. I'll update the .env file
3. We'll run the tests
4. Review results together
