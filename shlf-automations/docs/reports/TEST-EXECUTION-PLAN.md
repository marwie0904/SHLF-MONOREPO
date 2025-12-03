# SHLF Automation System - Comprehensive Test Execution Plan

**Test Matter ID:** 1675950832
**Test Date:** October 8, 2025
**Status:** Ready to Execute

---

## Test Configuration Summary

### Estate Planning Stages (12 stages)
1. **Maintenance** (805098) - 4 tasks
2. **I/V MEETING** (828078) - 4 tasks
3. **Drafting** (828768) - 6 tasks
4. **Pending Engagement** (828783) - 4 tasks (includes Attempt 1-3 sequence)
5. **Cancelled/No Show IV Meeting** (833223) - 5 tasks (includes Attempt 1-3-No Response)
6. **Cancelled/No Show Signing** (848343) - 5 tasks (includes Attempt 1-3-No Response)
7. **For Recording and Submission** (848358) - 4 tasks (includes dependent tasks)
8. **Did Not Engage** (896506) - 1 task
9. **Cancelled/No Show Design** (986242) - 4 tasks (includes Attempt 1-3-No Response)
10. **New D/S Meeting Booked / Drafting Parked** (1038727) - 4 tasks (includes Attempt 1-3-No Response)
11. **New D/S Meeting Booked / Drafting Parked** (1053877) - 4 tasks (duplicate stage ID, includes Attempt 1-3-No Response)
12. **Funding in Progress** (1110277) - 3 tasks (includes dependent task: task 1 → task 2)

### Probate Stages (15 stages)
1. **Formal Probate – Awaiting Orders** (805128) - 3 tasks
2. **Ready for Engagement** (896521) - 7 tasks
3. **Notice to Creditors** (897316) - 13 tasks
4. **Distribution** (897331) - 15 tasks
5. **Discharged** (897346) - 14 tasks
6. **Completed** (897361) - 1 task
7. **Inactive** (979462) - 2 tasks
8. **Engaged** (982372) - 4 tasks
9. **Summary Probate – Awaiting Orders** (982387) - 6 tasks
10. **Objections** (994897) - 5 tasks
11. **Drafting and Signing** (994927) - 6 tasks
12. **Court Interaction - Formal** (1081327) - 6 tasks
13. **Engaged - Trust Admin** (1126417) - 2 tasks
14. **Trust Admin** (1126432) - 14 tasks
15. **Court Interaction - Summary** (1141162) - 7 tasks

### Calendar Event Mappings (3 events)
1. **Initial Meeting** (334846) → IV Meeting stage (828078), uses_meeting_location: false
2. **Design Meeting** (334801) → Design stage (707058), uses_meeting_location: false
3. **Signing Meeting** (334816) → Signing Meeting stage (707073), uses_meeting_location: **true**

### Assignee Configurations (7 users)
1. **Breanna Canning** (357378676) - Attorney: Pam Baker (357292201)
2. **Brittany** (357380836) - Fund Table assignee
3. **Chelsea Engler** (358391543) - Location: Naples
4. **Jacqui** (357379471) - Attorney: 357520756, Fund Table: [357292201, 357387241]
5. **Jessica Maristany** (357379201) - Location: Fort Myers
6. **Kelly** (357168768) - Multiple attorneys
7. **Mackenzie McTevia** (357378916) - Location: Bonita Springs

### Location Keywords (8 locations)
- Bonita Springs, Bonita Springs Office
- Cape Coral, Cape Coral Office
- Fort Myers, Fort Myers Office
- Naples, Naples Office

### Task Completion Dependencies
**Attempt Sequences (3 stages with full sequences):**
1. Pending Engagement (828783): Attempt 1 → 2 → 3 (7 days each)
2. Cancelled/No Show IV Meeting (833223): Attempt 1 → 2 → 3 → No Response (7 days each)
3. Cancelled/No Show Signing (848343): Attempt 1 → 2 → 3 → No Response (7 days each)
4. Cancelled/No Show Design (986242): Attempt 1 → 2 → 3 → No Response (7 days each)
5. New D/S Meeting Booked (1038727 & 1053877): Attempt 1 → 2 → 3 → No Response (7 days each)

