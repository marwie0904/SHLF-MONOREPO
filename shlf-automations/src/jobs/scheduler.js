import cron from 'node-cron';
import { WebhookRenewalJob } from './renew-webhooks.js';
import { StaleMatterCheckerJob } from './check-stale-matters.js';
import { TokenRefreshJob } from './refresh-token.js';
import { run as runCleanupEvents } from './cleanup-events.js';
import { EventTracker } from '../services/event-tracker.js';

/**
 * Job Scheduler
 *
 * Manages all scheduled jobs for the automation system
 */
export class JobScheduler {
  static jobs = [];

  /**
   * Wrap a job with event tracking
   */
  static async runJobWithTracking(jobName, jobFn) {
    const traceId = await EventTracker.startTrace({
      source: 'job',
      triggerName: jobName,
      jobName,
    });

    try {
      const result = await jobFn(traceId);
      await EventTracker.endTrace(traceId, {
        status: 'success',
        resultAction: 'completed',
        metadata: result,
      });
      return result;
    } catch (error) {
      await EventTracker.endTrace(traceId, {
        status: 'error',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  /**
   * Initialize and start all scheduled jobs
   */
  static start() {
    console.log('📅 [SCHEDULER] Starting job scheduler...\n');

    // Job 1: Token Refresh (runs daily at 1 AM)
    const tokenRefreshJob = cron.schedule('0 1 * * *', async () => {
      console.log('⏰ [SCHEDULER] Triggered: Token Refresh Job');
      try {
        await TokenRefreshJob.run();
      } catch (error) {
        console.error('[SCHEDULER] Token refresh job failed:', error);
      }
    }, {
      timezone: 'America/New_York',
    });

    this.jobs.push({
      name: 'token-refresh',
      schedule: '0 1 * * *',
      description: 'Refreshes CLIO access token if expiring within 24 hours',
      job: tokenRefreshJob,
    });

    // Job 2: Webhook Renewal (runs daily at 2 AM)
    const webhookRenewalJob = cron.schedule('0 2 * * *', async () => {
      console.log('⏰ [SCHEDULER] Triggered: Webhook Renewal Job');
      try {
        await WebhookRenewalJob.run();
      } catch (error) {
        console.error('[SCHEDULER] Webhook renewal job failed:', error);
      }
    }, {
      timezone: 'America/New_York', // Adjust to your timezone
    });

    this.jobs.push({
      name: 'webhook-renewal',
      schedule: '0 2 * * *',
      description: 'Renews webhooks expiring within 2 weeks',
      job: webhookRenewalJob,
    });

    // Job 3: Stale Matter Checker (runs daily at 3 AM)
    const staleMatterJob = cron.schedule('0 3 * * *', async () => {
      console.log('⏰ [SCHEDULER] Triggered: Stale Matter Checker Job');
      try {
        await StaleMatterCheckerJob.run();
      } catch (error) {
        console.error('[SCHEDULER] Stale matter checker job failed:', error);
      }
    }, {
      timezone: 'America/New_York',
    });

    this.jobs.push({
      name: 'stale-matter-checker',
      schedule: '0 3 * * *',
      description: 'Creates tasks for matters stuck in Funding in Progress',
      job: staleMatterJob,
    });

    // Job 4: Event Tracking Cleanup (runs daily at 4 AM)
    const eventCleanupJob = cron.schedule('0 4 * * *', async () => {
      console.log('⏰ [SCHEDULER] Triggered: Event Tracking Cleanup Job');
      try {
        await this.runJobWithTracking('cleanup-events', runCleanupEvents);
      } catch (error) {
        console.error('[SCHEDULER] Event tracking cleanup job failed:', error);
      }
    }, {
      timezone: 'America/New_York',
    });

    this.jobs.push({
      name: 'cleanup-events',
      schedule: '0 4 * * *',
      description: 'Cleans up event tracking data older than 90 days',
      job: eventCleanupJob,
    });

    console.log('✅ [SCHEDULER] Scheduled jobs:\n');
    this.jobs.forEach(job => {
      console.log(`   - ${job.name}: ${job.description}`);
      console.log(`     Schedule: ${job.schedule} (${this.cronToHuman(job.schedule)})\n`);
    });
  }

  /**
   * Stop all scheduled jobs
   */
  static stop() {
    console.log('🛑 [SCHEDULER] Stopping all jobs...');
    this.jobs.forEach(job => {
      job.job.stop();
    });
    this.jobs = [];
    console.log('✅ [SCHEDULER] All jobs stopped\n');
  }

  /**
   * Convert cron expression to human-readable format
   */
  static cronToHuman(cronExpression) {
    const patterns = {
      '0 1 * * *': 'Daily at 1:00 AM',
      '0 2 * * *': 'Daily at 2:00 AM',
      '0 3 * * *': 'Daily at 3:00 AM',
      '0 4 * * *': 'Daily at 4:00 AM',
      '0 0 * * *': 'Daily at midnight',
      '*/15 * * * *': 'Every 15 minutes',
      '0 */6 * * *': 'Every 6 hours',
    };

    return patterns[cronExpression] || cronExpression;
  }

  /**
   * Run a specific job manually (for testing)
   */
  static async runJob(jobName) {
    const jobMap = {
      'token-refresh': TokenRefreshJob,
      'webhook-renewal': WebhookRenewalJob,
      'stale-matter-checker': StaleMatterCheckerJob,
      'cleanup-events': { run: runCleanupEvents },
    };

    const JobClass = jobMap[jobName];
    if (!JobClass) {
      throw new Error(`Unknown job: ${jobName}`);
    }

    console.log(`🔧 [SCHEDULER] Running job manually: ${jobName}\n`);
    return await this.runJobWithTracking(jobName, JobClass.run);
  }
}

// Initialize scheduler if this file is imported
export function initScheduler() {
  JobScheduler.start();
}
