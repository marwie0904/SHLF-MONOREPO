import crypto from 'crypto';
import { config } from '../config/index.js';
import { SupabaseService } from '../services/supabase.js';
import { ERROR_CODES } from '../constants/error-codes.js';

/**
 * Validate Clio webhook signature
 *
 * Clio signs webhooks using HMAC-SHA256 with the webhook secret.
 * Signature is sent in X-Clio-Signature header.
 *
 * IMPORTANT: This middleware must run AFTER raw body preservation
 * because signature validation requires the exact raw body string.
 */
export const validateClioSignature = async (req, res, next) => {
  // Skip signature validation during webhook activation
  // (activation requests have X-Hook-Secret, not X-Clio-Signature)
  if (req.headers['x-hook-secret']) {
    return next();
  }

  // Get signature from header
  const signature = req.headers['x-clio-signature'];

  if (!signature) {
    console.error('🔐 Missing X-Clio-Signature header');

    await SupabaseService.logError(
      ERROR_CODES.WEBHOOK_MISSING_SIGNATURE,
      'Missing webhook signature',
      {
        headers: req.headers,
        source_ip: req.ip,
        path: req.path,
      }
    );

    return res.status(401).json({
      success: false,
      error: 'Missing webhook signature',
    });
  }

  // Validate webhook secret is configured
  if (!config.clio.webhookSecret) {
    console.error('🔐 CLIO_WEBHOOK_SECRET not configured');
    return res.status(500).json({
      success: false,
      error: 'Webhook secret not configured',
    });
  }

  // Calculate expected signature
  // IMPORTANT: Must use raw body string, not parsed JSON
  const payload = req.rawBody || JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', config.clio.webhookSecret)
    .update(payload)
    .digest('hex');

  // Compare signatures (constant-time comparison to prevent timing attacks)
  let isValid = false;
  try {
    isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    // Buffers have different lengths
    isValid = false;
  }

  if (!isValid) {
    console.error('🔐 Invalid webhook signature');
    console.error(`   Expected: ${expectedSignature}`);
    console.error(`   Received: ${signature}`);

    await SupabaseService.logError(
      ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
      'Invalid webhook signature',
      {
        signature_received: signature,
        signature_expected: expectedSignature,
        headers: req.headers,
        source_ip: req.ip,
        path: req.path,
      }
    );

    return res.status(401).json({
      success: false,
      error: 'Invalid webhook signature',
    });
  }

  console.log('✅ Webhook signature validated');
  next();
};
