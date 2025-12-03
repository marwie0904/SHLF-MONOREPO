import dotenv from 'dotenv';

dotenv.config();

// Clean environment variables (remove quotes, trim spaces)
const cleanEnv = (value) => {
  if (!value) return value;
  return value.trim().replace(/^["']|["']$/g, '');
};

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  supabase: {
    url: cleanEnv(process.env.SUPABASE_URL),
    key: cleanEnv(process.env.SUPABASE_KEY),
  },

  clio: {
    apiBaseUrl: cleanEnv(process.env.CLIO_API_BASE_URL) || 'https://app.clio.com',
    accessToken: cleanEnv(process.env.CLIO_ACCESS_TOKEN),
    refreshToken: cleanEnv(process.env.CLIO_REFRESH_TOKEN),
    clientId: cleanEnv(process.env.CLIO_CLIENT_ID),
    clientSecret: cleanEnv(process.env.CLIO_CLIENT_SECRET),
    webhookSecret: cleanEnv(process.env.CLIO_WEBHOOK_SECRET),
  },

  automation: {
    timezoneOffsetHours: parseInt(process.env.TIMEZONE_OFFSET_HOURS || '4'),
    rollbackWindowMinutes: 3,
  },

  testing: {
    testMode: process.env.TEST_MODE === 'true',
    testMatterId: parseInt(process.env.TEST_MATTER_ID || '1675950832'),
  },

  // Convex event tracking configuration
  convex: {
    url: cleanEnv(process.env.CONVEX_URL),
    deploymentName: cleanEnv(process.env.CONVEX_DEPLOYMENT),
  },

  // Event tracking settings
  tracking: {
    enabled: process.env.TRACKING_ENABLED !== 'false',
    bufferSize: parseInt(process.env.TRACKING_BUFFER_SIZE || '50'),
    flushIntervalMs: parseInt(process.env.TRACKING_FLUSH_INTERVAL || '5000'),
    retentionDays: parseInt(process.env.TRACKING_RETENTION_DAYS || '90'),
  },
};

// Validation
const required = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'CLIO_ACCESS_TOKEN',
  'CLIO_WEBHOOK_SECRET',
];

const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.warn(`⚠️  Warning: Missing environment variables: ${missing.join(', ')}`);
  console.warn('Please copy .env.example to .env and configure values');
}

// Debug logging in production
if (config.nodeEnv === 'production') {
  console.log('🔍 Environment variable debug:');
  console.log(`   SUPABASE_URL: ${config.supabase.url ? '[SET]' : '[MISSING]'} (length: ${config.supabase.url?.length || 0})`);
  console.log(`   SUPABASE_KEY: ${config.supabase.key ? '[SET]' : '[MISSING]'} (length: ${config.supabase.key?.length || 0})`);
  console.log(`   CLIO_ACCESS_TOKEN: ${config.clio.accessToken ? '[SET]' : '[MISSING]'} (length: ${config.clio.accessToken?.length || 0})`);
}
