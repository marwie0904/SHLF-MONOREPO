import { config } from '../config/index.js';

/**
 * Webhook Renewal Job
 *
 * Automatically renews webhooks that are expiring within 2 weeks (14 days)
 * by extending their expires_at date to 28 days from now.
 *
 * Should be run once daily via cron.
 */
export class WebhookRenewalJob {
  /**
   * Main entry point for webhook renewal
   */
  static async run() {
    console.log('🔄 [WEBHOOK-RENEWAL] Starting webhook renewal job...\n');

    try {
      // Step 1: Fetch all webhooks with expiry information
      const webhooks = await this.fetchWebhooks();
      console.log(`📊 [WEBHOOK-RENEWAL] Found ${webhooks.length} webhook(s)\n`);

      // Step 2: Filter webhooks expiring within 2 weeks (14 days)
      const expiringWebhooks = this.findExpiringWebhooks(webhooks);

      if (expiringWebhooks.length === 0) {
        console.log('✅ [WEBHOOK-RENEWAL] No webhooks expiring within 2 weeks\n');
        return { success: true, renewed: 0, message: 'No renewals needed' };
      }

      console.log(`⚠️  [WEBHOOK-RENEWAL] Found ${expiringWebhooks.length} webhook(s) expiring within 2 weeks:\n`);
      expiringWebhooks.forEach(webhook => {
        const daysUntilExpiry = this.calculateDaysUntilExpiry(webhook.expires_at);
        console.log(`   - Webhook ${webhook.id} (${webhook.model}): expires in ${daysUntilExpiry} day(s)`);
      });
      console.log('');

      // Step 3: Renew each expiring webhook
      const results = await this.renewWebhooks(expiringWebhooks);

      // Step 4: Summary
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      console.log(`\n✨ [WEBHOOK-RENEWAL] Renewal complete:`);
      console.log(`   ✅ Renewed: ${successCount}`);
      console.log(`   ❌ Failed: ${failCount}\n`);

      return {
        success: true,
        renewed: successCount,
        failed: failCount,
        results,
      };

    } catch (error) {
      console.error(`❌ [WEBHOOK-RENEWAL] Job failed: ${error.message}\n`);
      throw error;
    }
  }

  /**
   * Fetch all webhooks from Clio
   */
  static async fetchWebhooks() {
    const response = await fetch(
      `${config.clio.apiBaseUrl}/api/v4/webhooks.json?fields=id,model,events,url,status,expires_at,created_at`,
      {
        headers: {
          Authorization: `Bearer ${config.clio.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result.data || [];
  }

  /**
   * Find webhooks expiring within 2 weeks (14 days)
   */
  static findExpiringWebhooks(webhooks) {
    const now = new Date();
    const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    return webhooks.filter(webhook => {
      // Skip if no expiry date
      if (!webhook.expires_at) return false;

      // Skip if suspended
      if (webhook.status === 'suspended') return false;

      const expiryDate = new Date(webhook.expires_at);
      return expiryDate <= twoWeeksFromNow;
    });
  }

  /**
   * Calculate days until expiry
   */
  static calculateDaysUntilExpiry(expiresAt) {
    const now = new Date();
    const expiryDate = new Date(expiresAt);
    return Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
  }

  /**
   * Renew multiple webhooks
   */
  static async renewWebhooks(webhooks) {
    const results = [];

    for (const webhook of webhooks) {
      const result = await this.renewWebhook(webhook);
      results.push(result);
    }

    return results;
  }

  /**
   * Renew a single webhook by extending expires_at to 28 days from now
   */
  static async renewWebhook(webhook) {
    const webhookId = webhook.id;

    try {
      // Calculate new expiry date (28 days from now)
      const now = new Date();
      const newExpiryDate = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
      const newExpiryISO = newExpiryDate.toISOString();

      console.log(`🔄 [WEBHOOK-RENEWAL] Renewing webhook ${webhookId}...`);
      console.log(`   Old expiry: ${webhook.expires_at}`);
      console.log(`   New expiry: ${newExpiryISO}`);

      const response = await fetch(
        `${config.clio.apiBaseUrl}/api/v4/webhooks/${webhookId}.json`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${config.clio.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: {
              expires_at: newExpiryISO,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`✅ [WEBHOOK-RENEWAL] Webhook ${webhookId} renewed successfully\n`);

      return {
        success: true,
        webhookId,
        oldExpiry: webhook.expires_at,
        newExpiry: newExpiryISO,
      };

    } catch (error) {
      console.error(`❌ [WEBHOOK-RENEWAL] Failed to renew webhook ${webhookId}: ${error.message}\n`);

      return {
        success: false,
        webhookId,
        error: error.message,
      };
    }
  }
}

// Run immediately if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // When running standalone, initialize TokenRefreshService to load token from Supabase
  import('./refresh-token.js').then(async ({ TokenRefreshJob }) => {
    // Initialize to fetch token from Supabase
    const { TokenRefreshService } = await import('../services/token-refresh.js');
    await TokenRefreshService.initialize();

    return WebhookRenewalJob.run();
  })
    .then(result => {
      console.log('Job result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
