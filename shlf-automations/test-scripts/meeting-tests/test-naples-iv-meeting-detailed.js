/**
 * Detailed test for Naples I/V MEETING stage
 * With extended delays and proper location verification
 */

import { ClioService } from './src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const TEST_MATTER_ID = 1675950832;
const NAPLES_ATTORNEY_ID = 357380836;
const IV_MEETING_STAGE_ID = 828078;
const DRAFTING_STAGE_ID = 828768; // Temporary stage to force a change
const NAPLES_LOCATION = 'Naples';

async function wait(ms) {
  console.log(`   ⏳ Waiting ${ms / 1000} seconds...`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testNaplesIVMeetingDetailed() {
  console.log('\n🧪 DETAILED TEST: Naples I/V MEETING Stage\n');
  console.log('='.repeat(80));

  try {
    // ==================== STEP 1: Get Current State ====================
    console.log(`\n📋 STEP 1: Fetching matter ${TEST_MATTER_ID} current state...\n`);

    let matter = await ClioService.getMatter(TEST_MATTER_ID);

    console.log('   Current Matter Details:');
    console.log(`   - Stage: ${matter.matter_stage?.name || 'Unknown'} (ID: ${matter.matter_stage?.id || 'N/A'})`);
    console.log(`   - Practice Area: ${matter.practice_area?.name || 'Unknown'} (ID: ${matter.practice_area?.id || 'N/A'})`);
    console.log(`   - Responsible Attorney: ${matter.responsible_attorney?.name || 'Unknown'} (ID: ${matter.responsible_attorney?.id || 'N/A'})`);
    console.log(`   - Status: ${matter.status || 'Unknown'}`);

    // Find location custom field
    const locationField = matter.custom_field_values?.find(f =>
      f.field_name === 'Location' ||
      f.custom_field?.name === 'Location'
    );

    const currentLocation = locationField?.value || locationField?.display_value || 'Not set';
    console.log(`   - Location Custom Field: ${currentLocation}`);
    console.log(`   - Location Field ID: ${locationField?.id || 'Not found'}`);
    console.log(`   - Location Field Type: ${locationField?.field_type || 'Unknown'}`);

    await wait(3000);

    // ==================== STEP 2: Update Location to Naples ====================
    console.log(`\n🔄 STEP 2: Setting location to Naples...\n`);

    if (currentLocation !== NAPLES_LOCATION) {
      if (locationField?.id) {
        console.log(`   Updating location from "${currentLocation}" to "${NAPLES_LOCATION}"...`);

        try {
          // Try updating the custom field value
          const updateData = {
            custom_field_values: [
              {
                id: locationField.id,
                value: NAPLES_LOCATION
              }
            ]
          };

          await ClioService.updateMatter(TEST_MATTER_ID, updateData);
          console.log('   ✅ Location update request sent');

          await wait(5000);

          // Verify location was updated
          matter = await ClioService.getMatter(TEST_MATTER_ID);
          const updatedLocationField = matter.custom_field_values?.find(f =>
            f.field_name === 'Location' ||
            f.custom_field?.name === 'Location'
          );
          const verifyLocation = updatedLocationField?.value || updatedLocationField?.display_value || 'Not set';

          console.log(`   ✓ Verified location: ${verifyLocation}`);

          if (verifyLocation !== NAPLES_LOCATION) {
            console.log(`   ⚠️  WARNING: Location still shows as "${verifyLocation}", not "${NAPLES_LOCATION}"`);
          }
        } catch (err) {
          console.log(`   ⚠️  Could not update location: ${err.message}`);
          console.log(`   Continuing with current location: ${currentLocation}`);
        }
      } else {
        console.log(`   ⚠️  Location custom field not found - cannot update`);
      }
    } else {
      console.log(`   ✓ Location already set to Naples`);
    }

    await wait(3000);

    // ==================== STEP 3: Update Responsible Attorney to Naples Attorney ====================
    console.log(`\n👤 STEP 3: Setting responsible attorney to Naples attorney...\n`);

    const currentAttorneyId = matter.responsible_attorney?.id;
    console.log(`   Current attorney ID: ${currentAttorneyId}`);
    console.log(`   Target attorney ID: ${NAPLES_ATTORNEY_ID}`);

    if (currentAttorneyId !== NAPLES_ATTORNEY_ID) {
      console.log(`   Updating responsible attorney...`);

      await ClioService.updateMatter(TEST_MATTER_ID, {
        responsible_attorney: { id: NAPLES_ATTORNEY_ID }
      });

      console.log('   ✅ Attorney update request sent');

      await wait(5000);

      // Verify attorney was updated
      matter = await ClioService.getMatter(TEST_MATTER_ID);
      const verifyAttorneyId = matter.responsible_attorney?.id;
      const verifyAttorneyName = matter.responsible_attorney?.name;

      console.log(`   ✓ Verified attorney: ${verifyAttorneyName} (ID: ${verifyAttorneyId})`);
    } else {
      console.log(`   ✓ Attorney already correct`);
    }

    await wait(3000);

    // ==================== STEP 4: Move to Different Stage First ====================
    console.log(`\n🔄 STEP 4: Moving matter to DRAFTING stage (to trigger a change)...\n`);

    const currentStageId = matter.matter_stage?.id;
    console.log(`   Current stage: ${matter.matter_stage?.name} (${currentStageId})`);

    // Only move to Drafting if we're not already there
    if (currentStageId !== DRAFTING_STAGE_ID) {
      console.log(`   Moving to DRAFTING stage (${DRAFTING_STAGE_ID})...`);

      await ClioService.updateMatter(TEST_MATTER_ID, {
        matter_stage: { id: DRAFTING_STAGE_ID }
      });

      console.log('   ✅ Stage update request sent to Clio');

      await wait(5000);

      // Verify stage was updated
      matter = await ClioService.getMatter(TEST_MATTER_ID);
      console.log(`   ✓ Verified stage: ${matter.matter_stage?.name} (${matter.matter_stage?.id})`);
    } else {
      console.log(`   ✓ Already in DRAFTING stage`);
    }

    await wait(3000);

    // ==================== STEP 5: Move to I/V MEETING Stage ====================
    console.log(`\n🔄 STEP 5: Moving matter to I/V MEETING stage...\n`);

    console.log(`   Current stage: ${matter.matter_stage?.name} (${matter.matter_stage?.id})`);
    console.log(`   Target stage: I/V MEETING (${IV_MEETING_STAGE_ID})`);

    await ClioService.updateMatter(TEST_MATTER_ID, {
      matter_stage: { id: IV_MEETING_STAGE_ID }
    });

    console.log('   ✅ Stage update request sent to Clio');

    await wait(5000);

    // Verify stage was updated
    matter = await ClioService.getMatter(TEST_MATTER_ID);
    console.log(`   ✓ Verified stage: ${matter.matter_stage?.name} (${matter.matter_stage?.id})`);

    // ==================== STEP 6: Wait for Webhook Processing ====================
    console.log(`\n⏳ STEP 6: Waiting for webhook and automation to process...\n`);
    console.log('   This includes:');
    console.log('   - Clio sending webhook to our server');
    console.log('   - Server processing the webhook');
    console.log('   - Loading task templates');
    console.log('   - Creating tasks in Clio');
    console.log('   - Recording tasks in Supabase');

    await wait(45000); // 45 seconds - much longer delay

    // ==================== STEP 7: Check Supabase for Generated Tasks ====================
    console.log(`\n📋 STEP 7: Checking Supabase for generated tasks...\n`);

    const { data: supabaseTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID)
      .eq('stage_id', IV_MEETING_STAGE_ID)
      .order('task_number', { ascending: true });

    if (tasksError) {
      console.error('   ❌ Error fetching tasks from Supabase:', tasksError);
    } else if (!supabaseTasks || supabaseTasks.length === 0) {
      console.log('   ⚠️  No tasks found in Supabase');
    } else {
      console.log(`   ✓ Found ${supabaseTasks.length} task(s) in Supabase:`);

      // Fetch actual assignee names from Clio
      for (const task of supabaseTasks) {
        let assigneeName = task.assigned_user || 'Not assigned';

        if (task.task_id) {
          try {
            const clioTask = await ClioService.getTask(task.task_id);
            if (clioTask.assignee?.name) {
              assigneeName = clioTask.assignee.name;
            }
          } catch (err) {
            // Keep the stored name if Clio fetch fails
          }
        }

        console.log(`      - Task ${task.task_number}: ${task.task_name}`);
        console.log(`        Assigned: ${assigneeName}`);
        console.log(`        Task ID: ${task.task_id || 'No Clio ID'}`);
      }
    }

    // ==================== STEP 8: Final Summary ====================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 FINAL SUMMARY:\n');

    const finalMatter = await ClioService.getMatter(TEST_MATTER_ID);
    const finalLocationField = finalMatter.custom_field_values?.find(f =>
      f.field_name === 'Location' ||
      f.custom_field?.name === 'Location'
    );
    const finalLocation = finalLocationField?.value || finalLocationField?.display_value || 'Not set';

    console.log(`   Matter Configuration:`);
    console.log(`   - Stage: ${finalMatter.matter_stage?.name} (${finalMatter.matter_stage?.id})`);
    console.log(`   - Location: ${finalLocation}`);
    console.log(`   - Attorney: ${finalMatter.responsible_attorney?.name} (${finalMatter.responsible_attorney?.id})`);
    console.log(`   - Practice Area: ${finalMatter.practice_area?.name}`);
    console.log('');

    if (supabaseTasks && supabaseTasks.length > 0) {
      console.log(`   ✅ SUCCESS: ${supabaseTasks.length} task(s) generated`);
    } else {
      console.log(`   ❌ FAILED: No tasks generated`);
      console.log('');
      console.log('   Possible causes:');
      console.log('   1. No task templates exist for Naples + I/V MEETING combination');
      console.log('   2. Automation server is not running');
      console.log('   3. Webhook failed to fire or process');
      console.log('   4. Location filter is blocking Naples tasks');
      console.log('   5. Webhook processing took longer than 45 seconds');
      console.log('   6. Task templates may require specific location field value');
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ Test completed\n');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
  }
}

testNaplesIVMeetingDetailed();
