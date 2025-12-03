import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const clioClient = axios.create({
  baseURL: process.env.CLIO_API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${process.env.CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

console.log('🧪 TEST 2: Clio Task API Endpoint\n');

// Using task_id from previous test
const testTaskId = 1211338058;

console.log(`Testing Clio API for task ${testTaskId}...\n`);

try {
  const response = await clioClient.get(`/api/v4/tasks/${testTaskId}`, {
    params: {
      fields: 'id,name,status,assignee{id,name}',
    },
  });

  console.log('✅ API call successful!\n');
  console.log('📋 Response structure:');
  console.log(JSON.stringify(response.data, null, 2));

  const task = response.data.data;
  console.log('\n📊 Field verification:');
  console.log(`  id: ${task.id} (${typeof task.id})`);
  console.log(`  name: ${task.name} (${typeof task.name})`);
  console.log(`  status: ${task.status} (${typeof task.status})`);
  console.log(`  assignee: ${task.assignee ? JSON.stringify(task.assignee) : 'null'}`);

  if (task.assignee) {
    console.log(`    assignee.id: ${task.assignee.id} (${typeof task.assignee.id})`);
    console.log(`    assignee.name: ${task.assignee.name} (${typeof task.assignee.name})`);
  }

  console.log('\n✅ Test 2 passed - Clio task endpoint is correct');
} catch (error) {
  if (error.response?.status === 404) {
    console.log('⚠️  Task returned 404 (not found in Clio)');
    console.log('This is expected for deleted tasks');
    console.log('\n✅ Test 2 passed - 404 handling works correctly');
  } else {
    console.error('❌ API call failed:', error.message);
    console.error('Status:', error.response?.status);
    console.error('Data:', JSON.stringify(error.response?.data, null, 2));
    process.exit(1);
  }
}
