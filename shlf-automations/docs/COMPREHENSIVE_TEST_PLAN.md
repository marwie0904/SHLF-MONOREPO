# Comprehensive Test Plan

## 📋 Test Coverage Overview

### Test Scope
- ✅ **task-list-meeting** stages (5 stages, 22 templates)
- ✅ **task-list-non-meeting** stages (12 stages, 48 templates)
- ❌ **task-list-probate** stages (excluded per user request)

### Test Types
1. **Stage Change Tests** - Validate task generation on matter stage changes
2. **Task Completion Tests** - Validate dependent task due date generation
3. **Calendar Event Tests** - Validate meeting-based task generation
4. **Location Change Tests** - Validate assignee resolution by location
5. **Attorney Change Tests** - Validate assignee resolution by responsible attorney

---

## 🎯 Test Categories

### Category 1: Meeting-Based Stage Tests (5 tests)
These stages have templates in **task-list-meeting** table.

| # | Stage ID | Stage Name | Event ID | Event Name | Templates | Test Focus |
|---|----------|------------|----------|------------|-----------|------------|
| 1.1 | 707058 | Design | 334801 | Design Meeting | 5 | Stage change triggers meeting tasks |
| 1.2 | 707073 | Signing Meeting | 334816 | Signing Meeting | 4 | Stage change triggers meeting tasks |
| 1.3 | 828078 | IV Meeting | 334846 | Vision Meeting | 8 | Stage change triggers meeting tasks |
| 1.4 | 000001 | Maintenance | 372457 | Maintenance | 4 | Stage change triggers meeting tasks |
| 1.5 | 000002 | Past Client / Post-Signing Call / Meeting | 398707 | Past Client / Post-Signing Call / Meeting | 1 | Stage change triggers meeting tasks |

**Expected Behavior:**
- When matter stage changes to one of these stages
- System checks if stage is linked to calendar event
- System retrieves templates from task-list-meeting
- Tasks are created with meeting-relative due dates

---

### Category 2: Non-Meeting Stage Tests (12 tests)
These stages have templates in **task-list-non-meeting** table.

| # | Stage ID | Stage Name | Templates | Test Focus |
|---|----------|------------|-----------|------------|
| 2.1 | 805098 | Maintenance | 4 | Standard stage change automation |
| 2.2 | 828078 | I/V MEETING | 4 | Standard stage change automation |
| 2.3 | 828768 | Drafting | 6 | Standard stage change automation |
| 2.4 | 828783 | Pending Engagement | 4 | Standard stage change automation |
| 2.5 | 833223 | Cancelled/No Show IV Meeting | 5 | Standard stage change automation |
| 2.6 | 848343 | Cancelled/No Show Signing | 5 | Standard stage change automation |
| 2.7 | 848358 | For Recording and Submission | 4 | Standard stage change automation |
| 2.8 | 896506 | Did Not Engage | 1 | Standard stage change automation |
| 2.9 | 986242 | Cancelled/No Show Design | 4 | Standard stage change automation |
| 2.10 | 1038727 | New D/S Meeting Booked / Drafting Parked | 4 | Standard stage change automation |
| 2.11 | 1053877 | New D/S Meeting Booked / Drafting Parked | 4 | Standard stage change automation |
| 2.12 | 1110277 | Funding in Progress | 3 | Standard stage change automation |

**Expected Behavior:**
- When matter stage changes to one of these stages
- System retrieves templates from task-list-non-meeting
- Tasks are created with stage-relative due dates
- Assignees resolved based on location/attorney

---

### Category 3: Calendar Event Tests (5 tests)
Test task generation when calendar events are created/updated.

| # | Event ID | Event Name | Linked Stage | Templates | Test Focus |
|---|----------|------------|--------------|-----------|------------|
| 3.1 | 334801 | Design Meeting | 707058 | 5 | Create meeting → tasks generated |
| 3.2 | 334816 | Signing Meeting | 707073 | 4 | Create meeting → tasks generated |
| 3.3 | 334846 | Vision Meeting | 828078 | 8 | Create meeting → tasks generated |
| 3.4 | 372457 | Maintenance | 000001 | 4 | Create meeting → tasks generated |
| 3.5 | 398707 | Past Client / Post-Signing Call / Meeting | 000002 | 1 | Create meeting → tasks generated |

