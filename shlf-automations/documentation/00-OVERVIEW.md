# Clio Manage Automation System - Overview

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [System Components](#system-components)
- [Data Flow](#data-flow)
- [Technology Stack](#technology-stack)
- [Directory Structure](#directory-structure)

---

## Architecture Overview

This automation system integrates with Clio Manage (legal practice management software) to automate task creation, calendar management, and workflow orchestration for a legal firm.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIO MANAGE                              │
│  (Legal Practice Management Software)                            │
│                                                                   │
│  Events:                                                          │
│  - Matter stage changes                                           │
│  - Task completions/deletions                                     │
│  - Calendar entry create/update/delete                            │
│  - Document uploads                                               │
│  - Matter status changes (closed)                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Webhooks (HTTPS)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS.JS SERVER                             │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │  Middleware │  │  Webhook     │  │  Per-Matter    │          │
│  │  - Raw Body │──│  Routes      │──│  Queue System  │          │
│  │  - Signature│  │  /webhooks/* │  │                │          │
│  └─────────────┘  └──────────────┘  └───────┬────────┘          │
│                                              │                    │
│  ┌───────────────────────────────────────────┴────────────────┐ │
│  │                    AUTOMATIONS LAYER                        │ │
│  │  ┌───────────────┐ ┌──────────────┐ ┌────────────────────┐ │ │
│  │  │ Matter Stage  │ │ Task         │ │ Meeting Scheduled  │ │ │
│  │  │ Change        │ │ Completion   │ │                    │ │ │
│  │  └───────────────┘ └──────────────┘ └────────────────────┘ │ │
│  │  ┌───────────────┐ ┌──────────────┐ ┌────────────────────┐ │ │
│  │  │ Matter Closed │ │ Task Deleted │ │ Calendar Entry     │ │ │
│  │  │               │ │              │ │ Deleted            │ │ │
│  │  └───────────────┘ └──────────────┘ └────────────────────┘ │ │
│  │  ┌───────────────┐                                          │ │
│  │  │ Document      │                                          │ │
│  │  │ Created       │                                          │ │
│  │  └───────────────┘                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │ Clio API    │  │  Supabase    │  │  Job Scheduler │          │
│  │ Service     │  │  Service     │  │  (node-cron)   │          │
│  └─────────────┘  └──────────────┘  └────────────────┘          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│    CLIO REST API    │         │      SUPABASE       │
│                     │         │                     │
│  - Create tasks     │         │  - Task tracking    │
│  - Update matters   │         │  - Meeting records  │
│  - Fetch data       │         │  - Error logs       │
│  - Manage webhooks  │         │  - Task templates   │
└─────────────────────┘         │  - Assignee lookup  │
                                │  - OAuth tokens     │
                                └─────────────────────┘
```

---

## System Components

### 1. Webhook Receiver (Entry Point)
- **Location:** `src/routes/webhooks.js`
- **Purpose:** Receives webhooks from Clio and routes to appropriate automation
- **Endpoints:** `/webhooks/matters`, `/webhooks/tasks`, `/webhooks/calendar`, `/webhooks/documents`

### 2. Automations (Business Logic)
- **Location:** `src/automations/`
- **Purpose:** Process webhook events and execute business rules
- **7 Automations:**
  - Matter Stage Change
  - Task Completion
  - Meeting Scheduled
  - Matter Closed
  - Task Deleted
  - Calendar Entry Deleted
  - Document Created

### 3. Services Layer
- **Location:** `src/services/`
- **Components:**
  - `clio.js` - Clio REST API client with auto-token refresh
  - `supabase.js` - Database operations and queries
  - `token-refresh.js` - OAuth token management
  - `task-verification.js` - Post-creation verification

### 4. Scheduled Jobs
- **Location:** `src/jobs/`
- **Jobs:**
  - Token Refresh (1:00 AM EST daily)
  - Webhook Renewal (2:00 AM EST daily)
  - Stale Matter Checker (3:00 AM EST daily)

### 5. Utilities
- **Location:** `src/utils/`
- **Components:**
  - `webhook-queue.js` - Per-matter sequential processing
  - `assignee-resolver.js` - Dynamic assignee lookup
  - `date-helpers.js` - Date calculations and formatting

---

## Data Flow

### Webhook Processing Flow

```
1. CLIO EVENT OCCURS
   │
2. WEBHOOK SENT TO SERVER
   │
3. RAW BODY PRESERVATION (middleware)
   │
4. SIGNATURE VALIDATION (middleware - currently disabled)
   │
5. PER-MATTER QUEUE ENQUEUE
   │ (prevents race conditions for same matter)
   │
6. 3x RETRY LOGIC
   │ (1-second delays between retries)
   │
7. IDEMPOTENCY CHECK
   │ (check webhook_events table)
   │
8. AUTOMATION PROCESSOR
   ├── Fetch additional data from Clio API
   ├── Resolve assignees from database
   ├── Calculate due dates
   ├── Create tasks/updates in Clio
   └── Record in Supabase
   │
9. POST-VERIFICATION (if applicable)
   │ (wait 30 seconds, verify all tasks created)
   │
10. RESPONSE TO CLIO (200 OK)
```

### Task Creation Flow (Matter Stage Change)

```
MATTER STAGE CHANGES IN CLIO
           │
           ▼
┌──────────────────────────────┐
│ 1. Receive Webhook           │
│    - Extract matter_id       │
│    - Extract stage info      │
│    - Extract timestamp       │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. Idempotency Check         │
│    - Generate idempotency key│
│    - Check webhook_events    │
│    - Skip if already done    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. Rollback Detection        │
│    - Check matters table     │
│    - If within 3 minutes     │
│    - Delete previous tasks   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 4. Fetch Task Templates      │
│    - task-list-non-meeting   │
│    - OR task-list-probate    │
│    - Filter by stage_id      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 5. For Each Template:        │
│    - Resolve assignee        │
│    - Calculate due date      │
│    - Weekend protection      │
│    - Create task in Clio     │
│    - Record in Supabase      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 6. Post-Verification         │
│    - Wait 30 seconds         │
│    - Query Supabase          │
│    - Regenerate missing tasks│
└──────────────────────────────┘
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js |
| Web Framework | Express.js |
| Database | Supabase (PostgreSQL) |
| External API | Clio REST API v4 |
| Scheduling | node-cron |
| Date Handling | date-fns |
| HTTP Client | axios |
| Environment | dotenv |

---

## Directory Structure

```
shlf-automations/
├── src/
│   ├── index.js                    # Server entry point
│   ├── config/
│   │   └── index.js                # Configuration loader
│   ├── constants/
│   │   └── error-codes.js          # Error code definitions
│   ├── routes/
│   │   └── webhooks.js             # Webhook endpoints
│   ├── middleware/
│   │   ├── validate-signature.js   # HMAC validation
│   │   └── raw-body.js             # Body preservation
│   ├── automations/
│   │   ├── matter-stage-change.js  # Stage change automation
│   │   ├── task-completion.js      # Task complete automation
│   │   ├── meeting-scheduled.js    # Meeting automation
│   │   ├── matter-closed.js        # Matter closed automation
│   │   ├── task-deleted.js         # Task deletion automation
│   │   ├── calendar-entry-deleted.js
│   │   └── document-created.js     # Document automation
│   ├── services/
│   │   ├── clio.js                 # Clio API service
│   │   ├── supabase.js             # Database service
│   │   ├── token-refresh.js        # OAuth management
│   │   └── task-verification.js    # Verification service
│   ├── utils/
│   │   ├── webhook-queue.js        # Queue system
│   │   ├── assignee-resolver.js    # Assignee lookup
│   │   ├── assignee-error.js       # Error class
│   │   └── date-helpers.js         # Date utilities
│   └── jobs/
│       ├── scheduler.js            # Job scheduler
│       ├── refresh-token.js        # Token job
│       ├── renew-webhooks.js       # Webhook job
│       └── check-stale-matters.js  # Stale matter job
├── utilities/
│   └── webhooks/                   # Webhook setup scripts
├── migrations/                     # SQL migrations
├── documentation/                  # This documentation
├── package.json
├── .env.example
└── README.md
```

---

## Key Design Patterns

### 1. Idempotency
Every webhook is tracked with a unique idempotency key in the `webhook_events` table. This prevents duplicate processing if Clio sends the same webhook multiple times.

### 2. Per-Matter Queueing
Webhooks for the same matter are processed sequentially (not concurrently) to prevent race conditions. Different matters can process in parallel.

### 3. Retry Logic
Each webhook processor has 3x retry logic with 1-second delays between attempts to handle transient failures.

### 4. Rollback Protection
A 3-minute window detects rapid stage reversals and deletes duplicate tasks to prevent accumulation.

### 5. Weekend Protection
All due dates are automatically shifted to Monday if they fall on a weekend.

### 6. Dynamic Assignee Resolution
Assignees are resolved at runtime based on:
- Matter location (for CSC)
- Attorney ID (for paralegal, fund table)
- Direct user ID
- Role-based assignment

### 7. Token Auto-Refresh
The Clio API client automatically refreshes the OAuth token when receiving 401 errors.

### 8. Post-Verification
After task creation, a verification service confirms all expected tasks exist and regenerates any missing ones.

---

## Related Documentation

- [01-WEBHOOK-ENDPOINTS.md](./01-WEBHOOK-ENDPOINTS.md) - Webhook endpoint details
- [02-AUTOMATIONS.md](./02-AUTOMATIONS.md) - Automation flow documentation
- [03-SCHEDULED-JOBS.md](./03-SCHEDULED-JOBS.md) - Scheduled job documentation
- [04-DATABASE-SCHEMA.md](./04-DATABASE-SCHEMA.md) - Database tables and schema
- [05-ERROR-HANDLING.md](./05-ERROR-HANDLING.md) - Error codes and handling
- [06-SERVICES.md](./06-SERVICES.md) - Service layer documentation
- [07-UTILITIES.md](./07-UTILITIES.md) - Utility functions documentation