**Other Dependencies:**
- Drafting (828768): Task 3 completion → Task 4 & 5 created
- For Recording and Submission (848358): Task 2 → Task 3 → Task 4 (sequential)
- Funding in Progress (1110277): Task 1 → Task 2

---

## Test Execution Matrix

### Phase 1: Stage Change Tests (27 stages total)
**Objective:** Verify tasks are created correctly for each stage

| # | Stage Name | Stage ID | Practice Area | Tasks | Test Status |
|---|------------|----------|---------------|-------|-------------|
| 1 | Maintenance | 805098 | Estate | 4 | ⏳ Pending |
| 2 | I/V MEETING | 828078 | Estate | 4 | ⏳ Pending |
| 3 | Drafting | 828768 | Estate | 6 | ⏳ Pending |
| 4 | Pending Engagement | 828783 | Estate | 4 | ⏳ Pending |
| 5 | Cancelled/No Show IV | 833223 | Estate | 5 | ⏳ Pending |
| 6 | Cancelled/No Show Signing | 848343 | Estate | 5 | ⏳ Pending |
| 7 | For Recording | 848358 | Estate | 4 | ⏳ Pending |
| 8 | Did Not Engage | 896506 | Estate | 1 | ⏳ Pending |
| 9 | Cancelled/No Show Design | 986242 | Estate | 4 | ⏳ Pending |
| 10 | New D/S Booked (1038727) | 1038727 | Estate | 4 | ⏳ Pending |
| 11 | New D/S Booked (1053877) | 1053877 | Estate | 4 | ⏳ Pending |
| 12 | Funding in Progress | 1110277 | Estate | 3 | ⏳ Pending |
| 13 | Formal Probate Orders | 805128 | Probate | 3 | ⏳ Pending |
| 14 | Ready for Engagement | 896521 | Probate | 7 | ⏳ Pending |
| 15 | Notice to Creditors | 897316 | Probate | 13 | ⏳ Pending |
| 16 | Distribution | 897331 | Probate | 15 | ⏳ Pending |
| 17 | Discharged | 897346 | Probate | 14 | ⏳ Pending |
| 18 | Completed | 897361 | Probate | 1 | ⏳ Pending |
| 19 | Inactive | 979462 | Probate | 2 | ⏳ Pending |
| 20 | Engaged | 982372 | Probate | 4 | ⏳ Pending |
| 21 | Summary Probate Orders | 982387 | Probate | 6 | ⏳ Pending |
| 22 | Objections | 994897 | Probate | 5 | ⏳ Pending |
| 23 | Drafting and Signing | 994927 | Probate | 6 | ⏳ Pending |
| 24 | Court - Formal | 1081327 | Probate | 6 | ⏳ Pending |
| 25 | Engaged - Trust Admin | 1126417 | Probate | 2 | ⏳ Pending |
| 26 | Trust Admin | 1126432 | Probate | 14 | ⏳ Pending |
| 27 | Court - Summary | 1141162 | Probate | 7 | ⏳ Pending |

### Phase 2: Calendar Event Tests (6 tests)
**Objective:** Verify calendar events create/update tasks with correct due dates

| # | Event Type | Stage | Meeting Location | Test Scenario | Test Status |
|---|------------|-------|------------------|---------------|-------------|
| 1 | Initial Meeting | IV Meeting | Matter location | Create event BEFORE stage change | ⏳ Pending |
| 2 | Initial Meeting | IV Meeting | Matter location | Create event AFTER stage change | ⏳ Pending |
| 3 | Design Meeting | Design | Matter location | Create event BEFORE stage change | ⏳ Pending |
| 4 | Design Meeting | Design | Matter location | Create event AFTER stage change | ⏳ Pending |
| 5 | Signing Meeting | Signing Meeting | **Meeting location** | Create event BEFORE stage change | ⏳ Pending |
| 6 | Signing Meeting | Signing Meeting | **Meeting location** | Create event AFTER stage change | ⏳ Pending |

