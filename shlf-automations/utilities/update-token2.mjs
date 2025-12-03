import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const newToken = '22622-gryt1cKDuKxtDRWtjDBSGHPijFX45MT4o2';
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + 30);

const { error } = await supabase
  .from('clio_tokens')
  .update({
    access_token: newToken,
    expires_at: expiresAt.toISOString(),
    last_refreshed_at: new Date().toISOString(),
  })
  .eq('id', 1);

if (error) {
  console.error('Error:', error);
} else {
  console.log('✅ Token updated');
}
