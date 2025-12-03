import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const client = axios.create({
  baseURL: process.env.CLIO_API_BASE_URL || 'https://app.clio.com',
  headers: {
    'Authorization': `Bearer ${process.env.CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

async function getTaskTypes() {
  try {
    console.log('🔍 Fetching all task types from Clio...\n');

    const response = await client.get('/api/v4/task_types.json', {
      params: {
        fields: 'id,name',
      },
    });

    const taskTypes = response.data.data;

    console.log(`Found ${taskTypes.length} task types:\n`);
    console.log('═══════════════════════════════════════════════════════════════════\n');

    taskTypes.forEach((taskType, index) => {
      console.log(`${index + 1}. ${taskType.name}`);
      console.log(`   ID: ${taskType.id}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error fetching task types:');
    console.error('Status:', error.response?.status);
    console.error('Message:', error.response?.data?.error || error.message);
    console.error('Details:', JSON.stringify(error.response?.data, null, 2));
  }
}

getTaskTypes();