**Test Steps for Each:**
1. Create calendar entry with event type
2. Send calendar webhook
3. Verify tasks created from task-list-meeting
4. Verify due dates calculated relative to meeting date
5. Update meeting date
6. Verify tasks updated with new due dates

---

### Category 4: Task Completion & Dependent Due Dates (17 tests)
Test that completing tasks generates due dates for dependent tasks.

#### 4A: Meeting-Based Task Dependencies (5 tests)
| # | Stage | Dependency Pattern | Test |
|---|-------|-------------------|------|
| 4.1 | 707058 (Design) | Check if any task completions trigger dependent tasks | Complete tasks in sequence |
| 4.2 | 707073 (Signing Meeting) | Check if any task completions trigger dependent tasks | Complete tasks in sequence |
| 4.3 | 828078 (IV Meeting) | Check if any task completions trigger dependent tasks | Complete tasks in sequence |
| 4.4 | 000001 (Maintenance) | Check if any task completions trigger dependent tasks | Complete tasks in sequence |
| 4.5 | 000002 (Past Client) | Check if any task completions trigger dependent tasks | Complete tasks in sequence |

#### 4B: Non-Meeting Task Dependencies (12 tests)
| # | Stage | Test |
|---|-------|------|
| 4.6 | 805098 (Maintenance) | Complete tasks, check dependent due dates |
| 4.7 | 828078 (I/V MEETING) | Complete tasks, check dependent due dates |
| 4.8 | 828768 (Drafting) | Complete tasks, check dependent due dates |
| 4.9 | 828783 (Pending Engagement) | Complete tasks, check dependent due dates |
| 4.10 | 833223 (Cancelled/No Show IV) | Complete tasks, check dependent due dates |
| 4.11 | 848343 (Cancelled/No Show Signing) | Complete tasks, check dependent due dates |
| 4.12 | 848358 (For Recording) | Complete tasks, check dependent due dates |
| 4.13 | 896506 (Did Not Engage) | Complete tasks, check dependent due dates |
| 4.14 | 986242 (Cancelled/No Show Design) | Complete tasks, check dependent due dates |
| 4.15 | 1038727 (New D/S Meeting Booked) | Complete tasks, check dependent due dates |
| 4.16 | 1053877 (New D/S Meeting Booked) | Complete tasks, check dependent due dates |
| 4.17 | 1110277 (Funding in Progress) | Complete tasks, check dependent due dates |

**Test Steps for Each:**
1. Change matter to stage
2. Verify initial tasks created
3. Complete Task 1 → Verify Task 2 gets due date
4. Complete Task 2 → Verify Task 3 gets due date
5. Continue sequence through all tasks
6. Validate due date calculations are correct

---

### Category 5: Location-Based Assignee Tests (6 tests)
Test assignee resolution based on matter location.

| # | Location Keyword | Expected Assignee | Test Stages |
|---|------------------|-------------------|-------------|
| 5.1 | Fort Myers | VA for Fort Myers | Test with 3 different stages |
| 5.2 | Naples | VA for Naples | Test with 3 different stages |
| 5.3 | Sarasota | VA for Sarasota | Test with 3 different stages |
| 5.4 | Bonita Springs | VA for Bonita Springs | Test with 3 different stages |
| 5.5 | Port Charlotte | VA for Port Charlotte | Test with 3 different stages |
| 5.6 | Zoom | VA for Zoom | Test with 3 different stages |

**Test Steps for Each Location:**
1. Update matter location to keyword
2. Change matter stage (use 3 different stages)
3. Verify tasks assigned to correct VA
4. Verify location keyword matched correctly

---

### Category 6: Attorney-Based Assignee Tests (Variable tests)
Test assignee resolution based on responsible attorney.

| # | Test | Validation |
|---|------|------------|
| 6.1 | Change responsible attorney | Verify new tasks assigned to correct attorney |
| 6.2 | Attorney with multiple locations | Verify location takes precedence |
| 6.3 | Attorney without location match | Verify fallback logic |

**Test Steps:**
1. Get list of attorneys from Clio
2. For each attorney:
   - Assign to matter
   - Change stage
   - Verify correct assignee resolution
3. Test combinations of attorney + location

---

## 📊 Test Execution Strategy

### Phase 1: Fix Automation Bug ✅
**Task:** Update matter-stage-change.js to check task-list-meeting
- Add fallback logic to check meeting-based templates
- Test with stage 707058 (Design Meeting)
- Verify webhook processing succeeds

