import axios from 'axios';
import { config } from '../config/index.js';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CLIO Token Refresh Service
 *
 * Handles automatic refresh of CLIO OAuth access tokens using refresh tokens.
 * Access tokens expire after 7 days (604800 seconds).
 *
 * This service:
 * - Fetches tokens from Supabase on startup (persistent storage)
 * - Refreshes tokens proactively (before expiry)
 * - Updates tokens in Supabase and memory
 * - Falls back to .env file for local development
 * - Provides token expiry checking
 */
export class TokenRefreshService {
  // Track token expiration in memory (calculated from expires_in)
  static tokenExpiresAt = null;
  static isRefreshing = false;
  static refreshPromise = null;
  static supabase = null;

  /**
   * Initialize Supabase client
   * @private
   */
  static _initSupabase() {
    if (!this.supabase && config.supabase.url && config.supabase.key) {
      this.supabase = createClient(config.supabase.url, config.supabase.key);
    }
    return this.supabase;
  }

  /**
   * Fetch token from Supabase
   * Called on startup to get the latest token from persistent storage
   * @returns {Promise<Object|null>} Token data or null if not found
   */
  static async fetchTokenFromSupabase() {
    try {
      const supabase = this._initSupabase();
      if (!supabase) {
        console.log('⚠️  Supabase not configured, using env token');
        return null;
      }

      const { data, error } = await supabase
        .from('clio_tokens')
        .select('access_token, expires_at')
        .eq('id', 1)
        .single();

      if (error) {
        console.error('⚠️  Failed to fetch token from Supabase:', error.message);
        return null;
      }

      if (data && data.access_token) {
        console.log('✅ Fetched token from Supabase');
        console.log(`   Expires at: ${data.expires_at}`);
        return {
          access_token: data.access_token,
          expires_at: new Date(data.expires_at),
        };
      }

      return null;
    } catch (error) {
      console.error('⚠️  Error fetching token from Supabase:', error.message);
      return null;
    }
  }

  /**
   * Update token in Supabase
   * @param {string} accessToken - New access token
   * @param {Date} expiresAt - Token expiration date
   * @private
   */
  static async _updateTokenInSupabase(accessToken, expiresAt) {
    try {
      const supabase = this._initSupabase();
      if (!supabase) {
        console.log('⚠️  Supabase not configured, skipping DB update');
        return;
      }

      const { error } = await supabase
        .from('clio_tokens')
        .update({
          access_token: accessToken,
          expires_at: expiresAt.toISOString(),
          last_refreshed_at: new Date().toISOString(),
        })
        .eq('id', 1);

      if (error) {
        console.error('⚠️  Failed to update token in Supabase:', error.message);
        return;
      }

      console.log('💾 Updated token in Supabase');
    } catch (error) {
      console.error('⚠️  Error updating token in Supabase:', error.message);
      // Don't throw - token is already updated in memory
    }
  }

  /**
   * Initialize token expiration tracking
   * Call this on app startup to fetch token from Supabase and set up in-memory tracking
   */
  static async initialize() {
    console.log('🔐 Initializing token refresh service...');

    // Try to fetch token from Supabase first
    const tokenData = await this.fetchTokenFromSupabase();

    if (tokenData) {
      // Use token from Supabase
      this.tokenExpiresAt = tokenData.expires_at;
      config.clio.accessToken = tokenData.access_token;
      process.env.CLIO_ACCESS_TOKEN = tokenData.access_token;
      console.log('✅ Token loaded from Supabase and saved to memory');
    } else {
      // Fallback to env var token (local dev or first run)
      console.log('📝 Using token from environment variables');

      // Assume token expires in 7 days if we don't have expiry data
      if (!this.tokenExpiresAt) {
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        this.tokenExpiresAt = sevenDaysFromNow;

        // Save to Supabase for future restarts
        if (config.clio.accessToken) {
          await this._updateTokenInSupabase(config.clio.accessToken, this.tokenExpiresAt);
        }
      }
    }

    console.log(`🔐 Token expires: ${this.tokenExpiresAt.toISOString()}`);
    console.log(`⏰ Time remaining: ${this.getTimeUntilExpiry()}`);
  }

  /**
   * Check if token expires within the specified hours
   * @param {number} hours - Number of hours to check ahead (default: 24)
   * @returns {boolean} - True if token expires within specified hours
   */
  static needsRefresh(hours = 24) {
    if (!this.tokenExpiresAt) {
      // Token expiry not initialized - assume it needs refresh to be safe
      console.warn('⚠️  Token expiry not initialized, assuming refresh needed');
      return true;
    }

    const now = new Date();
    const hoursInMs = hours * 60 * 60 * 1000;
    const expiryThreshold = new Date(now.getTime() + hoursInMs);

    return this.tokenExpiresAt <= expiryThreshold;
  }

