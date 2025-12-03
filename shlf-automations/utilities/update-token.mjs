import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const newToken = '22622-c9EYvIb9FasDym8SgjUoum3wbXfASH26No';
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

const { data, error } = await supabase
  .from('clio_tokens')
  .update({
    access_token: newToken,
    expires_at: expiresAt.toISOString(),
    last_refreshed_at: new Date().toISOString(),
  })
  .eq('id', 1)
  .select();

if (error) {
  console.error('Error:', error);
} else {
  console.log('✅ Token updated in Supabase');
  console.log('New token:', newToken);
  console.log('Expires:', expiresAt.toISOString());
}
