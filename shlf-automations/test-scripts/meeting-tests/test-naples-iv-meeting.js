/**
 * Specific test for Naples I/V MEETING stage
 * Testing why no tasks were generated
 */

import { ClioService } from './src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const TEST_MATTER_ID = 1675950832;
const NAPLES_ATTORNEY_ID = 357380836;
const IV_MEETING_STAGE_ID = 828078;
const NAPLES_LOCATION = 'Naples';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testNaplesIVMeeting() {
  console.log('\n🧪 Testing Naples I/V MEETING Stage\n');
  console.log('='.repeat(70));

  try {
    // 1. Get current matter details
    console.log(`\n📋 Step 1: Fetching matter ${TEST_MATTER_ID} details...`);
    const matter = await ClioService.getMatter(TEST_MATTER_ID);
    console.log(`   Current stage: ${matter.matter_stage?.name || 'Unknown'} (ID: ${matter.matter_stage?.id || 'N/A'})`);
    console.log(`   Practice area: ${matter.practice_area?.name || 'Unknown'} (ID: ${matter.practice_area?.id || 'N/A'})`);
    console.log(`   Responsible attorney: ${matter.responsible_attorney?.name || 'Unknown'} (ID: ${matter.responsible_attorney?.id || 'N/A'})`);

    const location = matter.custom_field_values?.find(f => f.field_name === 'Location')?.value;
    console.log(`   Location: ${location || 'Unknown'}`);

    // 2. Check task templates for this stage
    console.log(`\n📋 Step 2: Checking task templates for I/V MEETING stage...`);
    const { data: templates, error: templateError } = await supabase
      .from('task_templates')
      .select('*')
      .eq('stage_id', IV_MEETING_STAGE_ID)
      .order('task_number', { ascending: true });

    if (templateError) {
      console.error('   ❌ Error fetching templates:', templateError);
    } else if (!templates || templates.length === 0) {
      console.log('   ⚠️  No task templates found for stage 828078 (I/V MEETING)');
      console.log('   This explains why no tasks were generated!');
    } else {
      console.log(`   ✓ Found ${templates.length} task template(s) for this stage:`);
      templates.forEach((template, i) => {
        console.log(`\n   Template ${i + 1}:`);
        console.log(`      Task Number: ${template.task_number}`);
        console.log(`      Task Name: ${template.task_name}`);
        console.log(`      Assigned To: ${template.assigned_to || 'Not specified'}`);
        console.log(`      Location Filter: ${template.location || 'All locations'}`);
        console.log(`      Practice Area: ${template.practice_area || 'Not specified'}`);
        console.log(`      Assign to Responsible Attorney: ${template.assign_to_responsible_attorney || false}`);
      });
    }

    // 3. Clean up existing tasks for this matter
    console.log(`\n🧹 Step 3: Cleaning up existing tasks for matter ${TEST_MATTER_ID}...`);

    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID);

    if (existingTasks && existingTasks.length > 0) {
      console.log(`   Found ${existingTasks.length} existing tasks to clean up`);

      for (const task of existingTasks) {
        if (task.task_id) {
          try {
            await ClioService.deleteTask(task.task_id);
            console.log(`   ✓ Deleted from Clio: ${task.task_name}`);
          } catch (err) {
            if (err.response?.status !== 404) {
              console.log(`   ⚠️  Could not delete from Clio: ${task.task_name}`);
            }
          }
        }
      }

      await supabase
        .from('tasks')
        .delete()
        .eq('matter_id', TEST_MATTER_ID);

      console.log('   ✓ Cleaned up Supabase tasks');
    } else {
      console.log('   ✓ No existing tasks to clean up');
    }

    // 4. Update matter to Naples location and I/V MEETING stage
    console.log(`\n🔄 Step 4: Setting matter to Naples + I/V MEETING stage...`);

    // First, update location if needed
    if (location !== NAPLES_LOCATION) {
      console.log(`   Updating location from "${location}" to "${NAPLES_LOCATION}"...`);
      const locationField = matter.custom_field_values?.find(f => f.field_name === 'Location');
      if (locationField) {
        try {
          await ClioService.updateMatterCustomField(TEST_MATTER_ID, {
            id: locationField.id,
            field_name: 'Location',
            value: NAPLES_LOCATION
          });
          console.log('   ✓ Location updated');
        } catch (err) {
          console.log(`   ⚠️  Could not update location: ${err.message}`);
        }
      }
    }

    // Update stage
    await ClioService.updateMatter(TEST_MATTER_ID, {
      matter_stage: { id: IV_MEETING_STAGE_ID }
    });
    console.log('   ✓ Stage updated to I/V MEETING (828078)');

    // 5. Wait for webhook to process
    console.log(`\n⏳ Step 5: Waiting 30 seconds for automation to process...`);
    await wait(30000);

    // 6. Check for generated tasks
    console.log(`\n📋 Step 6: Checking for generated tasks...`);
    const { data: generatedTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('matter_id', TEST_MATTER_ID)
      .eq('stage_id', IV_MEETING_STAGE_ID)
      .order('task_number', { ascending: true });

    if (tasksError) {
      console.error('   ❌ Error fetching tasks:', tasksError);
    } else if (!generatedTasks || generatedTasks.length === 0) {
      console.log('\n   ❌ NO TASKS GENERATED');
      console.log('\n   Possible reasons:');
      console.log('   1. No task templates exist for Naples + I/V MEETING');
      console.log('   2. Automation server is not running');
      console.log('   3. Webhook is not firing');
      console.log('   4. Location-based filtering is preventing task creation');
    } else {
      console.log(`\n   ✅ SUCCESS! Generated ${generatedTasks.length} task(s):\n`);

      for (const task of generatedTasks) {
        console.log(`   Task ${task.task_number}: ${task.task_name}`);
        console.log(`      Assigned: ${task.assigned_user || 'Not assigned'}`);
        console.log(`      Due Date: ${task.due_date || 'No due date'}`);
        console.log(`      Task ID: ${task.task_id}`);

        // Fetch actual name from Clio
        if (task.task_id) {
          try {
            const clioTask = await ClioService.getTask(task.task_id);
            if (clioTask.assignee?.name) {
              console.log(`      Clio Assignee: ${clioTask.assignee.name}`);
            }
          } catch (err) {
            console.log(`      ⚠️  Could not fetch from Clio: ${err.message}`);
          }
        }
        console.log('');
      }
    }

    console.log('='.repeat(70));
    console.log('✅ Test completed\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testNaplesIVMeeting();