  /**
   * Get time remaining until token expires
   * @returns {string} - Human-readable time remaining
   */
  static getTimeUntilExpiry() {
    if (!this.tokenExpiresAt) {
      return 'Unknown';
    }

    const now = new Date();
    const msRemaining = this.tokenExpiresAt - now;

    if (msRemaining <= 0) {
      return 'Expired';
    }

    const days = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((msRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    return `${days}d ${hours}h`;
  }

  /**
   * Refresh the CLIO access token using the refresh token
   * @returns {Promise<Object>} - New token data
   */
  static async refreshAccessToken() {
    // Prevent concurrent refresh attempts
    if (this.isRefreshing) {
      console.log('⏳ Token refresh already in progress, waiting...');
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this._performRefresh();

    try {
      const result = await this.refreshPromise;
      return result;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  /**
   * Internal method to perform the actual token refresh
   * @private
   */
  static async _performRefresh() {
    console.log('🔄 Refreshing CLIO access token...');

    try {
      // Validate required credentials
      if (!config.clio.refreshToken) {
        throw new Error('CLIO_REFRESH_TOKEN not configured');
      }
      if (!config.clio.clientId) {
        throw new Error('CLIO_CLIENT_ID not configured');
      }
      if (!config.clio.clientSecret) {
        throw new Error('CLIO_CLIENT_SECRET not configured');
      }

      // Call CLIO token refresh endpoint
      const response = await axios.post(
        `${config.clio.apiBaseUrl}/oauth/token`,
        new URLSearchParams({
          client_id: config.clio.clientId,
          client_secret: config.clio.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: config.clio.refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in } = response.data;

      console.log('✅ Token refreshed successfully');
      console.log(`   Expires in: ${expires_in} seconds (${Math.floor(expires_in / 86400)} days)`);

      // Calculate new expiration time
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + expires_in);
      this.tokenExpiresAt = expiresAt;

      console.log(`   New expiry: ${expiresAt.toISOString()}`);

      // Update token in memory (config object)
      config.clio.accessToken = access_token;

      // Update environment variable in process
      process.env.CLIO_ACCESS_TOKEN = access_token;

      // Persist to Supabase (primary storage for production)
      await this._updateTokenInSupabase(access_token, expiresAt);

      // Also persist to .env file (fallback for local dev)
      await this._updateEnvFile(access_token);

      return {
        access_token,
        expires_in,
        expires_at: expiresAt,
      };
    } catch (error) {
      console.error('❌ Token refresh failed:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Update the .env file with new access token
   * @param {string} newAccessToken - The new access token
   * @private
   */
  static async _updateEnvFile(newAccessToken) {
    try {
      const envPath = path.resolve(__dirname, '../../.env');

      // Check if .env file exists
      try {
        await fs.access(envPath);
      } catch {
        console.log('⚠️  .env file not found, skipping file update');
        return;
      }

      // Read current .env file
      let envContent = await fs.readFile(envPath, 'utf-8');

      // Replace the access token (handle both quoted and unquoted values)
      const tokenRegex = /CLIO_ACCESS_TOKEN=.*/;
      if (tokenRegex.test(envContent)) {
        envContent = envContent.replace(tokenRegex, `CLIO_ACCESS_TOKEN=${newAccessToken}`);
      } else {
        // If token line doesn't exist, append it
        envContent += `\nCLIO_ACCESS_TOKEN=${newAccessToken}\n`;
      }

      // Write updated content back to .env
      await fs.writeFile(envPath, envContent, 'utf-8');
      console.log('💾 Updated .env file with new access token');
    } catch (error) {
      console.error('⚠️  Failed to update .env file:', error.message);
      // Don't throw - token is already updated in memory
    }
  }

  /**
   * Check and refresh token if needed
   * Called by scheduled job and can be called manually
   */
  static async checkAndRefresh() {
    console.log('\n🔍 Checking token expiration status...');
    console.log(`   Current time: ${new Date().toISOString()}`);
    console.log(`   Token expires: ${this.tokenExpiresAt?.toISOString() || 'Unknown'}`);
    console.log(`   Time remaining: ${this.getTimeUntilExpiry()}`);

    if (this.needsRefresh(24)) {
      console.log('⚠️  Token expires within 24 hours, refreshing now...');
      await this.refreshAccessToken();
      return true;
    } else {
      console.log('✅ Token is still valid, no refresh needed');
      return false;
    }
  }
}
