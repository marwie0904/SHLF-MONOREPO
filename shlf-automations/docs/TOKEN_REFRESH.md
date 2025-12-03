# CLIO Token Refresh System

## Overview

The CLIO API uses OAuth 2.0 for authentication with access tokens that expire after **7 days** (604,800 seconds). This system automatically refreshes access tokens before they expire, ensuring uninterrupted operation of all automations.

## Architecture

### Components

1. **TokenRefreshService** (`src/services/token-refresh.js`)
   - Core service for token refresh logic
   - Fetches token from Supabase on startup
   - Tracks token expiration times
   - Handles OAuth refresh flow with CLIO API
   - Updates tokens in Supabase and memory

2. **TokenRefreshJob** (`src/jobs/refresh-token.js`)
   - Scheduled job that runs daily at 1:00 AM EST
   - Checks if token expires within 24 hours
   - Proactively refreshes tokens before expiry

3. **API Interceptor** (in `src/services/clio.js`)
   - Automatically catches 401 Unauthorized errors
   - Refreshes token on-the-fly
   - Retries failed requests with new token

4. **Scheduler Integration** (`src/jobs/scheduler.js`)
   - Manages automated daily token checks
   - Runs before other jobs (webhooks at 2 AM, stale matters at 3 AM)

## Configuration

### Step 1: Set Up Supabase Database

**Run this SQL in your Supabase SQL Editor:**

Go to your Supabase project → SQL Editor → New Query, then paste and run:

```sql
-- Copy the entire content from: migrations/008_clio_tokens_table.sql
-- Or see the file in the project repository
```

This creates:
- `clio_tokens` table (stores access token and expiry timestamp)
- Automatic `updated_at` trigger
- Row-Level Security policies
- Single-row constraint (ensures only 1 token record exists)

### Step 2: Set Environment Variables

#### For Local Development (`.env` file):

```bash
# CLIO OAuth Configuration
CLIO_CLIENT_ID=your_oauth_client_id_here
CLIO_CLIENT_SECRET=your_oauth_client_secret_here
CLIO_REFRESH_TOKEN=your_refresh_token_here
CLIO_ACCESS_TOKEN=your_current_access_token_here

# Supabase Configuration (required for token persistence)
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
```

#### For Production (Digital Ocean):

Set these as **App-Level Environment Variables** in Digital Ocean:

```bash
CLIO_CLIENT_ID=your_oauth_client_id_here
CLIO_CLIENT_SECRET=your_oauth_client_secret_here
CLIO_REFRESH_TOKEN=your_refresh_token_here
CLIO_ACCESS_TOKEN=your_initial_access_token_here

SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
```

**Important for Production**:
- Set these in Digital Ocean app settings (not in .env file)
- `CLIO_ACCESS_TOKEN` is just an initial fallback value
- The system fetches the **latest token from Supabase** on startup
- Tokens persist across container restarts/redeployments

### Where to Get These Values

1. **Client ID & Secret**: From your CLIO Developer Dashboard
   - Visit: https://app.clio.com/settings/developer_applications
   - Create or select your OAuth application
   - Copy the Client ID and Client Secret

2. **Refresh Token**: Obtained during initial OAuth authorization flow
   - Already stored in `.env.bak` for this project
   - **Important**: Refresh tokens don't expire (but store securely!)
   - This stays the same forever (never changes)

3. **Access Token**: Current access token (auto-updated by system)
   - Initial token from OAuth flow
   - System fetches latest from Supabase on startup
   - Gets auto-updated in Supabase every ~7 days
   - You only need to set this once initially

4. **Supabase URL & Key**: From your Supabase project
   - Visit: https://app.supabase.com/project/YOUR_PROJECT/settings/api
   - Copy the **Project URL**
   - Copy the **anon public key**

## How It Works

### On Server Startup (Token Initialization)

```
Server Starts
    ↓
Fetch latest token from Supabase
    ↓
Found in Supabase?
    ↓
    Yes → Load token into memory (fastest & most current)
    No  → Use CLIO_ACCESS_TOKEN from env vars → Save to Supabase
    ↓
Initialize API client with token
    ↓
Ready to handle requests
```

