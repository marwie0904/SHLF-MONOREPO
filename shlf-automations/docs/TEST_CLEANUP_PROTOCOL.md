# Test Cleanup Protocol

## 🚨 CRITICAL SAFETY RULES

### ⚠️ DELETION RESTRICTIONS
**ONLY delete records for test matter ID: 1675950832**

**NEVER delete records for other matter IDs!**

### Safety Checks Before Any Deletion
```javascript
const TEST_MATTER_ID = '1675950832';

// ALWAYS validate matter ID before deletion
function validateTestMatter(matterId) {
  if (matterId !== TEST_MATTER_ID) {
    throw new Error(`SAFETY CHECK FAILED: Cannot delete records for matter ${matterId}. Only ${TEST_MATTER_ID} allowed.`);
  }
  return true;
}
```

---

## 🧹 Cleanup Operations

### 1. Supabase Record Cleanup
Delete test-related records from Supabase tables (TEST MATTER ONLY).

#### Tables to Clean:
1. **matters-tasks-generated**
   - Contains task records created by automations
   - Linked to matter_id and task_id (Clio)

2. **matters-meetings-booked**
   - Contains calendar event records
   - Linked to matter_id and calendar_event_id

3. **webhook_events**
   - Contains webhook processing history
   - Linked to resource_id (matter_id)

4. **error_logs**
   - Contains error records
   - Linked to matter_id

5. **matters_stage_history**
   - Contains stage change history
   - Linked to matter_id

#### Cleanup Function:
```javascript
async function cleanupSupabaseRecords(matterId) {
  // SAFETY CHECK
  validateTestMatter(matterId);

  console.log(`🧹 Cleaning Supabase records for matter ${matterId}...`);

  // Delete in reverse dependency order
  const tables = [
    'matters-tasks-generated',
    'matters-meetings-booked',
    'webhook_events',
    'error_logs',
    'matters_stage_history'
  ];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .delete()
      .eq('matter_id', matterId);

    if (error) {
      console.error(`Error cleaning ${table}:`, error.message);
    } else {
      console.log(`✅ Cleaned ${table}`);
    }
  }
}
```

---

### 2. Clio Record Cleanup
Delete test-related records from Clio (TEST MATTER ONLY).

#### Clio Resources to Clean:
1. **Tasks**
   - All tasks created for test matter
   - DELETE /api/v4/tasks/{id}

2. **Calendar Entries**
   - All calendar entries created for test matter
   - DELETE /api/v4/calendar_entries/{id}

#### Cleanup Function:
```javascript
async function cleanupClioRecords(matterId) {
  // SAFETY CHECK
  validateTestMatter(matterId);

  console.log(`🧹 Cleaning Clio records for matter ${matterId}...`);

  // 1. Delete all tasks for this matter
  const tasks = await ClioService.getTasksForMatter(matterId);
  console.log(`Found ${tasks.length} tasks to delete`);

  for (const task of tasks) {
    try {
      await ClioService.deleteTask(task.id);
      console.log(`✅ Deleted task ${task.id}: ${task.name}`);
      await sleep(100); // Rate limiting
    } catch (error) {
      console.error(`Error deleting task ${task.id}:`, error.message);
    }
  }

  // 2. Delete all calendar entries for this matter
  const calendarEntries = await ClioService.getCalendarEntriesForMatter(matterId);
  console.log(`Found ${calendarEntries.length} calendar entries to delete`);

  for (const entry of calendarEntries) {
    try {
      await ClioService.deleteCalendarEntry(entry.id);
      console.log(`✅ Deleted calendar entry ${entry.id}`);
      await sleep(100); // Rate limiting
    } catch (error) {
      console.error(`Error deleting calendar entry ${entry.id}:`, error.message);
    }
  }
}
```

---

### 3. Full Test Cleanup Sequence

#### Before Each Test:
```javascript
async function setupTest(testName, matterId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 SETTING UP: ${testName}`);
  console.log(`${'='.repeat(80)}\n`);

  // SAFETY CHECK
  validateTestMatter(matterId);

  // Step 1: Clean Clio records (tasks & calendar entries)
  await cleanupClioRecords(matterId);

  // Step 2: Clean Supabase records
  await cleanupSupabaseRecords(matterId);

  // Step 3: Wait for cleanup to settle
  await sleep(2000);

  // Step 4: Capture baseline state
  const baseline = await captureBaseline(matterId);

  console.log(`✅ Test setup complete. Matter ${matterId} is clean.\n`);
  return baseline;
}
```

#### After Each Test:
```javascript
async function teardownTest(testName, matterId, cleanup = true) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧹 TEARING DOWN: ${testName}`);
  console.log(`${'='.repeat(80)}\n`);

  // SAFETY CHECK
  validateTestMatter(matterId);

  if (cleanup) {
    // Optional: Clean up after test
    // (May want to keep records for inspection)
    await cleanupClioRecords(matterId);
    await cleanupSupabaseRecords(matterId);
  } else {
    console.log(`⏭️  Skipping cleanup (records preserved for inspection)`);
  }

  console.log(`✅ Test teardown complete.\n`);
}
```

