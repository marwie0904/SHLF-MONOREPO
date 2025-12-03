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

async function showFinalMapping() {
  try {
    console.log('🔍 Final Task Type Mapping...\n');

    const response = await client.get('/api/v4/matter_stages.json', {
      params: {
        fields: 'id,name',
      },
    });

    const stages = response.data.data;

    // Task Type IDs
    const TASK_TYPE_IV_MEETING = 1190491;
    const TASK_TYPE_CANCELLED = 1190506;

    // Final categorization (after user feedback)
    const ivMeetingStages = [];
    const cancelledStages = [];

    stages.forEach(stage => {
      const nameLower = stage.name.toLowerCase();
      
      // I/V Meeting - ONLY the main I/V Meeting stage
      if (nameLower === 'i/v meeting' || nameLower === 'i/v meeting ') {
        ivMeetingStages.push(stage);
      }
      // Cancelled - all cancelled/no show stages (including cancelled I/V)
      else if (nameLower.includes('cancel') || nameLower.includes('no show')) {
        cancelledStages.push(stage);
      }
    });

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('✅ FINAL TASK TYPE MAPPING');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    console.log('📋 Task Type: I/V Meeting (ID: 1190491)\n');
    ivMeetingStages.forEach(stage => {
      console.log(`   ✓ ${stage.name} (Stage ID: ${stage.id})`);
    });

    console.log('\n📋 Task Type: Cancelled (ID: 1190506)\n');
    cancelledStages.forEach(stage => {
      console.log(`   ✓ ${stage.name} (Stage ID: ${stage.id})`);
    });

    console.log('\n📋 No Task Type (All other 68 stages)\n');
    console.log('   All remaining stages will not have a task type assigned');

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('IMPLEMENTATION DETAILS');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log('Stage ID to Task Type ID mapping:\n');
    
    console.log('I/V Meeting Task Type (1190491):');
    ivMeetingStages.forEach(stage => {
      console.log(`  ${stage.id} => 1190491`);
    });

    console.log('\nCancelled Task Type (1190506):');
    cancelledStages.forEach(stage => {
      console.log(`  ${stage.id} => 1190506`);
    });

    console.log('\n\nTotal stages with task types:', ivMeetingStages.length + cancelledStages.length);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

showFinalMapping();