**Key Point**: Token is fetched **once** on startup, then kept in memory for fast access. No database queries on every API call!

### Automatic Refresh (Scheduled)

```
1:00 AM EST Daily
    ↓
TokenRefreshJob runs
    ↓
Check: Does token expire within 24 hours?
    ↓
    Yes → Refresh token now → Update Supabase → Update memory
    No  → Skip refresh
```

### Reactive Refresh (On Error)

```
API Request to CLIO
    ↓
401 Unauthorized Response
    ↓
Interceptor catches error
    ↓
Refresh token immediately
    ↓
Update Supabase with new token
    ↓
Update memory with new token
    ↓
Retry original request
    ↓
Return response to caller
```

## Token Refresh Flow

```mermaid
POST https://app.clio.com/oauth/token
Headers: Content-Type: application/x-www-form-urlencoded
Body:
    client_id: YOUR_CLIENT_ID
    client_secret: YOUR_CLIENT_SECRET
    grant_type: refresh_token
    refresh_token: YOUR_REFRESH_TOKEN

    ↓

Response:
{
  "token_type": "bearer",
  "access_token": "NEW_ACCESS_TOKEN",
  "expires_in": 604800  // 7 days in seconds
}

    ↓

System Updates:
1. In-memory config (config.clio.accessToken) - for fast API calls
2. Process environment (process.env.CLIO_ACCESS_TOKEN) - runtime var
3. Supabase database (clio_tokens table) - PRIMARY persistence (survives restarts)
4. .env file (local dev fallback) - optional for local development
5. Calculates new expiry time - tracks when next refresh needed
```

**Storage Priority**:
- **Production**: Supabase (survives container restarts/redeployments)
- **Development**: Supabase + .env file (dual storage for flexibility)
- **Memory**: Always used during runtime (no DB queries on every API call)



## Usage

### Automatic (Default)

The system runs automatically:
- **Scheduled**: Daily at 1:00 AM EST
- **On-Demand**: When receiving 401 errors from CLIO API

No manual intervention required!

### Manual Execution

#### Check and Refresh (if needed)

```bash
npm run token:refresh
```

This will:
- Check current token expiration
- Refresh if expiring within 24 hours
- Display status and new expiration time

#### Force Refresh (immediately)

```javascript
import { TokenRefreshService } from './src/services/token-refresh.js';

await TokenRefreshService.refreshAccessToken();
```

### Monitoring

#### Check Token Status

```javascript
import { TokenRefreshService } from './src/services/token-refresh.js';

// Initialize (reads current expiry)
TokenRefreshService.initialize();

// Check if needs refresh
const needsRefresh = TokenRefreshService.needsRefresh(24); // 24 hours

// Get time remaining
const timeLeft = TokenRefreshService.getTimeUntilExpiry(); // e.g., "6d 12h"
```

#### Logs

The system logs token refresh events:

```
🔍 Checking token expiration status...
   Current time: 2025-11-06T05:00:00.000Z
   Token expires: 2025-11-13T05:00:00.000Z
   Time remaining: 7d 0h
✅ Token is still valid, no refresh needed
```

When refreshing:

```
🔄 Refreshing CLIO access token...
✅ Token refreshed successfully
   Expires in: 604800 seconds (7 days)
   New expiry: 2025-11-20T05:00:00.000Z
💾 Updated .env file with new access token
```

## Schedule Overview

All scheduled jobs (America/New_York timezone):

| Time    | Job               | Description                                    |
|---------|-------------------|------------------------------------------------|
| 1:00 AM | Token Refresh     | Refreshes token if expiring within 24 hours    |
| 2:00 AM | Webhook Renewal   | Renews webhooks expiring within 7 days         |
| 3:00 AM | Stale Matter Check| Creates tasks for stalled funding matters      |

## Error Handling

### Token Refresh Failures

