# SHLF Legal Practice Automation System

Automated task management system for Estate Planning and Probate legal practice, replacing Make.com with a custom backend API.

## Overview

This system automates three critical workflows:

1. **Matter Stage Changes** - Automatically creates tasks when matters move through workflow stages
2. **Task Completion** - Creates follow-up tasks and attempt sequences when tasks are completed
3. **Meeting Scheduling** - Updates task due dates when meetings are booked with clients

## Features

✅ **3-Minute Rollback Protection** - Prevents duplicate tasks if stage changes quickly
✅ **Smart Assignee Resolution** - Dynamically assigns tasks based on location, attorney, or role
✅ **Weekend Protection** - Automatically shifts weekend due dates to Monday
✅ **Attempt Sequences** - Auto-creates Attempt 1 → 2 → 3 → No Response chains
✅ **Dependent Tasks** - Updates due dates for tasks dependent on other tasks
✅ **Special Meeting Handling** - Signing meetings use meeting location for assignment
✅ **Error Handling** - 3 automatic retries with 1-second intervals
✅ **Comprehensive Logging** - Track every action for debugging and auditing

## Architecture

```
Clio Webhooks → Express Server → Automation Logic → Clio API + Supabase
```

### Project Structure

```
shlf-automations/
├── src/
│   ├── automations/
│   │   ├── matter-stage-change.js    # Automation #1
│   │   ├── task-completion.js        # Automation #2
│   │   └── meeting-scheduled.js      # Automation #3
│   ├── services/
│   │   ├── clio.js                   # Clio API integration
│   │   └── supabase.js               # Supabase data access
│   ├── utils/
│   │   ├── date-helpers.js           # Date calculations, weekend logic
│   │   └── assignee-resolver.js     # Dynamic assignee resolution
│   ├── routes/
│   │   └── webhooks.js               # Webhook endpoints
│   ├── config/
│   │   └── index.js                  # Configuration
│   └── index.js                      # Main server
├── package.json
├── .env.example
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+
- Supabase account with existing database
- Clio account with API access

### Installation

1. Clone the repository:
```bash
cd /Users/macbookpro/Business/shlf-automations
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
```

4. Edit `.env` with your credentials:
```env
PORT=3000
NODE_ENV=development

SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

CLIO_API_BASE_URL=https://app.clio.com
CLIO_ACCESS_TOKEN=your_clio_token

TIMEZONE_OFFSET_HOURS=4
```

### Running

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will start on port 3000 (or your configured PORT).

## Webhook Configuration

Configure these webhooks in Clio to point to your server:

### 1. Matter Webhook
- **URL**: `https://your-domain.com/webhooks/matters`
- **Events**: Matter created, Matter updated
- **Purpose**: Triggers task generation when matter stage changes

### 2. Task Webhook
- **URL**: `https://your-domain.com/webhooks/tasks`
- **Events**: Task updated
- **Purpose**: Handles task completions and creates follow-up tasks

### 3. Calendar Webhook
- **URL**: `https://your-domain.com/webhooks/calendar`
- **Events**: Calendar entry created, Calendar entry updated
- **Purpose**: Updates task due dates when meetings are scheduled

## API Endpoints

### Webhooks

- `POST /webhooks/matters` - Matter stage change automation
- `POST /webhooks/tasks` - Task completion automation
- `POST /webhooks/calendar` - Meeting scheduled automation
- `GET /webhooks/health` - Health check

### Root

- `GET /` - System information and status

## Business Logic

### Automation #1: Matter Stage Changes

**Flow:**
1. Webhook receives matter update
2. Wait 1 second for API consistency
3. Fetch full matter details from Clio
4. Check for stage changes within 3-minute window
5. Delete previous tasks if within rollback window
6. Fetch task templates (Estate Planning or Probate)
7. Resolve assignees dynamically (CSC, PARALEGAL, ATTORNEY, FUND TABLE)
8. Calculate due dates with weekend protection
9. Create tasks in Clio
10. Record in Supabase

### Automation #2: Task Completion

**Flow:**
1. Webhook receives task update
2. Fetch task details from Clio and Supabase
3. Check for attempt sequences:
   - Attempt 1 → Create Attempt 2
   - Attempt 2 → Create Attempt 3
   - Attempt 3 → Create No Response
4. Check for dependent tasks (due_date_relation: "after task X")
5. Update or create tasks as needed

### Automation #3: Meeting Scheduled

**Flow:**
1. Webhook receives calendar entry
2. Map calendar event type to stage ID:
   - 334801 → Stage 707058 (Initial Consultation)
   - 334816 → Stage 707073 (Signing Meeting - uses meeting location)
   - 334846 → Stage 828078 (Vision Meeting)
   - 334831 → Stage 828078 (Initial Meeting)
3. Record meeting in Supabase
4. Fetch task templates for meeting type
5. Calculate due dates relative to meeting time
6. Update existing tasks OR create new ones

## Assignee Resolution

The system dynamically resolves assignees based on type:

- **CSC**: Queries `assigned_user_reference` by location (or meeting location for signing meetings)
- **PARALEGAL**: Queries by attorney_id
- **ATTORNEY**: Uses matter's originating attorney
- **FUND TABLE**: Queries by fund_table reference
- **Direct Assignment**: Uses assignee name as-is (e.g., "VA", specific user names)