### Phase 3: Task Completion Dependency Tests (8 tests)
**Objective:** Verify task completion triggers dependent tasks

| # | Stage | Dependency Type | Test Scenario | Test Status |
|---|-------|-----------------|---------------|-------------|
| 1 | Pending Engagement | Attempt Sequence | Complete Attempt 1 → Creates Attempt 2 | ⏳ Pending |
| 2 | Pending Engagement | Attempt Sequence | Complete Attempt 2 → Creates Attempt 3 | ⏳ Pending |
| 3 | Cancelled/No Show IV | Attempt + No Response | Complete Attempt 3 → Creates No Response | ⏳ Pending |
| 4 | Drafting | After Task | Complete Task 3 → Creates Task 4 & 5 | ⏳ Pending |
| 5 | For Recording | Sequential | Complete Task 2 → Creates Task 3 | ⏳ Pending |
| 6 | For Recording | Sequential | Complete Task 3 → Creates Task 4 | ⏳ Pending |
| 7 | Funding in Progress | After Task | Complete Task 1 → Creates Task 2 | ⏳ Pending |
| 8 | Cancelled/No Show Signing | Full Sequence | Complete Attempt 1 → 2 → 3 → No Response | ⏳ Pending |

### Phase 4: Edge Case Tests (10 tests)
**Objective:** Test boundary conditions and error scenarios

| # | Test Case | Expected Behavior | Test Status |
|---|-----------|-------------------|-------------|
| 1 | Rollback within 3 min | Stage A → B → A (within 3 min) → Deletes B tasks | ⏳ Pending |
| 2 | Duplicate webhook | Send same webhook twice → Only processes once (idempotency) | ⏳ Pending |
| 3 | Weekend due date | Task due on Saturday → Shifts to Monday | ⏳ Pending |
| 4 | Matter with no location | CSC task → Logs error, continues | ⏳ Pending |
| 5 | Matter with no attorney | ATTORNEY task → Creates error task | ⏳ Pending |
| 6 | Meeting with no location (signing) | Signing meeting → Creates error task | ⏳ Pending |
| 7 | Invalid location keyword | Location="Unknown City" → Logs error | ⏳ Pending |
| 8 | Task with null task_number | Document task → Creates successfully | ⏳ Pending |
| 9 | Concurrent stage changes | Two webhooks same time → Both process correctly | ⏳ Pending |
| 10 | Test mode filter | Non-test matter → Skipped | ⏳ Pending |

### Phase 5: Document Creation Tests (3 tests)
**Objective:** Verify document upload triggers task creation

| # | Test Scenario | Expected Behavior | Test Status |
|---|---------------|-------------------|-------------|
| 1 | Upload document with name | Creates task "New Clio Drive Document Save to OD" with description "New document: {name}" | ⏳ Pending |
| 2 | Upload document without name | Creates task with description "New document: Unknown Document" | ⏳ Pending |
| 3 | Upload document without matter | Skipped, logs error | ⏳ Pending |

### Phase 6: Location/Attorney Variation Tests (10 tests)
**Objective:** Test all assignee resolution types

| # | Matter Configuration | Assignee Type | Expected Result | Test Status |
|---|---------------------|---------------|-----------------|-------------|
| 1 | Location: Fort Myers | CSC | Assigns to Jessica Maristany (357379201) | ⏳ Pending |
| 2 | Location: Naples | CSC | Assigns to Chelsea Engler (358391543) | ⏳ Pending |
| 3 | Location: Bonita Springs | CSC | Assigns to Mackenzie McTevia (357378916) | ⏳ Pending |
| 4 | Attorney: Pam Baker | PARALEGAL | Assigns to Breanna Canning (357378676) | ⏳ Pending |
| 5 | Attorney: Any | ATTORNEY | Assigns to matter attorney | ⏳ Pending |
| 6 | Fund Table: 357292201 | FUND TABLE | Assigns to Jacqui (357379471) | ⏳ Pending |
| 7 | Assignee: VA | VA | Assigns to Jacqui (357379471) | ⏳ Pending |
| 8 | Assignee: 357379471 | Direct ID | Assigns to Jacqui | ⏳ Pending |
| 9 | Signing Meeting - Location: "123 Main St, Naples, FL" | CSC (meeting location) | Extracts "Naples" → Assigns to Chelsea | ⏳ Pending |
| 10 | Signing Meeting - Location: "Fort Myers Office" | CSC (meeting location) | Extracts "Fort Myers" → Assigns to Jessica | ⏳ Pending |

