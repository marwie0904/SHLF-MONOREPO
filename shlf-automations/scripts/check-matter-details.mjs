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

const response = await axios.get(
  `${CLIO_API_BASE_URL}/api/v4/matters/${TEST_MATTER_ID}`,
  {
    params: { fields: 'id,display_number,matter_stage,practice_area,location,originating_attorney' },
    headers: clioHeaders
  }
);

const matter = response.data.data;
console.log('\nMatter Details:');
console.log(JSON.stringify(matter, null, 2));