---

## 📋 Test Execution Pattern

### Standard Test Template:
```javascript
async function testStageChange(stageId, stageName) {
  const testName = `Stage Change: ${stageName} (${stageId})`;
  const matterId = TEST_CONFIG.MATTER_ID;

  // SAFETY CHECK - First thing in every test
  validateTestMatter(matterId);

  try {
    // 1. SETUP (with cleanup)
    const baseline = await setupTest(testName, matterId);

    // 2. EXECUTE TEST
    console.log(`Changing matter ${matterId} to stage ${stageId}...`);
    const updatedMatter = await ClioService.changeMatterStage(matterId, stageId);

    // Send webhook
    const webhookEvent = await webhookGenerator.sendAndWaitForMatterWebhook(updatedMatter);

    // 3. VALIDATE RESULTS
    await sleep(2000);
    const tasks = await supabaseAPI.getTasksForMatter(matterId);

    // Validate task count, due dates, assignees, etc.
    validateTasks(tasks, stageId);

    console.log(`✅ ${testName} PASSED`);

    // 4. TEARDOWN (with cleanup)
    await teardownTest(testName, matterId, true);

    return { passed: true };
  } catch (error) {
    console.error(`❌ ${testName} FAILED:`, error.message);

    // Cleanup even on failure
    await teardownTest(testName, matterId, true);

    return { passed: false, error: error.message };
  }
}
```

---

## 🔒 Safety Validation Functions

### Matter ID Validator:
```javascript
function validateTestMatter(matterId) {
  const TEST_MATTER_ID = '1675950832';

  if (!matterId) {
    throw new Error('SAFETY CHECK FAILED: Matter ID is required');
  }

  if (matterId.toString() !== TEST_MATTER_ID) {
    throw new Error(
      `SAFETY CHECK FAILED: Cannot operate on matter ${matterId}. ` +
      `Only test matter ${TEST_MATTER_ID} is allowed.`
    );
  }

  return true;
}
```

### Deletion Validator:
```javascript
async function safeDeleteFromSupabase(table, matterId) {
  // SAFETY CHECK
  validateTestMatter(matterId);

  console.log(`🗑️  Deleting from ${table} where matter_id = ${matterId}`);

  const { data, error, count } = await supabase
    .from(table)
    .delete()
    .eq('matter_id', matterId)
    .select();

  if (error) {
    throw new Error(`Failed to delete from ${table}: ${error.message}`);
  }

  console.log(`✅ Deleted ${data?.length || 0} records from ${table}`);
  return data;
}

async function safeDeleteFromClio(resource, resourceId, matterId) {
  // SAFETY CHECK
  validateTestMatter(matterId);

  console.log(`🗑️  Deleting ${resource} ${resourceId} (matter: ${matterId})`);

  // Additional safety: Verify resource belongs to test matter
  const resourceData = await ClioService.getResource(resource, resourceId);
  if (resourceData.matter?.id.toString() !== matterId) {
    throw new Error(
      `SAFETY CHECK FAILED: ${resource} ${resourceId} belongs to matter ` +
      `${resourceData.matter?.id}, not test matter ${matterId}`
    );
  }

  await ClioService.deleteResource(resource, resourceId);
  console.log(`✅ Deleted ${resource} ${resourceId}`);
}
```

---

## 📊 Cleanup Utilities for Test Suite