If token refresh fails:
1. Error is logged with details
2. Job continues (doesn't crash server)
3. Will retry next day (or on next API call)
4. Check logs for error messages

Common issues:
- Invalid client credentials
- Refresh token revoked by user
- Network connectivity problems

### API Call Failures

If a 401 error occurs and refresh fails:
1. Original error is returned to caller
2. Error includes refresh failure details
3. Check token configuration

## Security Best Practices

1. **Never commit credentials**
   - Keep `.env` in `.gitignore`
   - Use `.env.example` for templates

2. **Secure token storage**
   - Refresh tokens are long-lived
   - Store with appropriate file permissions
   - Consider encrypted storage for production

3. **Monitor token usage**
   - Review logs for refresh patterns
   - Alert on repeated failures
   - Track token lifecycle

## Troubleshooting

### Token refresh fails with "invalid_client"

**Problem**: Client ID or Client Secret is incorrect

**Solution**:
1. Verify `CLIO_CLIENT_ID` in `.env`
2. Verify `CLIO_CLIENT_SECRET` in `.env`
3. Check CLIO Developer Dashboard for correct values

### Token refresh fails with "invalid_grant"

**Problem**: Refresh token is invalid or revoked

**Solution**:
1. User may have revoked access in CLIO
2. Re-authorize the application
3. Update `CLIO_REFRESH_TOKEN` in `.env`

### Tokens refresh but API still returns 401

**Problem**: Token not updating in axios client

**Solution**:
1. Verify `ClioService.initializeInterceptors()` is called on startup
2. Check `src/index.js` initialization code
3. Restart the application

### Token expiration shows "Unknown"

**Problem**: Token service not initialized

**Solution**:
1. Ensure `TokenRefreshService.initialize()` is called on startup
2. Check `src/index.js` for initialization code

## Testing

### Test Token Refresh

```bash
# Run token refresh job manually
npm run token:refresh

# Expected output:
# 🔍 Checking token expiration status...
#    Current time: 2025-11-06T12:00:00.000Z
#    Token expires: 2025-11-07T10:00:00.000Z
#    Time remaining: 0d 22h
# ⚠️  Token expires within 24 hours, refreshing now...
# 🔄 Refreshing CLIO access token...
# ✅ Token refreshed successfully
```

### Test API Interceptor

Temporarily set an invalid access token:

```bash
CLIO_ACCESS_TOKEN=invalid_token_for_testing npm start
```

Make an API call - should auto-refresh and succeed.

## Migration Notes

### Upgrading from Static Tokens

If you were using static `CLIO_ACCESS_TOKEN` before:

1. Add new environment variables to `.env`:
   ```bash
   CLIO_CLIENT_ID=...
   CLIO_CLIENT_SECRET=...
   CLIO_REFRESH_TOKEN=...
   ```

2. Keep existing `CLIO_ACCESS_TOKEN` (it will be auto-updated)

3. Restart the application

4. Verify token refresh works:
   ```bash
   npm run token:refresh
   ```

### No Downtime Upgrade

The system is backwards compatible:
- If new variables are missing, logs warnings
- Existing tokens continue to work until expiry
- Add variables and restart when ready

## API Reference

### TokenRefreshService

#### Methods

**`initialize()`**
- Initializes token expiration tracking
- Called automatically on app startup
- Sets default expiry to 7 days from now

**`needsRefresh(hours = 24)`**
- Returns: `boolean`
- Checks if token expires within specified hours
- Default: 24 hours

**`getTimeUntilExpiry()`**
- Returns: `string` (e.g., "6d 12h")
- Human-readable time until token expires
- Returns "Expired" if already expired

**`refreshAccessToken()`**
- Returns: `Promise<Object>` with `{ access_token, expires_in, expires_at }`
- Refreshes token via CLIO OAuth endpoint
- Updates token in memory and .env file
- Thread-safe (prevents concurrent refreshes)

**`checkAndRefresh()`**
- Returns: `Promise<boolean>` - true if refreshed, false if not needed
- Checks expiration and refreshes if within 24 hours
- Main method used by scheduled job

## References

- [CLIO Authorization Documentation](https://docs.developers.clio.com/api-docs/authorization/)
- [OAuth 2.0 Refresh Token Flow](https://oauth.net/2/grant-types/refresh-token/)
- CLIO Developer Dashboard: https://app.clio.com/settings/developer_applications

## Support

For issues or questions:
1. Check logs for detailed error messages
2. Review this documentation
3. Verify environment variables are correct
4. Test manually with `npm run token:refresh`
