import { TokenRefreshService } from '../src/services/token-refresh.js';

console.log('🔄 Refreshing Clio access token...\n');

try {
  await TokenRefreshService.initialize();
  await TokenRefreshService.refreshAccessToken();
  console.log('\n✅ Token refreshed successfully!');
} catch (error) {
  console.error('\n❌ Token refresh failed:', error.message);
  process.exit(1);
}