## Date Calculations

### Weekend Protection
All due dates are checked - if they fall on Saturday or Sunday, they're automatically shifted to the following Monday.

### Due Date Relations
- **"after creation"** - X days/hours from task generation
- **"before meeting"** - X days before meeting time
- **"after meeting"** - X days after meeting time
- **"after task X"** - X days after task X completion
- **"now"** - Immediate (current time)

## Error Handling

### Automatic Retries
All webhook processing includes 3 automatic retry attempts with 1-second delays.

### Error Tasks
When assignee resolution fails (missing location, no attorney, etc.), the system creates an error task alerting the team.

### Logging
All operations are logged to console with timestamps and status indicators:
- ✅ Success
- ⚠️ Warning
- ❌ Error
- 🔄 Processing
- ⏪ Rollback

## Database Schema

### Supabase Tables Used

**Reference Tables:**
- `assigned_user_reference` - User assignments by location/attorney/fund table
- `task-list-non-meeting` - Estate Planning task templates (48 records)
- `task-list-meeting` - Meeting-based task templates (22 records)
- `task-list-probate` - Probate task templates (105 records)

**Transaction Tables:**
- `tasks` - All created tasks (5,455+ records)
- `matters` - Matter stage change history (1,492+ records)
- `matter-info` - Current matter state (542+ records)
- `matters-meetings-booked` - Meeting records (2,595+ records)

## Monitoring

### Health Check
```bash
curl http://localhost:3000/webhooks/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-01T12:00:00.000Z",
  "automations": [
    "matter-stage-change",
    "task-completion",
    "meeting-scheduled"
  ]
}
```

### Logs
All operations log to console with detailed status:
```
2025-10-01T12:00:00.000Z - POST /webhooks/matters
📨 Received matter webhook
🔄 Processing matter stage change: 1234567
📥 Fetching matter details from Clio...
   Stage: Initial Consultation (ID: 707058)
   Practice Area: Estate Planning
🔍 Checking for recent stage changes...
📋 Fetching task templates...
   Found 5 task templates
🔨 Generating tasks...
   ✓ Created: Open client portal (Due: 2025-10-02)
   ✓ Created: Send engagement letter (Due: 2025-10-03)
✅ Matter stage change automation completed
```

## Testing

Test webhooks using curl:

```bash
# Test matter stage change
curl -X POST http://localhost:3000/webhooks/matters \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "id": 1234567,
      "matter_stage": {
        "id": 707058,
        "name": "Initial Consultation"
      }
    }
  }'

# Test task completion
curl -X POST http://localhost:3000/webhooks/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "id": 9876543,
      "status": "complete"
    }
  }'

# Test meeting scheduled
curl -X POST http://localhost:3000/webhooks/calendar \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "id": 5555555,
      "calendar_entry_event_type": {
        "id": 334816
      },
      "matter": {
        "id": 1234567
      }
    }
  }'
```

## Deployment

### Environment Variables (Production)
Ensure these are set in your production environment:
- `NODE_ENV=production`
- `PORT=3000` (or your preferred port)
- `SUPABASE_URL` and `SUPABASE_KEY`
- `CLIO_ACCESS_TOKEN`
- `CLIO_WEBHOOK_SECRET` (for signature verification - future enhancement)

### Recommended Setup
- Use a process manager like PM2 for auto-restart
- Set up HTTPS/SSL with nginx or similar
- Configure firewall to allow webhook traffic
- Set up monitoring/alerting for errors
- Enable log aggregation

## Migration from Make.com

This system replicates the exact functionality from Make.com blueprints:
- `001a - Clio Tasks Automation(EP & PRB) - Supabase`
- `001b - Due Date After Task Completion (EP & PRB) - Supabase`
- `001c - Due Date Relative to Meeting (EP) - Supabase`

### Key Differences
✅ **No monthly Make.com fees**
✅ **Full control over business logic**
✅ **Easier debugging with detailed logs**
✅ **Version control for all code**
✅ **Can run locally for development/testing**

### Known Limitations (Compared to Make.com)
- No webhook signature verification yet (planned improvement)
- No built-in UI for configuration (uses Supabase directly)
- Manual deployment vs Make.com's cloud hosting

## Troubleshooting

### Common Issues

**Tasks not being created:**
- Check Supabase connection
- Verify task templates exist for the stage
- Check assignee resolution (location, attorney exists)
- Review logs for specific errors

**Duplicate tasks:**
- Check 3-minute rollback window is working
- Verify matter-info table is updating correctly
- Check for multiple webhook deliveries from Clio

**Wrong assignees:**
- Verify `assigned_user_reference` table has correct mappings
- Check matter has location/attorney data
- Review logs for assignee resolution

**Due dates on weekends:**
- Check date-helpers weekend logic
- Verify timezone offset is correct

## Support

For issues or questions:
1. Check logs for detailed error messages
2. Review the technical flow canvas in Obsidian
3. Verify Supabase data and Clio API access
4. Test with curl commands to isolate webhook vs logic issues

## License

Proprietary - SHLF Legal Practice
