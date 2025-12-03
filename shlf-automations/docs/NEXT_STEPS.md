# Next Steps - After Deployment

## ✅ What Was Done

1. **Fixed the Automation Bug**
   - Updated `matter-stage-change.js` to check task-list-meeting as fallback
   - Added `getCalendarEventMappingByStage` method to SupabaseService
   - Configured calendar event mappings for meeting-based stages

2. **Pushed to GitHub**
   - All changes committed and pushed to `main` branch
   - Commit: `957621f` - "Fix: Add task-list-meeting fallback for meeting-based stages"
   - Auto-deployment should trigger automatically

3. **Created Test Scripts**
   - `test-one-stage.mjs` - Test ONE stage at a time
   - Comprehensive test reports in `tests/reports/`

---

## ⏳ Wait for Deployment (2-5 minutes)

The code is now on GitHub. If Digital Ocean has auto-deployment configured, it will:
1. Pull the new code
2. Restart the application
3. Be ready to test in 2-5 minutes

---

## 🧪 After Deployment - Test ONE Stage at a Time

### Quick Test: Design Stage (Meeting-Based)

This stage was FAILING before (webhook timeout). Should work now:

```bash
node test-one-stage.mjs 707058
```

**Expected Output:**
```
Testing Stage: 707058 on Matter: 1675950832
================================================================================

Step 1: Cleaning test environment...
✅ CLEANUP COMPLETE

Step 2: Changing matter to stage 707058...
✅ Matter stage updated to: Design

Step 3: Sending webhook to Digital Ocean...
✅ Webhook sent successfully
✅ Webhook processed successfully!
   Action: created_tasks

Step 4: Checking results...
✅ 5 tasks created

Tasks Created:
  1. Send meeting confirmation
     - Due Date: 2025-10-06T14:00:00Z
     - Task ID: 1234567
  2. Prepare rough draft
     - Due Date: 2025-10-03T14:00:00Z
     - Task ID: 1234568
  ...

✅ No errors logged

================================================================================
TEST PASSED ✅
================================================================================
```

### Test Other Stages (One at a Time)

```bash
# Test Drafting (non-meeting)
node test-one-stage.mjs 828768

# Test Signing Meeting (meeting-based)
node test-one-stage.mjs 707073

# Test IV Meeting (meeting-based)
node test-one-stage.mjs 828078

# Test Pending Engagement (non-meeting)
node test-one-stage.mjs 828783
```

---

## 🔍 How to Verify Deployment

### 1. Check Server Health
```bash
curl https://shlf-main-automation-ywgsu.ondigitalocean.app/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-10-05T..."
}
```

### 2. Check Digital Ocean Logs (if you have access)

```bash
# SSH into server
ssh user@shlf-main-automation-ywgsu.ondigitalocean.app

# Check deployment logs
pm2 logs

# Or check systemd logs
journalctl -u shlf-automation -f
```

Look for:
- "No templates found in probate/non-meeting, checking task-list-meeting..."
- "Found event mapping: Design Meeting (334801)"
- "Found X templates from task-list-meeting"

### 3. Check Current Git Commit on Server

```bash
# SSH into server
cd /path/to/app
git log --oneline -1
```

Should show:
```
957621f Fix: Add task-list-meeting fallback for meeting-based stages
```

---

## 📊 Expected Results

### Meeting-Based Stages (Should Now Work)
- ✅ 707058 (Design) - 5 tasks from task-list-meeting
- ✅ 707073 (Signing Meeting) - 4 tasks from task-list-meeting
- ✅ 828078 (IV Meeting) - 8 tasks from task-list-meeting

### Non-Meeting Stages (Already Worked)
- ✅ 828768 (Drafting) - 6 tasks
- ✅ 828783 (Pending Engagement) - 4 tasks
- ✅ 833223 (Cancelled/No Show IV) - 5 tasks
- ✅ 848343 (Cancelled/No Show Signing) - 5 tasks
- ✅ 848358 (For Recording) - 4 tasks
- ✅ 896506 (Did Not Engage) - 1 task
- ✅ 986242 (Cancelled/No Show Design) - 4 tasks
- ✅ 1053877 (New D/S Meeting Booked) - 4 tasks
- ✅ 1110277 (Funding in Progress) - 3 tasks

### Invalid Stages (Will Still Fail - Need to Remove)
- ❌ 000001, 000002, 805098, 1038727 - Don't exist in Clio

---

## 🚨 If Tests Still Fail

### Problem: Webhook still times out
**Solution:** The deployment might not have happened. Manually deploy:
```bash
# SSH into Digital Ocean
ssh user@server
cd /path/to/app
git pull origin main
pm2 restart all
```

### Problem: ERR_TEMPLATE_MISSING still appears
**Solution:** The fallback logic isn't being reached. Check:
1. Is the new code deployed? (`git log -1` on server)
2. Is the calendar_event_mappings table populated?
3. Are the stage IDs correct?

### Problem: Tasks created but wrong count
**Solution:** Template count might be different. Check:
```sql
SELECT COUNT(*) FROM "task-list-meeting" WHERE stage_id = '707058';
```

---

## 🎯 Success Checklist

After testing, verify:
- [ ] Deployment completed (check server logs/commit)
- [ ] Stage 707058 (Design) creates 5 tasks ✅
- [ ] Stage 828768 (Drafting) creates 6 tasks ✅
- [ ] No ERR_TEMPLATE_MISSING errors in error_logs
- [ ] All webhook_events have success=true
- [ ] Tasks have correct due dates
- [ ] Tasks have assignees

---

## 📝 Documents Created

1. **Test Results:**
   - `tests/reports/comprehensive-test-results.md` - All 17 test results

2. **Analysis:**
   - `WEBHOOK_PROCESSING_ROOT_CAUSE.md` - Root cause analysis
   - `FIX_APPLIED.md` - Details of the fix
   - `DEPLOYMENT_STATUS.md` - Deployment status and verification

3. **Test Scripts:**
   - `test-one-stage.mjs` - Test ONE stage at a time
   - `tests/run-all-stage-tests.js` - Test ALL stages (use after confirming fix works)

4. **Planning:**
   - `COMPREHENSIVE_TEST_PLAN.md` - Complete test plan with all stages

---

## 🔄 Final Steps

1. **Wait 2-5 minutes** for auto-deployment
2. **Run:** `node test-one-stage.mjs 707058`
3. **If passes:** Test a few more stages
4. **If all pass:** Run full test suite
5. **Document results** in test report

Good luck! The fix should resolve the webhook timeout issue for meeting-based stages. 🚀
