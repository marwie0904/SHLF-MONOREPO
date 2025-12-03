/**
 * Test Clio API tasks endpoint to verify:
 * 1. Correct URL for listing tasks
 * 2. How to filter by matter_id
 * 3. What fields are returned (especially assignee)
 */

import { ClioService } from './src/services/clio.js';
import { TokenRefreshService } from './src/services/token-refresh.js';
import { config } from './src/config/index.js';

const TEST_MATTER_ID = 1675950832;

async function testClioTasksAPI() {
  console.log('\n🔍 Testing Clio Tasks API Endpoint...\n');
  console.log('='.repeat(60));

  try {
    // Initialize token service
    console.log('\n🔐 Initializing token service...');
    await TokenRefreshService.initialize();
    ClioService.initializeInterceptors();
    ClioService.client.defaults.headers['Authorization'] = `Bearer ${config.clio.accessToken}`;

    console.log('\n📋 Test 1: List tasks endpoint (no filter)');
    console.log('URL: GET /api/v4/tasks');
    try {
      const response1 = await ClioService.client.get('/api/v4/tasks', {
        params: {
          fields: 'id,name,assignee,due_at,matter',
          limit: 3,
        },
      });
      console.log('✅ Success!');
      console.log(`   Total tasks: ${response1.data.data.length}`);
      console.log(`   Sample task:`, JSON.stringify(response1.data.data[0], null, 2));
    } catch (err) {
      console.log('❌ Error:', err.response?.status, err.response?.statusText);
      console.log('   ', err.response?.data);
    }

    console.log('\n📋 Test 2: List tasks with matter_id filter');
    console.log(`URL: GET /api/v4/tasks?matter_id=${TEST_MATTER_ID}`);
    try {
      const response2 = await ClioService.client.get('/api/v4/tasks', {
        params: {
          matter_id: TEST_MATTER_ID,
          fields: 'id,name,assignee{id,name},due_at,matter{id,display_number}',
        },
      });
      console.log('✅ Success!');
      console.log(`   Tasks for matter ${TEST_MATTER_ID}: ${response2.data.data.length}`);

      if (response2.data.data.length > 0) {
        console.log('\n   📄 Task Details:');
        response2.data.data.forEach((task, index) => {
          console.log(`\n   Task ${index + 1}:`);
          console.log(`     ID: ${task.id}`);
          console.log(`     Name: ${task.name}`);
          console.log(`     Assignee: ${task.assignee ? task.assignee.name : 'None'}`);
          console.log(`     Assignee ID: ${task.assignee ? task.assignee.id : 'None'}`);
          console.log(`     Due Date: ${task.due_at || 'None'}`);
          console.log(`     Matter: ${task.matter ? task.matter.display_number : 'None'}`);
        });
      }
    } catch (err) {
      console.log('❌ Error:', err.response?.status, err.response?.statusText);
      console.log('   ', err.response?.data);
    }

    console.log('\n📋 Test 3: Get individual task by ID');
    console.log('URL: GET /api/v4/tasks/{id}');

    // First get a task ID from Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(config.supabase.url, config.supabase.key);

    const { data: sampleTask } = await supabase
      .from('tasks')
      .select('task_id')
      .eq('matter_id', TEST_MATTER_ID)
      .limit(1)
      .single();

    if (sampleTask && sampleTask.task_id) {
      try {
        const response3 = await ClioService.client.get(`/api/v4/tasks/${sampleTask.task_id}`, {
          params: {
            fields: 'id,name,description,status,assignee{id,name,email},due_at,matter{id,display_number}',
          },
        });
        console.log('✅ Success!');
        console.log(`   Task ${sampleTask.task_id}:`);
        console.log(JSON.stringify(response3.data.data, null, 2));
      } catch (err) {
        console.log('❌ Error:', err.response?.status, err.response?.statusText);
        console.log('   ', err.response?.data);
      }
    } else {
      console.log('⚠️  No tasks found in Supabase for matter', TEST_MATTER_ID);
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Clio Tasks API Test Complete\n');

    console.log('📊 Summary of API Endpoints:');
    console.log('   List all tasks: GET /api/v4/tasks');
    console.log('   Filter by matter: GET /api/v4/tasks?matter_id={id}');
    console.log('   Get specific task: GET /api/v4/tasks/{id}');
    console.log('\n📊 Assignee Field Structure:');
    console.log('   assignee.id - User ID');
    console.log('   assignee.name - User full name');
    console.log('   assignee.email - User email (if requested in fields)');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testClioTasksAPI()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
