# Safe Harbor Law - Data Flow & Automation Documentation

**Last Updated:** November 2024
**Purpose:** Complete documentation of all data flows, automations, and business logic

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Client Intake Flow](#2-client-intake-flow)
3. [Appointment Booking Flow](#3-appointment-booking-flow)
4. [Opportunity Stage Workflow](#4-opportunity-stage-workflow)
5. [Task Management Flow](#5-task-management-flow)
6. [Invoice & Payment Flow](#6-invoice--payment-flow)
7. [Workshop Event Flow](#7-workshop-event-flow)
8. [Email & SMS Automation](#8-email--sms-automation)
9. [Decision Trees & Conditions](#9-decision-trees--conditions)
10. [Error Handling & Retry Logic](#10-error-handling--retry-logic)

---

## 1. System Architecture

### 1.1 High-Level Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SOURCES                                │
├─────────────┬───────────────┬────────────────┬──────────────────────────────┤
│   JotForm   │   GHL Events  │    Confido     │         Cron Jobs            │
│   Forms     │   (Webhooks)  │   (Payments)   │     (Scheduled Tasks)        │
└──────┬──────┴───────┬───────┴────────┬───────┴──────────────┬───────────────┘
       │              │                │                      │
       ▼              ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXPRESS SERVER (server.js)                           │
│                              Port 3000                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Routes:                                                                     │
│  • /webhook/jotform          • /webhooks/ghl/opportunity-stage-changed      │
│  • /webhook/jotform-intake   • /webhooks/ghl/task-created                   │
│  • /webhooks/intakeForm      • /webhooks/ghl/task-completed                 │
│  • /workshop                 • /webhooks/ghl/appointment-created            │
│                              • /webhooks/ghl/invoice-created                │
│                              • /webhooks/ghl/custom-object-*                │
│                              • /webhooks/confido/payment-received           │
└─────────────────────────────────────────────────────────────────────────────┘
       │              │                │                      │
       ▼              ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SERVICE LAYER                                     │
├─────────────┬───────────────┬────────────────┬──────────────────────────────┤
│ ghlService  │ appointment   │ invoice        │ confido                      │
│ ghlOppty    │ Service       │ Service        │ Service                      │
│ ghlTask     │ EmailService  │ PdfService     │                              │
│             │ SmsService    │ EmailService   │                              │
└──────┬──────┴───────┬───────┴────────┬───────┴──────────────┬───────────────┘
       │              │                │                      │
       ▼              ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DESTINATIONS                               │
├─────────────┬───────────────┬────────────────┬──────────────────────────────┤
│   GHL API   │   Supabase    │   Confido API  │         Make.com             │
│   (CRM)     │   (Database)  │   (Payments)   │        (Emails)              │
└─────────────┴───────────────┴────────────────┴──────────────────────────────┘
```

### 1.2 Data Flow Summary

| Flow | Source | Destination | Purpose |
|------|--------|-------------|---------|
| Form Submission | JotForm | GHL + Supabase | Client intake |
| Appointment | GHL Calendar | GHL + Make.com | Meeting management |
| Stage Change | GHL Workflow | GHL Tasks + Supabase | Task automation |
| Invoice | GHL Invoice | Confido + Supabase | Payment processing |
| Payment | Confido | GHL + Supabase | Payment recording |
| Tasks | GHL CRM | Supabase | Task reporting |

---

## 2. Client Intake Flow

### 2.1 Estate Planning Form Flow

```
┌─────────────────┐
│    JotForm      │
│ Estate Planning │
│     Form        │
└────────┬────────┘
         │ Webhook POST /webhook/jotform
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Parse Form Data (jotformParser.js)                      │
├─────────────────────────────────────────────────────────────────┤
│ Extract from rawRequest:                                        │
│ • Contact info (name, email, phone, address)                    │
│ • Spouse information                                            │
│ • Beneficiaries (1-5)                                          │
│ • Bank accounts (1-5)                                          │
│ • Financial advisor details                                     │
│ • Accountant details                                            │
│ • Power of Attorney designations                                │
│ • Healthcare preferences                                        │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Map to GHL Format (dataMapper.js)                       │
├─────────────────────────────────────────────────────────────────┤
│ Using jotform-to-ghl-mapping.json:                              │
│ • Map beneficiaries → nested custom fields                      │
│ • Map bank accounts → nested custom fields                      │
│ • Map spouse → nested custom field                              │
│ • Map advisors → nested custom fields                           │
│ • Convert phone numbers to E.164 format                         │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Create/Update GHL Contact (ghlService.js)               │
├─────────────────────────────────────────────────────────────────┤
│ Duplicate Detection:                                            │
│ 1. Search by phone number                                       │
│ 2. Search by email                                              │
│ 3. If found → UPDATE existing contact                           │
│ 4. If not found → CREATE new contact                            │
│                                                                 │
│ Fields Set:                                                     │
│ • firstName, lastName, email, phone                             │
│ • address1, city, state, postalCode                            │
│ • All custom fields from mapping                                │
│ • tags: ["Estate Planning Form"]                                │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Create Opportunity (ghlService.js)                      │
├─────────────────────────────────────────────────────────────────┤
│ • Pipeline: Estate Planning Pipeline                            │
│ • Stage: "Pending Contact"                                      │
│ • Name: "{Contact Name} - Estate Planning"                      │
│ • Status: "open"                                                │
│ • Linked to contact                                             │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Upload PDF (pdfService.js) [Optional]                   │
├─────────────────────────────────────────────────────────────────┤
│ Condition: If PDF_UPLOAD_REQUESTED                              │
│                                                                 │
│ 1. Download PDF from JotForm API                                │
│    GET /form/{formId}/submissions/{submissionId}/files/{field}  │
│                                                                 │
│ 2. Check for existing PDF in contact                            │
│    → If exists, will replace                                    │
│                                                                 │
│ 3. Upload to GHL custom field                                   │
│    → Field: GHL_PDF_FIELD_ID                                   │
│    → Filename: "{ContactName}_EP_Form.pdf"                     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Intake Form Flow

```
┌─────────────────┐
│    JotForm      │
│   Intake Form   │
└────────┬────────┘
         │ Webhook POST /webhook/jotform-intake or /webhooks/intakeForm
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Parse Intake Data (jotformIntakeParser.js)              │
├─────────────────────────────────────────────────────────────────┤
│ Extract:                                                        │
│ • Contact information                                           │
│ • Practice area of interest                                     │
│ • Call details (date, time, notes)                             │
│ • Document uploads                                              │
│ • Source/referral information                                   │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Map to GHL (intakeDataMapper.js)                        │
├─────────────────────────────────────────────────────────────────┤
│ • Map call details to custom fields                             │
│ • Store JotForm submission link                                 │
│ • Set practice area tags                                        │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Create/Update Contact & Opportunity                     │
├─────────────────────────────────────────────────────────────────┤
│ Same flow as Estate Planning form                               │
│ • Duplicate detection                                           │
│ • Create opportunity in "Pending Contact" stage                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Intake Survey Completion Flow

```
┌─────────────────────────┐
│   GHL Survey/Form       │
│   Completion Trigger    │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/intakeSurvey
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Extract Contact ID                                      │
├─────────────────────────────────────────────────────────────────┤
│ From webhook payload:                                           │
│ • contact_id                                                    │
│ • form_id                                                       │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Find Linked Opportunity                                 │
├─────────────────────────────────────────────────────────────────┤
│ GET /opportunities/?contact_id={contactId}                      │
│                                                                 │
│ Filter:                                                         │
│ • Pipeline: Estate Planning Pipeline                            │
│ • Status: "open"                                                │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Check Current Stage                                     │
├─────────────────────────────────────────────────────────────────┤
│ Condition Check:                                                │
│                                                                 │
│ IF current stage == "Intake Survey" stage                       │
│   → PROCEED to move opportunity                                 │
│                                                                 │
│ ELSE (opportunity already moved)                                │
│   → EXIT (no action needed)                                     │
└───────────┬─────────────────────────────────────────────────────┘
            │ (if stage matches)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Move to "Pending I/V" Stage                             │
├─────────────────────────────────────────────────────────────────┤
│ PUT /opportunities/{opportunityId}                              │
│ Body: { "stageId": "pending_iv_stage_id" }                     │
│                                                                 │
│ This triggers:                                                  │
│ → Opportunity stage changed webhook                             │
│ → Task creation for "Pending I/V" stage                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Appointment Booking Flow

### 3.1 Complete Appointment Flow

```
┌─────────────────────────┐
│   GHL Calendar          │
│   Appointment Booked    │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/ghl/appointment-created
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Extract Appointment Data                                │
├─────────────────────────────────────────────────────────────────┤
│ From webhook:                                                   │
│ • appointment_id                                                │
│ • calendar_id                                                   │
│ • contact_id                                                    │
│ • contact_phone                                                 │
│ • start_time, end_time                                         │
│ • title (original)                                              │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Get Calendar Details                                    │
├─────────────────────────────────────────────────────────────────┤
│ GET /calendars/{calendarId}                                     │
│                                                                 │
│ Extract:                                                        │
│ • Calendar name (used in title)                                 │
│ • Calendar type                                                 │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Find Booking Form Submission                            │
├─────────────────────────────────────────────────────────────────┤
│ GET /forms/{GHL_APPOINTMENT_FORM_ID}/submissions                │
│ Search by: contact phone number                                 │
│                                                                 │
│ Note: Uses retry logic (up to 5 attempts, 2s delay)            │
│ → Form submission may not be immediately available              │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Extract Meeting Data                                    │
├─────────────────────────────────────────────────────────────────┤
│ From form submission:                                           │
│ • meeting_type (dropdown selection)                             │
│ • meeting_location (In-Person Naples/Fort Myers, Zoom)         │
│                                                                 │
│ Meeting Types:                                                  │
│ • Initial Meeting                                               │
│ • Vision Meeting                                                │
│ • Standalone Meeting                                            │
│ • Probate Discovery Call                                        │
│ • EP Discovery Call                                             │
│ • Deed Discovery Call                                           │
│ • Trust Admin Meeting                                           │
│ • Doc Review Meeting                                            │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Update Appointment Title                                │
├─────────────────────────────────────────────────────────────────┤
│ New Title Format:                                               │
│ "{Calendar Name} - {Meeting Type} - {Location} - {Contact}"    │
│                                                                 │
│ Example:                                                        │
│ "Attorney Calendar - Initial Meeting - Naples - John Doe"      │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Check If Opportunity Should Move                        │
├─────────────────────────────────────────────────────────────────┤
│ Decision Logic (see Section 9.1 for details):                   │
│                                                                 │
│ IF meeting_type IN ["Probate Discovery Call",                   │
│                     "EP Discovery Call",                        │
│                     "Deed Discovery Call"]                      │
│   → target_stage = "Scheduled Discovery Call"                  │
│                                                                 │
│ ELSE IF meeting_type IN ["Initial Meeting",                     │
│                          "Vision Meeting",                      │
│                          "Standalone Meeting",                  │
│                          "Trust Admin Meeting",                 │
│                          "Doc Review Meeting"]                  │
│   → target_stage = "Scheduled I/V"                             │
│                                                                 │
│ ELSE                                                            │
│   → No stage change                                             │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: Find and Move Opportunity                               │
├─────────────────────────────────────────────────────────────────┤
│ 1. Search opportunities by contact_id                           │
│ 2. Filter for open opportunities in pipeline                    │
│ 3. Update opportunity stage                                     │
│                                                                 │
│ PUT /opportunities/{opportunityId}                              │
│ Body: { "stageId": "{target_stage_id}" }                       │
│                                                                 │
│ This triggers → Stage change webhook                            │
│              → Task creation for new stage                      │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ├──────────────────────────────────┐
            ▼                                  ▼
┌─────────────────────────┐  ┌─────────────────────────────────────┐
│ Step 8A: Send Email     │  │ Step 8B: Send/Schedule SMS         │
│ (appointmentEmailSvc)   │  │ (appointmentSmsSvc)                │
├─────────────────────────┤  ├─────────────────────────────────────┤
│ Trigger Make.com        │  │ 1. Send confirmation SMS            │
│ webhook with:           │  │    immediately                      │
│ • Contact details       │  │                                     │
│ • Meeting type          │  │ 2. Schedule reminder SMS            │
│ • Meeting location      │  │    for 24 hours before              │
│ • Date/time            │  │    appointment                      │
│ • Office address        │  │                                     │
│ • Relevant links        │  │ Store in reminder queue             │
└─────────────────────────┘  └─────────────────────────────────────┘
```

### 3.2 Meeting Type to Stage Mapping

```
┌─────────────────────────────────────────────────────────────────┐
│                    MEETING TYPE → STAGE MAPPING                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────┐     ┌──────────────────────────┐  │
│  │ Probate Discovery Call  │────▶│                          │  │
│  ├─────────────────────────┤     │   "Scheduled Discovery   │  │
│  │ EP Discovery Call       │────▶│         Call"            │  │
│  ├─────────────────────────┤     │                          │  │
│  │ Deed Discovery Call     │────▶│                          │  │
│  └─────────────────────────┘     └──────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────┐     ┌──────────────────────────┐  │
│  │ Initial Meeting         │────▶│                          │  │
│  ├─────────────────────────┤     │                          │  │
│  │ Vision Meeting          │────▶│                          │  │
│  ├─────────────────────────┤     │     "Scheduled I/V"      │  │
│  │ Standalone Meeting      │────▶│                          │  │
│  ├─────────────────────────┤     │                          │  │
│  │ Trust Admin Meeting     │────▶│                          │  │
│  ├─────────────────────────┤     │                          │  │
│  │ Doc Review Meeting      │────▶│                          │  │
│  └─────────────────────────┘     └──────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Opportunity Stage Workflow

### 4.1 Stage Change Task Automation

```
┌─────────────────────────┐
│  GHL Opportunity        │
│  Moved to New Stage     │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/ghl/opportunity-stage-changed
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Extract Stage Information                               │
├─────────────────────────────────────────────────────────────────┤
│ From webhook payload:                                           │
│ • opportunity_id                                                │
│ • pipeline_stage_id                                             │
│ • pipeline_stage_name                                           │
│ • contact_id                                                    │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Query Task Templates from Supabase                      │
├─────────────────────────────────────────────────────────────────┤
│ SELECT * FROM ghl_task_list                                     │
│ WHERE stage_name = '{pipeline_stage_name}'                      │
│   AND active = true                                             │
│                                                                 │
│ Returns array of task templates:                                │
│ • task_title                                                    │
│ • task_description                                              │
│ • days_from_now (for due date calculation)                     │
│ • assigned_to (GHL user ID)                                    │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Create Tasks for Each Template                          │
├─────────────────────────────────────────────────────────────────┤
│ For each task template:                                         │
│                                                                 │
│ 1. Calculate due date (EST timezone):                           │
│    due_date = today + days_from_now                            │
│    Time: 9:00 AM EST                                            │
│                                                                 │
│ 2. Create task in GHL:                                          │
│    POST /contacts/{contactId}/tasks                             │
│    Body: {                                                      │
│      title: task_title,                                         │
│      body: task_description,                                    │
│      dueDate: calculated_due_date,                             │
│      assignedTo: assigned_to,                                   │
│      opportunityId: opportunity_id                              │
│    }                                                            │
│                                                                 │
│ 3. Log task creation                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Example Stage-Based Tasks

```
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE → TASKS MAPPING                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Stage: "Pending Contact"                                        │
│ ├── Task: "Initial outreach call" (Due: Today)                 │
│ └── Task: "Send welcome email" (Due: Today)                    │
│                                                                 │
│ Stage: "Scheduled Discovery Call"                               │
│ ├── Task: "Prepare discovery call notes" (Due: 1 day before)   │
│ └── Task: "Review client file" (Due: 1 day before)             │
│                                                                 │
│ Stage: "Scheduled I/V"                                          │
│ ├── Task: "Prepare interview materials" (Due: 2 days before)   │
│ ├── Task: "Review intake form" (Due: 1 day before)             │
│ └── Task: "Confirm appointment" (Due: 1 day before)            │
│                                                                 │
│ Stage: "Pending I/V"                                            │
│ ├── Task: "Schedule interview" (Due: 3 days)                   │
│ └── Task: "Send scheduling link" (Due: Today)                  │
│                                                                 │
│ Stage: "Documents in Progress"                                  │
│ ├── Task: "Draft estate plan" (Due: 7 days)                    │
│ └── Task: "Review with attorney" (Due: 10 days)                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Task Management Flow

### 5.1 Task Creation Sync

```
┌─────────────────────────┐
│  GHL Task Created       │
│  (manual or automated)  │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/ghl/task-created
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Extract Task Data                                       │
├─────────────────────────────────────────────────────────────────┤
│ From webhook:                                                   │
│ • task_id                                                       │
│ • task_name                                                     │
│ • description                                                   │
│ • contact_id                                                    │
│ • opportunity_id                                                │
│ • assigned_to (user ID)                                        │
│ • due_date                                                      │
│ • completed (boolean)                                           │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Get Assignee Name                                       │
├─────────────────────────────────────────────────────────────────┤
│ GET /users/{assignedTo}                                         │
│                                                                 │
│ If user exists:                                                 │
│   assignee_name = user.firstName + " " + user.lastName          │
│ Else:                                                           │
│   assignee_name = "Unassigned"                                  │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Sync to Supabase                                        │
├─────────────────────────────────────────────────────────────────┤
│ UPSERT INTO ghl_tasks                                           │
│ ON CONFLICT (ghl_task_id)                                       │
│ DO UPDATE SET ...                                               │
│                                                                 │
│ Fields:                                                         │
│ • ghl_task_id                                                   │
│ • task_name                                                     │
│ • description                                                   │
│ • contact_id                                                    │
│ • opportunity_id                                                │
│ • assignee_name                                                 │
│ • due_date                                                      │
│ • completed: false                                              │
│ • updated_at: NOW()                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Task Completion Sync

```
┌─────────────────────────┐
│  GHL Task Completed     │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/ghl/task-completed
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Validate Webhook Data                                   │
├─────────────────────────────────────────────────────────────────┤
│ Required fields:                                                │
│ • task_id                                                       │
│ • contact_id                                                    │
│ • title                                                         │
│                                                                 │
│ Validation:                                                     │
│ • completed == true                                             │
│                                                                 │
│ IF validation fails → Return error                              │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Update Supabase Record                                  │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE ghl_tasks                                                │
│ SET completed = true,                                           │
│     completed_at = NOW(),                                       │
│     updated_at = NOW()                                          │
│ WHERE ghl_task_id = '{task_id}'                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Invoice & Payment Flow

### 6.1 Invoice Creation Flow (Custom Object)

```
┌─────────────────────────┐
│  GHL Invoice Custom     │
│  Object Created         │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/ghl/custom-object-created
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Validate Custom Object Type                             │
├─────────────────────────────────────────────────────────────────┤
│ Check: schema_key == "invoices"                                 │
│                                                                 │
│ IF NOT invoice → Exit (handle other custom objects)             │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Wait for Opportunity Association                        │
├─────────────────────────────────────────────────────────────────┤
│ Retry Logic (up to 6 attempts, 10s delay):                      │
│                                                                 │
│ GET /relations/{recordId}                                       │
│                                                                 │
│ Look for association where:                                     │
│ • related_schema == "opportunities"                             │
│                                                                 │
│ IF found → Proceed with opportunity_id                          │
│ IF max retries → Log warning, continue without opportunity      │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Extract Invoice Data                                    │
├─────────────────────────────────────────────────────────────────┤
│ From custom object:                                             │
│ • record_id (GHL custom object ID)                             │
│ • contact_name                                                  │
│ • contact_email                                                 │
│ • service_items (JSON array)                                   │
│ • opportunity_id (from association)                             │
│                                                                 │
│ Calculate:                                                      │
│ • total = SUM(service_items.amount)                            │
│ • invoice_number = "INV-{YYYYMMDD}-{XXXX}"                     │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Create in Confido (3-Step GraphQL)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Step 4a: Find or Create Client                                  │
│ ├── Query: Find client by externalId (GHL contact_id)          │
│ ├── IF found: Use existing client_id                            │
│ └── IF not found: Create new client                             │
│     • name: contact_name                                        │
│     • email: contact_email                                      │
│     • externalId: contact_id                                    │
│                                                                 │
│ Step 4b: Find or Create Matter                                  │
│ ├── Query: Find matter by client_id + name                      │
│ ├── IF found: Use existing matter_id                            │
│ └── IF not found: Create new matter                             │
│     • name: opportunity_name or "General Matter"                │
│     • clientId: client_id                                       │
│                                                                 │
│ Step 4c: Create PaymentLink                                     │
│ • matterId: matter_id                                           │
│ • amount: total                                                 │
│ • description: invoice details                                  │
│ • externalId: record_id                                         │
│                                                                 │
│ Returns: payment_link_url                                       │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Update GHL Custom Object                                │
├─────────────────────────────────────────────────────────────────┤
│ PUT /custom/invoices/{recordId}                                 │
│                                                                 │
│ Set fields:                                                     │
│ • payment_link: payment_link_url                               │
│ • invoice_number: generated number                              │
│ • subtotal: calculated total                                    │
│ • total: calculated total                                       │
│ • status: "unpaid"                                              │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Save to Supabase                                        │
├─────────────────────────────────────────────────────────────────┤
│ INSERT INTO invoices                                            │
│ Values:                                                         │
│ • invoice_number                                                │
│ • ghl_record_id                                                 │
│ • confido_invoice_id                                            │
│ • contact_id, contact_name, contact_email                       │
│ • opportunity_id, opportunity_name                              │
│ • amount, subtotal                                              │
│ • status: "unpaid"                                              │
│ • payment_link_url                                              │
│ • service_items (JSONB)                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Invoice Update Flow

```
┌─────────────────────────┐
│  GHL Invoice Custom     │
│  Object Updated         │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/ghl/custom-object-updated
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Check for Existing Payment Link                         │
├─────────────────────────────────────────────────────────────────┤
│ From custom object fields:                                      │
│ • payment_link field                                            │
│                                                                 │
│ IF payment_link EXISTS AND is NOT empty                         │
│   → Check for duplicate, use existing                           │
│                                                                 │
│ IF payment_link EMPTY AND has service_items                     │
│   → Create new PaymentLink in Confido                           │
│   → Update custom object with payment URL                       │
│                                                                 │
│ IF no service_items                                             │
│   → Wait for more updates (service items pending)               │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Payment Received Flow

```
┌─────────────────────────┐
│  Confido Payment        │
│  Webhook                 │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/confido/payment-received
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Verify Webhook Signature                                │
├─────────────────────────────────────────────────────────────────┤
│ Verify HMAC signature using CONFIDO_WEBHOOK_SECRET              │
│                                                                 │
│ IF invalid → Return 401 Unauthorized                            │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Extract Payment Data                                    │
├─────────────────────────────────────────────────────────────────┤
│ From webhook:                                                   │
│ • payment_link_id (Confido invoice ID)                         │
│ • amount                                                        │
│ • payment_method                                                │
│ • transaction_date                                              │
│ • transaction_id                                                │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Find Invoice in Supabase                                │
├─────────────────────────────────────────────────────────────────┤
│ SELECT * FROM invoices                                          │
│ WHERE confido_invoice_id = '{payment_link_id}'                 │
│                                                                 │
│ IF not found → Log error, return                                │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Update Invoice Status                                   │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE invoices                                                 │
│ SET status = 'paid',                                            │
│     paid_at = NOW(),                                            │
│     updated_at = NOW()                                          │
│ WHERE confido_invoice_id = '{payment_link_id}'                 │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Save Payment Record                                     │
├─────────────────────────────────────────────────────────────────┤
│ INSERT INTO payments                                            │
│ Values:                                                         │
│ • invoice_id (FK to invoices)                                  │
│ • confido_payment_id: transaction_id                           │
│ • amount                                                        │
│ • payment_method                                                │
│ • payment_date                                                  │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ├──────────────────────────────────┐
            ▼                                  ▼
┌─────────────────────────┐  ┌─────────────────────────────────────┐
│ Step 6A: Record in GHL  │  │ Step 6B: Update GHL Custom Object   │
├─────────────────────────┤  ├─────────────────────────────────────┤
│ IF ghl_invoice_id       │  │ PUT /custom/invoices/{recordId}     │
│ exists:                 │  │                                     │
│                         │  │ Set:                                │
│ POST /invoices/{id}     │  │ • status: "paid"                   │
│      /payments          │  │                                     │
│                         │  │                                     │
│ Record payment on       │  │                                     │
│ native GHL invoice      │  │                                     │
└───────────┬─────────────┘  └──────────────────┬──────────────────┘
            │                                   │
            ▼                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: Create Payment Notification Task                        │
├─────────────────────────────────────────────────────────────────┤
│ POST /contacts/{contactId}/tasks                                │
│                                                                 │
│ Task:                                                           │
│ • Title: "Payment Received: ${amount}"                         │
│ • Body: "Payment of ${amount} received via {method}            │
│          on {date}. Confido ID: {transaction_id}"              │
│ • Due: Today                                                    │
│ • Assigned: Default staff member                                │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 8: Send Paid Invoice Email                                 │
├─────────────────────────────────────────────────────────────────┤
│ Trigger Make.com webhook:                                       │
│                                                                 │
│ POST {MAKE_INVOICE_EMAIL_WEBHOOK}                               │
│ Body:                                                           │
│ • type: "paid"                                                  │
│ • invoice_number                                                │
│ • contact_name                                                  │
│ • contact_email                                                 │
│ • amount_paid                                                   │
│ • payment_date                                                  │
│ • payment_method                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 Invoice Deletion Flow

```
┌─────────────────────────┐
│  GHL Invoice Custom     │
│  Object Deleted         │
└───────────┬─────────────┘
            │ Webhook POST /webhooks/ghl/custom-object-deleted
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Find Invoice in Supabase                                │
├─────────────────────────────────────────────────────────────────┤
│ SELECT * FROM invoices                                          │
│ WHERE ghl_record_id = '{record_id}'                            │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Delete PaymentLink in Confido                           │
├─────────────────────────────────────────────────────────────────┤
│ IF confido_invoice_id exists:                                   │
│                                                                 │
│ GraphQL Mutation: deletePaymentLink                             │
│ Variables: { id: confido_invoice_id }                          │
│                                                                 │
│ Continue even if deletion fails (soft delete)                   │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Soft Delete in Supabase                                 │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE invoices                                                 │
│ SET status = 'deleted',                                         │
│     deleted_at = NOW(),                                         │
│     updated_at = NOW()                                          │
│ WHERE ghl_record_id = '{record_id}'                            │
│                                                                 │
│ Note: Soft delete preserves audit trail                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Workshop Event Flow

### 7.1 Workshop Creation

```
┌─────────────────────────┐
│  JotForm Workshop       │
│  Form Submission        │
└───────────┬─────────────┘
            │ Webhook POST /workshop
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Parse Workshop Data                                     │
├─────────────────────────────────────────────────────────────────┤
│ Extract from JotForm:                                           │
│ • workshop_name                                                 │
│ • event_date                                                    │
│ • event_time                                                    │
│ • address                                                       │
│ • description                                                   │
│ • notes                                                         │
│ • type                                                          │
│ • capacity                                                      │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Download Workshop Files                                 │
├─────────────────────────────────────────────────────────────────┤
│ IF files attached to form:                                      │
│   Download via JotForm API                                      │
│   Store temporarily for upload                                  │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Create GHL Custom Object                                │
├─────────────────────────────────────────────────────────────────┤
│ POST /custom/workshops                                          │
│                                                                 │
│ Fields:                                                         │
│ • name                                                          │
│ • event_date                                                    │
│ • event_time                                                    │
│ • address                                                       │
│ • description                                                   │
│ • notes                                                         │
│ • type                                                          │
│ • capacity                                                      │
│ • participant_count: 0                                          │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Save to Supabase                                        │
├─────────────────────────────────────────────────────────────────┤
│ INSERT INTO workshops                                           │
│ • ghl_record_id                                                 │
│ • All workshop fields                                           │
│ • participant_count: 0                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Contact-Workshop Association

```
┌─────────────────────────┐
│  Contact Registration   │
│  for Workshop           │
└───────────┬─────────────┘
            │ POST /associate-contact-workshop
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Create Association in GHL                               │
├─────────────────────────────────────────────────────────────────┤
│ POST /relations                                                 │
│                                                                 │
│ Body:                                                           │
│ • source_id: contact_id                                        │
│ • source_schema: "contacts"                                     │
│ • target_id: workshop_record_id                                │
│ • target_schema: "workshops"                                    │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Increment Participant Count                             │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE workshops                                                │
│ SET participant_count = participant_count + 1                   │
│ WHERE ghl_record_id = '{workshop_record_id}'                   │
│                                                                 │
│ Also update GHL custom object                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Email & SMS Automation

### 8.1 Appointment Confirmation Emails

```
┌─────────────────────────────────────────────────────────────────┐
│                MEETING TYPE → EMAIL TEMPLATE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Initial Meeting (In-Person)                                     │
│ ├── Confirmation details with date/time                         │
│ ├── Office address (Naples or Fort Myers)                       │
│ ├── Link: Intake form                                           │
│ ├── Link: Brochure download                                     │
│ └── Link: Workshop registration                                 │
│                                                                 │
│ Vision Meeting (In-Person)                                      │
│ ├── Confirmation details                                        │
│ ├── Office address                                              │
│ └── Preparation instructions                                    │
│                                                                 │
│ Standalone Meeting (In-Person/Zoom)                             │
│ ├── Confirmation details                                        │
│ ├── Location/Zoom link                                          │
│ └── Meeting agenda                                              │
│                                                                 │
│ Probate Discovery Call (Phone/Zoom)                             │
│ ├── Call details                                                │
│ ├── Estate questionnaire link                                   │
│ └── Preparation materials                                       │
│                                                                 │
│ EP Discovery Call (Phone/Zoom)                                  │
│ ├── Call details                                                │
│ ├── Estate planning questionnaire                               │
│ └── Information to gather                                       │
│                                                                 │
│ Deed Discovery Call (Phone/Zoom)                                │
│ ├── Call details                                                │
│ └── Property documents to prepare                               │
│                                                                 │
│ Trust Admin Meeting (In-Person/Zoom)                            │
│ ├── Meeting details                                             │
│ ├── Trust questionnaire link                                    │
│ └── Documents to bring                                          │
│                                                                 │
│ Doc Review Meeting (In-Person/Zoom)                             │
│ ├── Meeting details                                             │
│ └── Document review instructions                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Office Addresses by Location

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOCATION → ADDRESS MAPPING                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Naples:                                                         │
│   Safe Harbor Law                                               │
│   [Naples office address]                                       │
│                                                                 │
│ Fort Myers:                                                     │
│   Safe Harbor Law                                               │
│   [Fort Myers office address]                                   │
│                                                                 │
│ Zoom:                                                           │
│   "Virtual meeting - Zoom link will be provided"               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 SMS Reminder Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Appointment Booked                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ IMMEDIATE: Send Confirmation SMS                                │
│ ├── "Your appointment has been scheduled for {date} at {time}" │
│ ├── "Location: {office/Zoom}"                                  │
│ └── "Reply CONFIRM to confirm"                                 │
│                                                                 │
│ SCHEDULED: Reminder 24 hours before                             │
│ ├── "Reminder: Your appointment is tomorrow at {time}"         │
│ ├── "Location: {office/Zoom}"                                  │
│ └── "Reply if you need to reschedule"                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Decision Trees & Conditions

### 9.1 Appointment Stage Movement Decision

```
                    ┌─────────────────────┐
                    │ Appointment Created │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Get Meeting Type    │
                    │ from Form           │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │ Discovery   │     │ Meeting     │     │ Other/      │
    │ Call Types  │     │ Types       │     │ Unknown     │
    └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
           │                   │                   │
           │ • Probate DC      │ • Initial         │
           │ • EP DC           │ • Vision          │ NO STAGE
           │ • Deed DC         │ • Standalone      │ CHANGE
           │                   │ • Trust Admin     │
           │                   │ • Doc Review      │
           │                   │                   │
           ▼                   ▼                   ▼
    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │ "Scheduled  │     │ "Scheduled  │     │ Keep        │
    │ Discovery   │     │ I/V"        │     │ Current     │
    │ Call"       │     │             │     │ Stage       │
    └─────────────┘     └─────────────┘     └─────────────┘
```

### 9.2 Invoice Creation Decision

```
                    ┌──────────────────────┐
                    │ Custom Object Webhook│
                    └──────────┬───────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Is schema_key       │
                    │ == "invoices"?      │
                    └──────────┬──────────┘
                               │
               ┌───────────────┴───────────────┐
               │ YES                           │ NO
               ▼                               ▼
    ┌──────────────────────┐        ┌──────────────────────┐
    │ Check for            │        │ Handle other         │
    │ payment_link field   │        │ custom objects       │
    └──────────┬───────────┘        │ (workshops, etc.)    │
               │                    └──────────────────────┘
    ┌──────────┴──────────┐
    │ YES (has link)      │ NO (empty)
    ▼                     ▼
┌───────────────┐  ┌───────────────────────────────────┐
│ Already       │  │ Check for service_items           │
│ processed     │  └───────────────┬───────────────────┘
│               │                  │
│ • Check for   │     ┌────────────┴────────────┐
│   duplicate   │     │ HAS items              │ NO items
│ • Use exist-  │     ▼                        ▼
│   ing URL     │ ┌─────────────────┐  ┌─────────────────┐
└───────────────┘ │ Check for       │  │ Wait for        │
                  │ opportunity     │  │ more updates    │
                  │ association     │  │ (items pending) │
                  └────────┬────────┘  └─────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │ HAS opportunity                 │ NO opportunity
          ▼                                 ▼
   ┌─────────────────┐             ┌─────────────────┐
   │ Create Confido  │             │ Retry up to 6   │
   │ PaymentLink     │             │ times for       │
   │ • Client        │             │ association     │
   │ • Matter        │             └─────────────────┘
   │ • PaymentLink   │
   └─────────────────┘
```

### 9.3 Payment Processing Decision

```
                    ┌──────────────────────┐
                    │ Payment Webhook      │
                    │ Received             │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Verify Signature    │
                    └──────────┬──────────┘
                               │
               ┌───────────────┴───────────────┐
               │ VALID                         │ INVALID
               ▼                               ▼
    ┌──────────────────────┐        ┌──────────────────────┐
    │ Find invoice in      │        │ Return 401           │
    │ Supabase by          │        │ Unauthorized         │
    │ confido_invoice_id   │        └──────────────────────┘
    └──────────┬───────────┘
               │
    ┌──────────┴──────────┐
    │ FOUND               │ NOT FOUND
    ▼                     ▼
┌───────────────┐  ┌───────────────────────────────────┐
│ Process       │  │ Log error                         │
│ payment       │  │ Return error response             │
│               │  └───────────────────────────────────┘
│ 1. Update     │
│    Supabase   │
│ 2. Record     │
│    payment    │
│ 3. Update GHL │
│ 4. Create     │
│    task       │
│ 5. Send email │
└───────────────┘
```

### 9.4 Intake Survey Stage Movement Decision

```
                    ┌──────────────────────┐
                    │ Survey Completed     │
                    │ Webhook              │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Find opportunity    │
                    │ for contact         │
                    └──────────┬──────────┘
                               │
               ┌───────────────┴───────────────┐
               │ FOUND                         │ NOT FOUND
               ▼                               ▼
    ┌──────────────────────┐        ┌──────────────────────┐
    │ Check current stage  │        │ Log warning          │
    │                      │        │ Exit                 │
    └──────────┬───────────┘        └──────────────────────┘
               │
    ┌──────────┴──────────┐
    │ Still in "Intake    │ Already moved
    │ Survey" stage       │ to different stage
    ▼                     ▼
┌───────────────┐  ┌───────────────────────────────────┐
│ Move to       │  │ No action needed                  │
│ "Pending I/V" │  │ (opportunity already progressed)  │
│ stage         │  └───────────────────────────────────┘
│               │
│ This triggers │
│ stage change  │
│ webhook       │
└───────────────┘
```

---

## 10. Error Handling & Retry Logic

### 10.1 Retry Configurations

```
┌─────────────────────────────────────────────────────────────────┐
│                    RETRY CONFIGURATIONS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Form Submission Lookup (Appointment):                           │
│ • Max attempts: 5                                               │
│ • Delay: 2 seconds between attempts                             │
│ • Purpose: Form submission may not be immediately available     │
│                                                                 │
│ Opportunity Association (Invoice):                              │
│ • Max attempts: 6                                               │
│ • Delay: 10 seconds between attempts                            │
│ • Purpose: GHL may deliver association webhook separately       │
│                                                                 │
│ Opportunity Stage Check:                                        │
│ • Max attempts: 3                                               │
│ • Delay: 5 seconds between attempts                             │
│ • Purpose: Verify stage change completed                        │
│                                                                 │
│ API Rate Limiting:                                              │
│ • Exponential backoff on 429 errors                             │
│ • Initial delay: 1 second                                       │
│ • Max delay: 30 seconds                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 Error Recovery Strategies

```
┌─────────────────────────────────────────────────────────────────┐
│                    ERROR RECOVERY STRATEGIES                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Duplicate Contact:                                              │
│ • GHL returns 422 with existing contact ID                      │
│ • Recovery: Use existing contact, proceed with update           │
│                                                                 │
│ Missing Opportunity Association:                                │
│ • Invoice created before opportunity linked                     │
│ • Recovery: Retry with delay, create without opp if max retries │
│                                                                 │
│ Confido API Failure:                                            │
│ • PaymentLink creation fails                                    │
│ • Recovery: Log error, invoice saved without payment URL        │
│ • Manual intervention required                                  │
│                                                                 │
│ Webhook Signature Invalid:                                      │
│ • Confido webhook has bad signature                             │
│ • Recovery: Reject immediately, log for investigation           │
│                                                                 │
│ GHL API Timeout:                                                │
│ • Request exceeds timeout                                       │
│ • Recovery: Retry with exponential backoff                      │
│                                                                 │
│ Email Send Failure:                                             │
│ • Make.com webhook fails                                        │
│ • Recovery: Log error, core operation still completes           │
│ • Email is best-effort, not critical path                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 10.3 Graceful Degradation

```
┌─────────────────────────────────────────────────────────────────┐
│                    GRACEFUL DEGRADATION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Email Failure:                                                  │
│ • Core operation (appointment, invoice) still completes         │
│ • Email failure logged but not blocking                         │
│                                                                 │
│ SMS Failure:                                                    │
│ • Confirmation email still sent                                 │
│ • SMS failure logged                                            │
│                                                                 │
│ PDF Upload Failure:                                             │
│ • Contact created successfully                                  │
│ • Opportunity created                                           │
│ • PDF failure logged for manual follow-up                       │
│                                                                 │
│ Task Creation Failure:                                          │
│ • Stage change still recorded                                   │
│ • Individual task failures logged                               │
│ • Other tasks still created                                     │
│                                                                 │
│ Supabase Sync Failure:                                          │
│ • GHL operations still complete                                 │
│ • Sync failure logged                                           │
│ • Data can be reconciled later                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Appendix: Complete Webhook Reference

### Incoming Webhooks

| Endpoint | Source | Trigger | Actions |
|----------|--------|---------|---------|
| `/webhook/jotform` | JotForm | Estate form submit | Create contact, opportunity, upload PDF |
| `/webhook/jotform-intake` | JotForm | Intake form submit | Create contact, opportunity |
| `/webhooks/intakeForm` | JotForm | Intake with calls | Create contact, map call details |
| `/workshop` | JotForm | Workshop form | Create workshop custom object |
| `/webhooks/ghl/opportunity-stage-changed` | GHL | Stage move | Create tasks for stage |
| `/webhooks/ghl/task-created` | GHL | Task created | Sync to Supabase |
| `/webhooks/ghl/task-completed` | GHL | Task done | Update Supabase |
| `/webhooks/ghl/appointment-created` | GHL | Booking | Update title, move stage, send comms |
| `/webhooks/ghl/invoice-created` | GHL | Native invoice | Create Confido payment link |
| `/webhooks/ghl/custom-object-created` | GHL | Custom object | Process invoice/workshop |
| `/webhooks/ghl/custom-object-updated` | GHL | Fields changed | Update payment link if needed |
| `/webhooks/ghl/custom-object-deleted` | GHL | Object deleted | Delete Confido link, soft delete |
| `/webhooks/ghl/association-created` | GHL | Records linked | Handle invoice-opportunity link |
| `/webhooks/intakeSurvey` | GHL | Survey done | Move opportunity stage |
| `/webhooks/confido/payment-received` | Confido | Payment | Update status, record payment, notify |

### Outgoing API Calls

| Destination | Purpose | Frequency |
|-------------|---------|-----------|
| GHL Contacts API | CRUD contacts | Every form submission |
| GHL Opportunities API | Pipeline management | Every intake, stage change |
| GHL Tasks API | Task creation | Every stage change, payment |
| GHL Custom Objects API | Invoice/workshop | Invoice lifecycle |
| GHL Calendars API | Appointment info | Every appointment |
| Confido GraphQL | Payment links | Invoice creation/deletion |
| Supabase | Data persistence | Every webhook |
| Make.com | Email triggers | Appointments, payments |
| JotForm API | PDF download | Form submissions |
