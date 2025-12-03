import express from 'express';
import { config } from './config/index.js';
import webhookRoutes from './routes/webhooks.js';
import { preserveRawBody } from './middleware/raw-body.js';
import { validateClioSignature } from './middleware/validate-signature.js';
import { JobScheduler } from './jobs/scheduler.js';
import { ClioService } from './services/clio.js';
import { TokenRefreshService } from './services/token-refresh.js';
import { initializeEventTracker, EventTracker } from './services/event-tracker.js';

const app = express();

// Logging middleware (before body parsing)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Parse JSON body with raw body preservation for signature validation
// The verify callback captures raw body BEFORE JSON parsing
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    // Store raw body as string for webhook signature validation
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true }));

// Validate webhook signatures
// IMPORTANT: Must come AFTER express.json() but BEFORE webhook routes
// TEMPORARY: Disabled for testing until we have CLIO_WEBHOOK_SECRET
// app.use('/webhooks', validateClioSignature);

// Routes
app.use('/webhooks', webhookRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'SHLF Automation System',
    version: '1.0.0',
    status: 'running',
    automations: {
      'matter-stage-change': {
        endpoint: '/webhooks/matters',
        description: 'Automates task creation when matter stage changes',
      },
      'task-completion': {
        endpoint: '/webhooks/tasks',
        description: 'Handles task completion and creates follow-up tasks',
      },
      'meeting-scheduled': {
        endpoint: '/webhooks/calendar',
        description: 'Updates task due dates when meetings are scheduled',
      },
      'document-created': {
        endpoint: '/webhooks/documents',
        description: 'Creates task when document is uploaded to Clio Drive',
      },
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: err.message,
    stack: config.nodeEnv === 'development' ? err.stack : undefined,
  });
});

// Start server
const PORT = config.port;
app.listen(PORT, async () => {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   SHLF Legal Practice Automation System   ║');
  console.log('╚════════════════════════════════════════════╝\n');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${config.nodeEnv}`);
  console.log(`🔗 Webhook endpoints ready\n`);

  // Initialize token refresh service (fetches from Supabase)
  await TokenRefreshService.initialize();

  // Initialize event tracking (Convex)
  await initializeEventTracker();

  // Initialize CLIO API interceptors for automatic token refresh on 401 errors
  ClioService.initializeInterceptors();

  // Start scheduled jobs
  JobScheduler.start();

  console.log('\n✅ System ready to receive webhooks from Clio\n');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  JobScheduler.stop();
  await EventTracker.flush(); // Flush any pending event tracking data
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  JobScheduler.stop();
  await EventTracker.flush(); // Flush any pending event tracking data
  process.exit(0);
});
