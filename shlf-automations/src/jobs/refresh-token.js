import { TokenRefreshService } from '../services/token-refresh.js';

/**
 * Token Refresh Job
 *
 * Proactively refreshes CLIO access tokens before they expire.
 * Access tokens expire after 7 days (604800 seconds).
 *
 * This job:
 * - Runs daily to check token expiration
 * - Refreshes tokens that expire within 24 hours
 * - Updates tokens in memory and .env file
 * - Prevents API failures due to expired tokens
 *
 * Should be run once daily via cron (e.g., at 1:00 AM EST).
 */
export class TokenRefreshJob {
  /**
   * Run the token refresh check
   */
  static async run() {
    console.log('\n========================================');
    console.log('🔐 TOKEN REFRESH JOB STARTED');
    console.log('========================================\n');

    const startTime = Date.now();

    try {
      // Initialize token service first (loads from Supabase if not already initialized)
      if (!TokenRefreshService.tokenExpiresAt) {
        await TokenRefreshService.initialize();
      }

      // Check and refresh if needed
      const wasRefreshed = await TokenRefreshService.checkAndRefresh();

      const duration = Date.now() - startTime;

      console.log('\n========================================');
      if (wasRefreshed) {
        console.log('✅ TOKEN REFRESH JOB COMPLETED - Token was refreshed');
      } else {
        console.log('✅ TOKEN REFRESH JOB COMPLETED - No refresh needed');
      }
      console.log(`⏱️  Duration: ${duration}ms`);
      console.log('========================================\n');

      return {
        success: true,
        wasRefreshed,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      console.error('\n========================================');
      console.error('❌ TOKEN REFRESH JOB FAILED');
      console.error(`   Error: ${error.message}`);
      console.error(`⏱️  Duration: ${duration}ms`);
      console.error('========================================\n');

      // Don't throw - we want the scheduler to continue
      return {
        success: false,
        error: error.message,
        duration,
      };
    }
  }

  /**
   * Force refresh token immediately (for manual execution)
   */
  static async forceRefresh() {
    console.log('\n========================================');
    console.log('🔐 FORCE TOKEN REFRESH');
    console.log('========================================\n');

    try {
      const tokenData = await TokenRefreshService.refreshAccessToken();

      console.log('\n========================================');
      console.log('✅ FORCE REFRESH COMPLETED');
      console.log(`   New token expires: ${tokenData.expires_at.toISOString()}`);
      console.log('========================================\n');

      return tokenData;
    } catch (error) {
      console.error('\n========================================');
      console.error('❌ FORCE REFRESH FAILED');
      console.error(`   Error: ${error.message}`);
      console.error('========================================\n');

      throw error;
    }
  }
}

// Allow running directly via npm script or node command
if (import.meta.url === `file://${process.argv[1]}`) {
  TokenRefreshJob.run()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