### Utility File: `tests/utils/test-cleanup.js`
```javascript
import { ClioService } from '../../src/services/clio.js';
import { supabase } from '../../src/services/supabase.js';
import { TEST_CONFIG, sleep, log } from '../test-config.js';

const TEST_MATTER_ID = TEST_CONFIG.MATTER_ID;

export class TestCleanup {
  /**
   * Validate that we're only operating on test matter
   */
  static validateTestMatter(matterId) {
    if (!matterId || matterId.toString() !== TEST_MATTER_ID) {
      throw new Error(
        `SAFETY: Can only clean matter ${TEST_MATTER_ID}, got ${matterId}`
      );
    }
  }

  /**
   * Delete all Supabase records for test matter
   */
  static async cleanSupabase(matterId) {
    this.validateTestMatter(matterId);

    const tables = [
      'matters-tasks-generated',
      'matters-meetings-booked',
      'webhook_events',
      'error_logs',
      'matters_stage_history'
    ];

    let totalDeleted = 0;

    for (const table of tables) {
      const { error, count } = await supabase
        .from(table)
        .delete()
        .eq('matter_id', matterId);

      if (!error) {
        log(`✅ Cleaned ${table} (${count || 0} records)`);
        totalDeleted += count || 0;
      }
    }

    return totalDeleted;
  }

  /**
   * Delete all Clio tasks for test matter
   */
  static async cleanClioTasks(matterId) {
    this.validateTestMatter(matterId);

    const tasks = await ClioService.getTasksForMatter(matterId);

    for (const task of tasks) {
      // Verify task belongs to test matter
      if (task.matter?.id.toString() === matterId) {
        await ClioService.deleteTask(task.id);
        await sleep(100);
      }
    }

    return tasks.length;
  }

  /**
   * Delete all Clio calendar entries for test matter
   */
  static async cleanClioCalendar(matterId) {
    this.validateTestMatter(matterId);

    const entries = await ClioService.getCalendarEntriesForMatter(matterId);

    for (const entry of entries) {
      // Verify entry belongs to test matter
      if (entry.matter?.id.toString() === matterId) {
        await ClioService.deleteCalendarEntry(entry.id);
        await sleep(100);
      }
    }

    return entries.length;
  }

  /**
   * Full cleanup - Supabase + Clio
   */
  static async cleanAll(matterId) {
    this.validateTestMatter(matterId);

    log(`🧹 Starting full cleanup for matter ${matterId}...`);

    const results = {
      clioTasks: await this.cleanClioTasks(matterId),
      clioCalendar: await this.cleanClioCalendar(matterId),
      supabase: await this.cleanSupabase(matterId)
    };

    log(`✅ Cleanup complete:`, results);

    await sleep(1000); // Let deletions settle

    return results;
  }
}
```

---

## 🎯 Updated Test Execution Flow

### Each Test Will:
1. ✅ **Validate Matter ID** - Ensure it's 1675950832
2. ✅ **Clean Clio Tasks** - Delete all tasks for test matter
3. ✅ **Clean Clio Calendar** - Delete all calendar entries for test matter
4. ✅ **Clean Supabase** - Delete all records for test matter
5. ✅ **Wait for Settlement** - 1-2 second delay
6. ✅ **Capture Baseline** - Record clean state
7. ✅ **Execute Test** - Run the actual test
8. ✅ **Validate Results** - Check outcomes
9. ✅ **Cleanup After** - Optional post-test cleanup

### Safety Guarantees:
- ✅ Every deletion validates matter ID first
- ✅ Every Clio deletion verifies resource belongs to test matter
- ✅ Every Supabase deletion uses WHERE matter_id = '1675950832'
- ✅ No wildcards or broad deletions allowed
- ✅ All cleanup operations are logged

---

## 📝 Integration with Test Suites

### Update test-config.js:
```javascript
export const TEST_CONFIG = {
  MATTER_ID: '1675950832',

  // Safety settings
  SAFETY: {
    VALIDATE_MATTER_ID: true,
    ALLOW_CLEANUP: true,
    CLEANUP_AFTER_EACH_TEST: true,
  },

  // ... rest of config
};
```

### Update each test file:
```javascript
import { TestCleanup } from '../utils/test-cleanup.js';

export class StageChangeTests {
  async test01_StageChange() {
    const matterId = TEST_CONFIG.MATTER_ID;

    // SETUP with cleanup
    await TestCleanup.cleanAll(matterId);

    // TEST logic here...

    // TEARDOWN with cleanup
    await TestCleanup.cleanAll(matterId);
  }
}
```

---

## ✅ Cleanup Checklist

Before running test suite:
- [ ] Verify TEST_MATTER_ID is set correctly (1675950832)
- [ ] Verify safety checks are in place
- [ ] Verify cleanup functions validate matter ID
- [ ] Test cleanup on isolated test first
- [ ] Review deletion logs to ensure only test matter affected

During test execution:
- [ ] Monitor logs for safety check confirmations
- [ ] Verify only test matter records are deleted
- [ ] Check for any errors in cleanup operations

After test execution:
- [ ] Review final state of test matter
- [ ] Verify no records leaked to other matters
- [ ] Check Supabase tables are clean
- [ ] Check Clio tasks/calendar are clean
