import { createClient } from '@supabase/supabase-js';
import { config } from './src/config/index.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

const { data, error } = await supabase
  .from('clio_tokens')
  .select('access_token, expires_at')
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

if (error) {
  console.error('Error:', error);
} else {
  console.log('Access token from Supabase clio_tokens table:');
  console.log('Token:', data.access_token);
  console.log('Expires:', data.expires_at);
}
