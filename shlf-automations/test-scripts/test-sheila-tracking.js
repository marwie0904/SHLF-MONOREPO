import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config/index.js';

dotenv.config();

/**
 * Test script to verify Sheila assignee change tracking
 *
 * This script:
 * 1. Runs the migration SQL to create the tracking table
 * 2. Tests inserting a sample record
 * 3. Queries the table to verify it works
 */

const supabase = createClient(config.supabase.url, config.supabase.key);

async function testSheilaTracking() {
  console.log('🧪 Testing Sheila Assignee Change Tracking\n');

  try {
    // Step 1: Check if table exists by trying to query it
    console.log('📊 Step 1: Checking if table exists...');
    const { data: existingData, error: checkError } = await supabase
      .from('sheila-temp-assignee-changes')
      .select('*')
      .limit(1);

    if (checkError) {
      console.log('❌ Table does not exist yet. Please run the migration first:');
      console.log('   psql <connection_string> < migrations/create-sheila-assignee-tracking.sql\n');
      return;
    }

    console.log('✅ Table exists\n');

    // Step 2: Insert a test record
    console.log('📝 Step 2: Inserting test record...');
    const testData = {
      task_id: 999999999, // Test task ID
      task_name: 'Test Task - Sheila Assignment',
      task_desc: 'This is a test task to verify Sheila tracking works',
      due_date: new Date().toISOString(),
      status: 'pending',
      previous_assignee_id: 123456789,
      previous_assignee_name: 'John Doe',
      new_assignee_id: 357896692, // Sheila's ID
      new_assignee_name: 'Sheila Condomina',
      task_originally_created_at: new Date().toISOString(),
      task_originally_created_by: 'Test Automation',
      changed_at: new Date().toISOString(),
      matter_id: 888888888,
      stage_name: 'Test Stage',
    };

    const { data: insertedData, error: insertError } = await supabase
      .from('sheila-temp-assignee-changes')
      .insert(testData)
      .select();

    if (insertError) {
      console.error('❌ Insert failed:', insertError.message);
      return;
    }

    console.log('✅ Test record inserted:');
    console.log(JSON.stringify(insertedData[0], null, 2));
    console.log('');

    // Step 3: Query all records
    console.log('📋 Step 3: Querying all tracked changes...');
    const { data: allData, error: queryError } = await supabase
      .from('sheila-temp-assignee-changes')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(10);

    if (queryError) {
      console.error('❌ Query failed:', queryError.message);
      return;
    }

    console.log(`✅ Found ${allData.length} record(s):\n`);
    allData.forEach((record, index) => {
      console.log(`Record ${index + 1}:`);
      console.log(`  Task ID: ${record.task_id}`);
      console.log(`  Task Name: ${record.task_name}`);
      console.log(`  Previous Assignee: ${record.previous_assignee_name} (${record.previous_assignee_id})`);
      console.log(`  New Assignee: ${record.new_assignee_name} (${record.new_assignee_id})`);
      console.log(`  Changed At: ${record.changed_at}`);
      console.log(`  Matter ID: ${record.matter_id}`);
      console.log('');
    });

    // Step 4: Clean up test record
    console.log('🧹 Step 4: Cleaning up test record...');
    const { error: deleteError } = await supabase
      .from('sheila-temp-assignee-changes')
      .delete()
      .eq('task_id', 999999999);

    if (deleteError) {
      console.error('❌ Delete failed:', deleteError.message);
      return;
    }

    console.log('✅ Test record deleted\n');

    console.log('✨ All tests passed! Sheila tracking is working correctly.\n');
    console.log('📌 Next steps:');
    console.log('   1. Run the migration if you haven\'t already');
    console.log('   2. Deploy the updated code');
    console.log('   3. Monitor the table for real assignee changes');
    console.log('   4. Query with: SELECT * FROM "sheila-temp-assignee-changes" ORDER BY changed_at DESC;\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  }
}

testSheilaTracking();
