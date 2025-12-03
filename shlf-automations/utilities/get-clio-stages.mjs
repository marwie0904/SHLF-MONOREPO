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

async function getMatterStages() {
  try {
    console.log('🔍 Fetching all matter stages from Clio...\n');
    
    const response = await client.get('/api/v4/matter_stages.json', {
      params: {
        fields: 'id,name',
      },
    });

    const stages = response.data.data;
    
    console.log(`Found ${stages.length} matter stages:\n`);
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    stages.forEach((stage, index) => {
      console.log(`${index + 1}. ${stage.name}`);
      console.log(`   ID: ${stage.id}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    // Search for Funding Completed
    const fundingCompleted = stages.find(s => 
      s.name.toLowerCase().includes('funding') && 
      s.name.toLowerCase().includes('completed')
    );
    
    if (fundingCompleted) {
      console.log('✅ Found "Funding Completed" stage:');
      console.log(`   Stage ID: ${fundingCompleted.id}`);
      console.log(`   Full Name: ${fundingCompleted.name}`);
    } else {
      console.log('❌ No stage found with "Funding Completed" in the name');
      console.log('\nSearching for any stage with "funding"...');
      
      const fundingStages = stages.filter(s => 
        s.name.toLowerCase().includes('funding')
      );
      
      if (fundingStages.length > 0) {
        console.log(`\nFound ${fundingStages.length} stage(s) with "funding":`);
        fundingStages.forEach(stage => {
          console.log(`  - ${stage.name} (ID: ${stage.id})`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Error fetching matter stages:');
    console.error('Status:', error.response?.status);
    console.error('Message:', error.response?.data?.error || error.message);
    console.error('Details:', JSON.stringify(error.response?.data, null, 2));
  }
}

getMatterStages();