### Phase 7: Empty/Missing Data Tests (7 tests)
**Objective:** Test error handling for missing required data

| # | Test Case | Expected Behavior | Test Status |
|---|-----------|-------------------|-------------|
| 1 | Matter with no location (CSC task) | Logs ASSIGNEE_NO_CSC error, skips task | ⏳ Pending |
| 2 | Matter with no attorney (ATTORNEY task) | Creates error task for matter | ⏳ Pending |
| 3 | Matter with no attorney (PARALEGAL task) | Logs ASSIGNEE_NO_PARALEGAL error | ⏳ Pending |
| 4 | Calendar event with no meeting date | Logs error, skips processing | ⏳ Pending |
| 5 | Calendar event with no matter | Skipped, returns "no_matter" | ⏳ Pending |
| 6 | Task webhook with no matter | Logs error, skips processing | ⏳ Pending |
| 7 | Document with no matter | Logs error, skips processing | ⏳ Pending |

---

## Test Execution Protocol

### Before Each Test:
1. Run `node test-cleanup.mjs` to clear all data
2. Verify matter 1675950832 exists in Clio
3. Note current matter stage

### During Test:
1. Perform test action (stage change, calendar event, task completion, etc.)
2. Wait 5 seconds for webhook processing
3. Verify results in Clio and Supabase

### After Test:
1. Document results (pass/fail)
2. Note any errors or unexpected behavior
3. Screenshot tasks created (if applicable)

### Test Result Codes:
- ✅ **PASS** - Test executed successfully, all expected results confirmed
- ❌ **FAIL** - Test failed, unexpected behavior or errors
- ⚠️ **PARTIAL** - Test partially successful, some issues noted
- ⏭️ **SKIP** - Test skipped (not applicable or blocked)
- ⏳ **PENDING** - Test not yet executed

---

## Success Criteria

### Overall Test Suite Success:
- ✅ All stage tests pass (27/27)
- ✅ All calendar event tests pass (6/6)
- ✅ All task completion tests pass (8/8)
- ✅ Edge cases handled correctly (8/10 minimum)
- ✅ Document creation works (3/3)
- ✅ All assignee variations work (10/10)
- ✅ Missing data errors logged correctly (7/7)

### Individual Test Success:
- Tasks created in Clio match template count
- Task names, descriptions match templates
- Due dates calculated correctly (weekends shifted)
- Assignees resolved correctly
- Data recorded in Supabase
- Idempotency working (no duplicates)
- Errors logged in error_logs table

---

## Test Execution Timeline

**Estimated Duration:** 4-6 hours

- Phase 1 (Stage Tests): ~2 hours (27 tests × 3-5 min each)
- Phase 2 (Calendar Tests): ~30 minutes (6 tests × 5 min each)
- Phase 3 (Task Completion): ~40 minutes (8 tests × 5 min each)
- Phase 4 (Edge Cases): ~50 minutes (10 tests × 5 min each)
- Phase 5 (Documents): ~15 minutes (3 tests × 5 min each)
- Phase 6 (Location/Attorney): ~50 minutes (10 tests × 5 min each)
- Phase 7 (Missing Data): ~35 minutes (7 tests × 5 min each)

**Total Tests:** 71 individual test cases

---

## Notes

- All tests use matter ID: **1675950832**
- Test mode is ENABLED in .env (TEST_MODE=true)
- Cleanup script must run before each test
- Matter practice area will be toggled between "Estate Planning" and "Probate" as needed
- Some stages may not have templates - these will be documented as expected behavior
