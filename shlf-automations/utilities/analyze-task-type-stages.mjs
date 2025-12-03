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

async function analyzeTaskTypeStages() {
  try {
    console.log('🔍 Analyzing stages for task type assignment...\n');

    const response = await client.get('/api/v4/matter_stages.json', {
      params: {
        fields: 'id,name',
      },
    });

    const stages = response.data.data;

    // Task Type IDs
    const TASK_TYPE_IV_MEETING = 1190491;
    const TASK_TYPE_CANCELLED = 1190506;

    // Categorize stages
    const ivMeetingStages = [];
    const cancelledStages = [];
    const otherStages = [];

    stages.forEach(stage => {
      const nameLower = stage.name.toLowerCase();
      
      // Check for I/V Meeting
      if (nameLower.includes('i/v meeting') || nameLower === 'i/v meeting') {
        ivMeetingStages.push(stage);
      }
      // Check for Cancelled/No Show stages
      else if (nameLower.includes('cancel') || nameLower.includes('no show')) {
        cancelledStages.push(stage);
      }
      else {
        otherStages.push(stage);
      }
    });

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('📋 TASK TYPE: I/V Meeting (ID: 1190491)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    if (ivMeetingStages.length > 0) {
      console.log('Stages that will use this task type:\n');
      ivMeetingStages.forEach(stage => {
        console.log(`  ✓ ${stage.name} (ID: ${stage.id})`);
      });
    } else {
      console.log('  (No stages found)');
    }

    console.log('\n\n═══════════════════════════════════════════════════════════════════');
    console.log('📋 TASK TYPE: Cancelled (ID: 1190506)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    if (cancelledStages.length > 0) {
      console.log('Stages that will use this task type:\n');
      cancelledStages.forEach(stage => {
        console.log(`  ✓ ${stage.name} (ID: ${stage.id})`);
      });
    } else {
      console.log('  (No stages found)');
    }

    console.log('\n\n═══════════════════════════════════════════════════════════════════');
    console.log('📋 OTHER STAGES (No task type assigned)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    console.log(`Total: ${otherStages.length} stages\n`);
    console.log('These stages will NOT have a task type assigned (default behavior)');

    // Summary
    console.log('\n\n═══════════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log(`I/V Meeting task type: ${ivMeetingStages.length} stage(s)`);
    console.log(`Cancelled task type: ${cancelledStages.length} stage(s)`);
    console.log(`No task type: ${otherStages.length} stage(s)`);
    console.log(`Total stages: ${stages.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

analyzeTaskTypeStages();
