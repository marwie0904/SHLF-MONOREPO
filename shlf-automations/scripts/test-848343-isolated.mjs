#!/usr/bin/env node
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const CLIO_API_BASE_URL = process.env.CLIO_API_BASE_URL;
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;
const TEST_MATTER_ID = 1675950832;

const clioHeaders = {
  'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
};

async function updateMatterStage(matterId, stageId) {
  const response = await axios.patch(
    `${CLIO_API_BASE_URL}/api/v4/matters/${matterId}`,
    { data: { matter_stage: { id: stageId } } },
    { headers: clioHeaders }
  );
  return response.data.data;
}

async function getClioTasks(matterId) {
  const response = await axios.get(
    `${CLIO_API_BASE_URL}/api/v4/tasks`,
    { params: { matter_id: matterId, fields: 'id,name,due_at,status' }, headers: clioHeaders }
  );
  return response.data.data;
}

console.log('\n══════════════════════════════════════════════════════');
console.log('  ISOLATED TEST: Stage 848343');
console.log('  Cancelled/No Show Signing');
console.log('══════════════════════════════════════════════════════\n');

console.log('🔄 Moving matter to stage 848343...');
await updateMatterStage(TEST_MATTER_ID, 848343);

console.log('⏳ Waiting 15 seconds for webhook...');
await new Promise(r => setTimeout(r, 15000));

const tasks = await getClioTasks(TEST_MATTER_ID);
console.log(`\n📋 Tasks created: ${tasks.length}\n`);

tasks.forEach((t, i) => {
  const dueDate = t.due_at || 'TBD';
  console.log(`   ${i+1}. ${t.name} (ID: ${t.id}) - Due: ${dueDate}`);
});

console.log('\n══════════════════════════════════════════════════════');
console.log('  ANALYSIS');
console.log('══════════════════════════════════════════════════════');
console.log(`\nExpected tasks: 2 (Attempt 1, Void Invoice)`);
console.log(`Actual count: ${tasks.length}`);

const hasAttempt1 = tasks.some(t => t.name.includes('Attempt 1'));
const hasAttempt2 = tasks.some(t => t.name.includes('Attempt 2'));
const hasAttempt3 = tasks.some(t => t.name.includes('Attempt 3'));
const hasNoResponse = tasks.some(t => t.name.includes('No Response'));
const hasVoidInvoice = tasks.some(t => t.name.includes('Void Invoice'));

console.log(`\nExpected tasks:`);
console.log(`  ✓ Attempt 1: ${hasAttempt1 ? '✅ YES' : '❌ MISSING'}`);
console.log(`  ✓ Void Invoice: ${hasVoidInvoice ? '✅ YES' : '❌ MISSING'}`);

console.log(`\nDeferred tasks (should NOT exist):`);
console.log(`  ✗ Attempt 2: ${hasAttempt2 ? '❌ EXISTS' : '✅ NOT CREATED'}`);
console.log(`  ✗ Attempt 3: ${hasAttempt3 ? '❌ EXISTS' : '✅ NOT CREATED'}`);
console.log(`  ✗ No Response: ${hasNoResponse ? '❌ EXISTS' : '✅ NOT CREATED'}`);

const result = !hasAttempt2 && !hasAttempt3 && !hasNoResponse && hasAttempt1 && hasVoidInvoice;
console.log(`\n${result ? '✅ TEST PASSED' : '❌ TEST FAILED'}\n`);