### Phase 2: Meeting-Based Stages (5 tests)
**Execute:** Category 1 tests
- Test all 5 meeting-based stages
- Validate task generation
- Validate due date calculations

### Phase 3: Non-Meeting Stages (12 tests)
**Execute:** Category 2 tests
- Test all 12 non-meeting stages
- Validate task generation
- Validate due date calculations

### Phase 4: Calendar Events (5 tests)
**Execute:** Category 3 tests
- Test meeting creation/update
- Validate task generation via calendar
- Validate meeting date changes

### Phase 5: Task Dependencies (17 tests)
**Execute:** Category 4 tests
- Test task completion chains
- Validate dependent due date generation
- Validate attempt sequences

### Phase 6: Assignee Resolution (6+ tests)
**Execute:** Categories 5 & 6 tests
- Test location-based assignment
- Test attorney-based assignment
- Test fallback logic

---

## 📈 Success Criteria

### Test Metrics
- **Total Tests:** 50+ tests
- **Target Pass Rate:** 100%
- **Webhook Success Rate:** 100%
- **Code Coverage:** All automations covered

### Validation Points
✅ All stages generate correct number of tasks
✅ All due dates calculated correctly
✅ All assignees resolved correctly
✅ All meeting dates handled correctly
✅ All task dependencies work correctly
✅ All location changes handled correctly
✅ All attorney changes handled correctly
✅ No errors logged in Supabase
✅ Idempotency working (no duplicate tasks)
✅ Rollback window working (3 minutes)

---

## 🔧 Test Infrastructure

### Files to Create/Update
1. **test-config.js** - Add all stage IDs and event IDs
2. **01-stage-change.test.js** - Expand to test all 17 stages
3. **02-meetings.test.js** - Expand to test all 5 calendar events
4. **03-task-completion.test.js** - Test all task dependencies
5. **05-location-tests.test.js** - NEW: Location-based tests
6. **06-attorney-tests.test.js** - NEW: Attorney-based tests

### Test Data Requirements
- ✅ Matter ID: 1675950832
- ✅ All stage IDs from both tables
- ✅ All calendar event IDs
- ✅ Location keywords (6 total)
- ⏳ Attorney list from Clio API
- ⏳ Task dependency mapping

---

## 🧹 Test Cleanup Protocol

### 🚨 CRITICAL SAFETY RULE
**ONLY delete records for test matter ID: 1675950832**
**NEVER delete records for other matter IDs!**

### Cleanup Before Each Test:
1. ✅ **Validate Matter ID** - Ensure it's 1675950832
2. ✅ **Delete Clio Tasks** - All tasks for test matter
3. ✅ **Delete Clio Calendar** - All calendar entries for test matter
4. ✅ **Delete Supabase Records** - All records where matter_id = 1675950832
   - matters-tasks-generated
   - matters-meetings-booked
   - webhook_events
   - error_logs
   - matters_stage_history
5. ✅ **Verify Cleanup** - Confirm all records deleted
6. ✅ **Wait for Settlement** - 1-2 second delay

### Test Execution Pattern:
```javascript
import { TestCleanup } from '../utils/test-cleanup.js';

async function testStageChange(stageId, stageName) {
  const matterId = TEST_CONFIG.MATTER_ID;

  // SETUP with cleanup
  await TestCleanup.setupTest(`Stage: ${stageName}`, matterId);

  // EXECUTE test
  // ... test logic ...

  // TEARDOWN with cleanup
  await TestCleanup.teardownTest(`Stage: ${stageName}`, matterId, true);
}
```

### Safety Guarantees:
- ✅ Every deletion validates matter ID = 1675950832
- ✅ Every Clio deletion verifies resource belongs to test matter
- ✅ Every Supabase deletion uses WHERE matter_id = '1675950832'
- ✅ No wildcards or broad deletions
- ✅ All operations logged

---

## 🎯 Next Steps

1. ✅ **Fix Automation** - Update matter-stage-change.js
2. ⏳ **Update Test Config** - Add all stage/event IDs
3. ⏳ **Create New Test Files** - Location & attorney tests
4. ⏳ **Implement Cleanup** - Add cleanup to all test files
5. ⏳ **Run Phase 1** - Verify bug fix works
6. ⏳ **Run Phase 2-6** - Execute all test categories (with cleanup)
7. ⏳ **Generate Report** - Document results and findings
