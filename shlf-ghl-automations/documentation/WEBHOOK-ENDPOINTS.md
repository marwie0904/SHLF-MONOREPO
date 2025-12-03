# Webhook Endpoints Documentation

**Complete reference for all incoming webhook endpoints**

---

## Table of Contents

1. [JotForm Webhooks](#jotform-webhooks)
2. [GHL Webhooks](#ghl-webhooks)
3. [Confido Webhooks](#confido-webhooks)
4. [Public Endpoints](#public-endpoints)

---

## JotForm Webhooks

### 1. Estate Planning Form

**Endpoint:** `POST /webhook/jotform`

**Source:** JotForm Estate Planning Form

**Trigger:** Form submission

**Purpose:** Creates/updates contact in GHL with estate planning information

**Payload Example:**
```json
{
  "rawRequest": "{...}",
  "formID": "123456789",
  "submissionID": "5678901234",
  "pretty": "First Name: John, Last Name: Doe..."
}
```

**Flow:**
```
JotForm Submission
    ↓
Parse form data (jotformParser.js)
    ↓
Map to GHL fields (dataMapper.js)
    ↓
Search for existing contact
    ↓
Create or Update GHL Contact
    ↓
Create Opportunity in "Pending Contact" stage
    ↓
Upload PDF if requested (pdfService.js)
    ↓
Response with contactId, opportunityId
```

**Data Mapped:**
- Contact: firstName, lastName, phone, email, address
- Spouse information
- Financial advisor details
- Accountant details
- Up to 5 beneficiaries
- Up to 5 bank/finance accounts

**Response:**
```json
{
  "success": true,
  "message": "Contact and opportunity created successfully",
  "contactId": "abc123",
  "opportunityId": "opp456",
  "isDuplicate": false
}
```

---

### 2. Intake Form

**Endpoint:** `POST /webhook/jotform-intake`

**Source:** JotForm Intake Form

**Trigger:** Form submission

**Purpose:** Creates/updates contact with intake survey data

**Flow:**
```
JotForm Submission
    ↓
Parse intake data (jotformIntakeParser.js)
    ↓
Map to GHL fields (intakeDataMapper.js)
    ↓
Create/Update GHL Contact
    ↓
Response
```

---

### 3. Intake Form with Call Details

**Endpoint:** `POST /webhooks/intakeForm`

**Source:** JotForm Intake Form (with call tracking)

**Trigger:** Form submission

**Purpose:** Processes intake form with additional call details

**Flow:**
```
JotForm Submission
    ↓
Extract call details
    ↓
Parse form data
    ↓
Create/Update GHL Contact
    ↓
Update custom fields with call details
    ↓
Response
```

---

### 4. Intake Survey

**Endpoint:** `POST /webhooks/intakeSurvey`

**Source:** JotForm Survey

**Trigger:** Survey completion

**Purpose:** Updates opportunity stage based on survey responses

**Flow:**
```
Survey Submission
    ↓
Find associated contact
    ↓
Find opportunity
    ↓
Determine stage based on answers
    ↓
Update opportunity stage
    ↓
Response
```

---

### 5. Workshop Registration

**Endpoint:** `POST /workshop`

**Source:** JotForm Workshop Form

**Trigger:** Form submission

**Purpose:** Creates workshop event in GHL custom objects

**Payload Fields:**
- `q3_workshopName` - Workshop title
- `q5_workshopDate` - Date (month/day/year)
- `q4_workshopTime` - Time (hour/minute/ampm)
- `q7_workshopAddress` - Full address
- `q8_workshopDescription` - Description
- `q9_workshopNotes` - Notes
- `q11_typeOfWorkshop` - Type (Seminar/Webinar)
- `q12_capacity` - Max capacity
- `relevantFiles` - File attachments

**Flow:**
```
JotForm Submission
    ↓
Parse workshop data (create-workshop-event.js)
    ↓
Download attached files
    ↓
Create GHL Custom Object (custom_objects.workshops)
    ↓
Save to Supabase workshops table
    ↓
Response with workshopId
```

**GHL Custom Object Properties:**
```json
{
  "title": "Workshop Name",
  "date": "MM/DD/YYYY",
  "time": "HH:MM AM/PM",
  "location": "Full Address",
  "type": "seminar|webinar",
  "max_capacity": 100,
  "joined_attendees": 0,
  "notes": "Description + Notes",
  "status": "scheduled|cancelled|finished"
}
```

---

### 6. Associate Contact to Workshop

**Endpoint:** `POST /associate-contact-workshop`

**Source:** Internal/Automation

**Trigger:** Contact registers for workshop

**Purpose:** Creates association between contact and workshop

**Payload:**
```json
{
  "contactId": "ghl_contact_id",
  "eventTitle": "Workshop Name",
  "eventDate": "MM/DD/YYYY",
  "eventTime": "HH:MM AM/PM",
  "eventType": "Seminar|Webinar|Office"
}
```

**Flow:**
```
Request received
    ↓
Find workshop in Supabase by title/date/time/type
    ↓
Get GHL workshop record ID
    ↓
Create GHL association (relations)
    ↓
Response with relationId
```

---

## GHL Webhooks

### 1. Opportunity Stage Changed

**Endpoint:** `POST /webhooks/ghl/opportunity-stage-changed`

**Source:** GHL Workflow/Automation

**Trigger:** Opportunity moves to new pipeline stage

**Purpose:** Creates automated tasks based on stage

**Payload Example:**
```json
{
  "type": "OpportunityStageUpdate",
  "locationId": "location_id",
  "id": "opportunity_id",
  "contactId": "contact_id",
  "pipelineId": "pipeline_id",
  "pipelineStageId": "new_stage_id",
  "pipelineStageName": "Stage Name",
  "previousStageId": "old_stage_id"
}
```

**Stage-Task Mapping:**
| Stage | Tasks Created |
|-------|---------------|
| Discovery Call | Creates "Scheduled Discovery Call" task |
| Scheduled I/V | Creates Initial/Vision meeting task |
| Probate stages | Creates probate-specific tasks |
| Signing Meeting | Creates document preparation tasks |

**Flow:**
```
GHL Stage Change Webhook
    ↓
ghlOpportunityService.processOpportunityStageChange()
    ↓
Determine stage-specific tasks
    ↓
Create tasks via ghlService.createTask()
    ↓
Sync tasks to Supabase (ghlTaskService)
    ↓
Response
```

---

### 2. Task Created

**Endpoint:** `POST /webhooks/ghl/task-created`

**Source:** GHL Task Creation

**Trigger:** New task created in GHL

**Purpose:** Syncs task to Supabase for reporting

**Payload:**
```json
{
  "id": "task_id",
  "title": "Task Title",
  "body": "Task Description",
  "contactId": "contact_id",
  "assignedTo": "user_id",
  "dueDate": "2024-12-15T10:00:00Z",
  "completed": false
}
```

**Flow:**
```
GHL Task Webhook
    ↓
ghlTaskService.processTaskCreation()
    ↓
Get assignee information
    ↓
Upsert to Supabase ghl_tasks table
    ↓
Response
```

---

### 3. Task Completed

**Endpoint:** `POST /webhooks/ghl/task-completed`

**Source:** GHL Task Completion

**Trigger:** Task marked as complete

**Purpose:** Updates task status in Supabase

**Flow:**
```
GHL Task Completion Webhook
    ↓
Update Supabase ghl_tasks table
    ↓
Set completed = true
    ↓
Response
```

---

### 4. Appointment Created

**Endpoint:** `POST /webhooks/ghl/appointment-created`

**Source:** GHL Calendar

**Trigger:** New appointment booked

**Purpose:** Updates title, sends email/SMS, updates opportunity stage

**Payload:**
```json
{
  "id": "appointment_id",
  "calendarId": "calendar_id",
  "contactId": "contact_id",
  "title": "Original Title",
  "startTime": "2024-12-15T14:00:00Z",
  "endTime": "2024-12-15T15:00:00Z",
  "status": "confirmed",
  "formSubmission": {...}
}
```

**Flow:**
```
GHL Appointment Webhook
    ↓
appointmentService.processAppointmentCreated()
    ↓
Get form submission data
    ↓
Determine meeting type from calendar
    ↓
Update appointment title format:
    "[Calendar] - [Meeting Type] - Meeting - [Contact Name]"
    ↓
Move opportunity to appropriate stage:
    - Discovery calls → "Scheduled Discovery Call"
    - Meetings → "Scheduled I/V"
    ↓
Send confirmation email (appointmentEmailService)
    ↓
Send confirmation SMS (appointmentSmsService)
    ↓
Schedule reminder SMS (24h before)
    ↓
Response
```

**Meeting Types & Email Templates:**
| Calendar/Type | Email Template Function |
|---------------|------------------------|
| Probate Discovery Call | `sendProbateDiscoveryCallEmail()` |
| Trust Admin Meeting | `sendTrustAdminMeetingEmail()` |
| EP & Deed Discovery Call | `sendEPAndDeedDiscoveryCallEmail()` |
| Doc Review Meeting | `sendDocReviewMeetingEmail()` |
| General Discovery Call | `sendGeneralDiscoveryCallEmail()` |
| Other Meetings | `sendMeetingConfirmationEmail()` |

---

### 5. Custom Object Created (Invoice)

**Endpoint:** `POST /webhooks/ghl/custom-object-created`

**Source:** GHL Custom Objects

**Trigger:** New custom object record created

**Purpose:** Creates invoice in Confido, syncs to Supabase

**Note:** This endpoint routes events by type:
- `RecordCreate` → Processed here
- `RecordUpdate` → Forwarded to `/custom-object-updated`
- `RecordDelete` → Forwarded to `/custom-object-deleted`

**Payload:**
```json
{
  "type": "RecordCreate",
  "id": "record_id",
  "objectKey": "custom_objects.invoices",
  "locationId": "location_id"
}
```

**Flow:**
```
GHL Custom Object Webhook
    ↓
Check if invoice object (custom_objects.invoices)
    ↓
Retry loop (up to 6 attempts, 10s delay):
    - Get custom object details
    - Get relations (find opportunity)
    - Check for opportunity association
    ↓
Extract service items from properties
    ↓
Calculate total from invoice_service_items catalog
    ↓
Create invoice in Confido (confidoService.createInvoice)
    ↓
Generate invoice number (INV-YYYYMMDD-XXXX)
    ↓
Save to Supabase invoices table
    ↓
Update GHL custom object with:
    - payment_link
    - invoice_number
    - subtotal
    - total
    ↓
Send invoice email (invoiceEmailService)
    ↓
Response
```

---

### 6. Custom Object Updated

**Endpoint:** `POST /webhooks/ghl/custom-object-updated`

**Source:** GHL Custom Objects

**Trigger:** Custom object record updated

**Purpose:** Recalculates totals, updates records

**Flow:**
```
GHL Custom Object Update Webhook
    ↓
Check if invoice object
    ↓
Get updated record from GHL
    ↓
Check if payment_link exists:
    ↓
    If NO payment link:
        → Create in Confido
        → Save to Supabase
        → Update GHL with payment link
        → Send invoice email
    ↓
    If payment link EXISTS:
        → Compare current vs new totals
        → If different: Update Supabase, Update GHL totals
        → If same: Skip update
    ↓
Response
```

---

### 7. Custom Object Deleted

**Endpoint:** `POST /webhooks/ghl/custom-object-deleted`

**Source:** GHL Custom Objects

**Trigger:** Custom object record deleted

**Purpose:** Deletes PaymentLink from Confido, marks deleted in Supabase

**Flow:**
```
GHL Custom Object Delete Webhook
    ↓
Check if invoice object
    ↓
Get invoice from Supabase
    ↓
If Confido PaymentLink exists:
    → Delete from Confido (confidoService.deletePaymentLink)
    ↓
Update Supabase: status = 'deleted'
    ↓
Response
```

---

### 8. Association Created

**Endpoint:** `POST /webhooks/ghl/association-created`

**Source:** GHL Associations

**Trigger:** New association between records

**Purpose:** Logs association events (currently monitoring only)

**Payload:**
```json
{
  "id": "association_id",
  "associationType": "type",
  "firstObjectKey": "contact",
  "secondObjectKey": "custom_objects.invoices",
  "locationId": "location_id"
}
```

---

## Confido Webhooks

### 1. Payment Received

**Endpoint:** `POST /webhooks/confido/payment-received`

**Source:** Confido Legal

**Trigger:** Payment completed for invoice

**Purpose:** Updates invoice status, sends paid confirmation

**Payload Example:**
```json
{
  "event": "payment.completed",
  "paymentLinkId": "confido_invoice_id",
  "paymentId": "payment_id",
  "amount": 5000,
  "transactionDate": "2024-12-15T10:00:00Z",
  "paymentMethod": "credit_card"
}
```

**Flow:**
```
Confido Payment Webhook
    ↓
Find invoice in Supabase by confido_invoice_id
    ↓
Save payment to confido_payments table
    ↓
Update invoice status to 'paid'
    ↓
Update GHL custom object status to 'paid'
    ↓
Delete PaymentLink from Confido
    ↓
Get opportunity and contact details
    ↓
Create completion task in GHL
    ↓
Send paid invoice email
    ↓
Response
```

---

## Public Endpoints

### 1. Invoice Viewer

**Endpoint:** `GET /invoice/:invoiceNumber`

**Source:** Browser

**Purpose:** Public page for viewing and paying invoices

**URL Example:** `/invoice/INV-20241215-A84C`

**Flow:**
```
Browser Request
    ↓
Get invoice from Supabase by invoice_number
    ↓
If not found: Return 404 page
    ↓
If found: Render HTML invoice viewer
    ↓
Show:
    - Company logo
    - Invoice details
    - Line items
    - Total
    - Pay Now button (if unpaid)
    - PAID badge (if paid)
```

---

### 2. Health Check

**Endpoint:** `GET /health`

**Purpose:** Server health monitoring

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-12-15T10:00:00Z"
}
```
