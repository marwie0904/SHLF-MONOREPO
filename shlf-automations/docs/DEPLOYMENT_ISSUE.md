# Deployment Issue - Manual Action Required

## 🚨 Problem

Three fixes have been pushed to GitHub but deployment status is UNCERTAIN:

1. ✅ **Commit e269907** - Fix: Remove setEncoding from raw body middleware
2. ✅ **Commit 957621f** - Fix: Add task-list-meeting fallback for meeting-based stages
3. ✅ **Commit 013eb60** - Fix: Use express.json verify callback for raw body preservation

**Current Error:** `stream is not readable` (500 error)

**Root Cause:** Digital Ocean server may still be running OLD code OR the preserveRawBody middleware is still being used.

---

## 📋 Latest Fix: Express.json Verify Callback (013eb60)

### Problem
Custom `preserveRawBody` middleware was consuming the request stream BEFORE body-parser could read it, causing:
- First: "stream encoding should not be set" (when using setEncoding)
- Then: "stream is not readable" (when using buffer approach)

### Solution
Remove custom middleware entirely. Use Express.js built-in verify callback:

**File:** `src/index.js`

```javascript
// OLD (causes "stream is not readable"):
app.use('/webhooks', preserveRawBody);  // ← Consumes stream!
app.use(express.json());

// NEW (works - doesn't consume stream):
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    // Capture raw body WITHOUT consuming stream
    req.rawBody = buf.toString('utf8');
  }
}));
```

**Why This Works:**
- The `verify` callback runs DURING JSON parsing
- Gets access to raw buffer BEFORE parsing
- Doesn't consume or interfere with the stream
- Standard Express.js pattern for signature validation

---

## ⚙️ Manual Deployment Required

### Option 1: Digital Ocean Dashboard
1. Go to https://cloud.digitalocean.com/apps
2. Find your SHLF Automation app
3. Go to Settings → App Spec
4. Click "Force Deploy" or "Redeploy"

### Option 2: SSH + Git Pull
```bash
# SSH into Digital Ocean droplet
ssh user@shlf-main-automation-ywgsu.ondigitalocean.app

# Navigate to app directory
cd /path/to/shlf-automations

# Pull latest code
git fetch origin
git pull origin main

# Should see commits:
# 013eb60 Fix: Use express.json verify callback for raw body preservation
# e269907 Fix: Remove setEncoding from raw body middleware
# 957621f Fix: Add task-list-meeting fallback for meeting-based stages

# Restart application
pm2 restart all
# OR
systemctl restart shlf-automation
# OR
npm run start
```

### Option 3: Digital Ocean App Platform CLI
```bash
# Install doctl if not already installed
brew install doctl

# Authenticate
doctl auth init

# List apps
doctl apps list

# Trigger deployment
doctl apps create-deployment <app-id>
```

---

## ✅ How to Verify Deployment

### 1. Check Server Responds (No Stream Error)
```bash
curl -X POST https://shlf-main-automation-ywgsu.ondigitalocean.app/webhooks/matters \
  -H "Content-Type: application/json" \
  -H "X-Clio-Signature: test123" \
  -d '{"model":"Matter","event":"updated","id":1675950832,"data":{"id":1675950832,"matter_stage":{"id":707058},"matter_stage_updated_at":"2025-10-05T06:00:00Z"}}'
```

**Before Fix (Current):**
```json
{"success":false,"error":"stream is not readable"}
```

**After Fix (Expected):**
```json
{"success":false,"error":"Invalid signature"}
```
(This is expected - our test signature is wrong, but at least the stream error is gone!)

### 2. Check Git Commit on Server
```bash
ssh user@server
cd /path/to/app
git log --oneline -3
```

Should show:
```
013eb60 Fix: Use express.json verify callback for raw body preservation
e269907 Fix: Remove setEncoding from raw body middleware
957621f Fix: Add task-list-meeting fallback for meeting-based stages
```

### 3. Run Test Again
After deployment:
```bash
node test-one-stage.mjs 707058
```

Should succeed with:
- ✅ Webhook sent successfully
- ✅ Webhook processed successfully
- ✅ 5 tasks created

---

## 🎯 After Deployment - Expected Test Results

### Stage 707058 (Design) - Meeting-Based
- ✅ Webhook processes without stream error
- ✅ Signature validation works (or fails gracefully with "Invalid signature")
- ✅ Automation checks task-list-non-meeting (finds 0 templates)
- ✅ Automation falls back to check calendar_event_mappings
- ✅ Finds mapping: stage 707058 → event 334801
- ✅ Queries task-list-meeting for event 334801
- ✅ Finds 5 templates
- ✅ Creates 5 tasks

---

## 📝 Deployment Timeline

1. **2025-10-05 ~06:10** - Committed 957621f (task-list-meeting fallback)
2. **2025-10-05 ~06:12** - Committed e269907 (remove setEncoding)
3. **2025-10-05 ~06:19** - Committed 013eb60 (express.json verify callback)
4. **Current Status** - Server still returning "stream is not readable"

**Possible Issues:**
- Auto-deployment hasn't triggered yet (wait 2-5 more minutes)
- Auto-deployment is disabled (manual deployment required)
- Server needs manual restart after git pull

---

## 🔍 Troubleshooting

### If stream error persists after 5 minutes:
- Deployment didn't happen automatically
- Need to manually trigger deployment (see options above)
- Check Digital Ocean deployment logs

### If different error appears:
- Progress! Stream issue is fixed
- New error might be signature validation (expected) or other issue
- Check error message and logs

### If "Invalid signature" error:
- **This is GOOD!** Stream is working, signature validation is working
- Our test curl uses fake signature "test123"
- Real Clio webhooks will have valid signatures

### If webhook processes successfully:
- **Perfect!** All fixes working
- Run comprehensive tests on all stages
- Verify task creation and due dates

---

## 📞 Contact

If you can't access Digital Ocean or deployment isn't working:
- Contact person who set up Digital Ocean deployment
- They can trigger manual deployment
- Or provide SSH access for git pull + restart

---

## 🚀 Next Steps

1. **Wait 2-5 minutes** for auto-deployment OR manually trigger deployment
2. **Verify deployment:** Check git commit on server OR test with curl
3. **Run test:** `node test-one-stage.mjs 707058`
4. **If successful:** Test other stages one at a time
5. **If still fails:** Check server logs for new error details
