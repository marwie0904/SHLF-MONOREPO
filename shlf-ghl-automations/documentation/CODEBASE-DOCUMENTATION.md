# Safe Harbor Law - GHL Automations Codebase Documentation

**Last Updated:** November 2024
**Purpose:** Complete technical documentation of the SHLF-GHL-Automations system

---

## Table of Contents

1. [Overview](#1-overview)
2. [Project Structure](#2-project-structure)
3. [Incoming Webhook Endpoints](#3-incoming-webhook-endpoints)
4. [Outgoing API Endpoints](#4-outgoing-api-endpoints)
5. [Services Reference](#5-services-reference)
6. [Database Schema](#6-database-schema)
7. [Configuration](#7-configuration)
8. [External Integrations](#8-external-integrations)

---

## 1. Overview

This system serves as the integration hub for Safe Harbor Law's client management workflow. It connects:

- **GoHighLevel (GHL)** - CRM, pipeline, and invoicing
- **JotForm** - Form submissions and document collection
- **Confido Legal** - Payment processing
- **Supabase** - Data persistence and reporting
- **Make.com** - Email automation

**Tech Stack:**
- Node.js / Express.js server
- PostgreSQL via Supabase
- RESTful APIs for GHL/JotForm
- GraphQL for Confido Legal
- Puppeteer for PDF generation

---

## 2. Project Structure

```
shlf-ghl-automations/
├── server.js                           # Main Express server (all routes)
├── package.json                        # Dependencies
├── .env                                # Environment configuration
├── jotform-to-ghl-mapping.json        # Field mapping config
│
├── services/                           # Core business logic
│   ├── ghlService.js                   # GHL API wrapper
│   ├── ghlOpportunityService.js        # Opportunity & task automation
│   ├── ghlTaskService.js               # Task sync to Supabase
│   ├── appointmentService.js           # Calendar management
│   ├── appointmentEmailService.js      # Meeting confirmation emails
│   ├── appointmentSmsService.js        # SMS reminders
│   ├── invoiceService.js               # Invoice database operations
│   ├── invoicePdfService.js            # PDF generation
│   ├── invoiceEmailService.js          # Invoice email delivery
│   ├── confidoService.js               # Confido payment integration
│   ├── pdfService.js                   # PDF upload from JotForm
│   └── webhookService.js               # Webhook helpers
│
├── utils/                              # Data parsing & mapping
│   ├── jotformParser.js                # Estate planning form parser
│   ├── jotformIntakeParser.js          # Intake form parser
│   ├── dataMapper.js                   # Estate form → GHL mapper
│   └── intakeDataMapper.js             # Intake form → GHL mapper
│
├── automations/                        # Workflow automations
│   ├── create-workshop-event.js        # Workshop custom objects
│   ├── associate-contact-to-workshop.js
│   └── increment-workshop-participants.js
│
├── scripts/                            # Test & utility scripts
└── documentation/                      # Technical docs
```

---

## 3. Incoming Webhook Endpoints

### 3.1 JotForm Webhooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/jotform` | POST | Estate Planning form submission |
| `/webhook/jotform-intake` | POST | Intake form submission |
| `/webhooks/intakeForm` | POST | Intake form with call details |
| `/workshop` | POST | Workshop event creation |

**Payload Format:**
```json
{
  "rawRequest": "{\"q1_fullName\":\"John Doe\",...}",
  "submissionID": "123456789"
}
```

### 3.2 GHL Webhooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/ghl/opportunity-stage-changed` | POST | Opportunity moves to new stage |
| `/webhooks/ghl/task-created` | POST | Task created in GHL |
| `/webhooks/ghl/task-completed` | POST | Task marked complete |
| `/webhooks/ghl/appointment-created` | POST | Calendar appointment booked |
| `/webhooks/ghl/invoice-created` | POST | Invoice created in GHL |
| `/webhooks/ghl/custom-object-created` | POST | Custom object created |
| `/webhooks/ghl/custom-object-updated` | POST | Custom object updated |
| `/webhooks/ghl/custom-object-deleted` | POST | Custom object deleted |
| `/webhooks/ghl/association-created` | POST | Records associated |
| `/webhooks/intakeSurvey` | POST | Intake survey completed |

**GHL Webhook Payload Example:**
```json
{
  "id": "opportunity_id",
  "contact_id": "contact_id",
  "pipeline_id": "pipeline_id",
  "pipeline_stage_id": "stage_id",
  "source": "webhook"
}
```

### 3.3 Payment Webhooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/confido/payment-received` | POST | Payment received notification |

**Confido Webhook Headers:**
- `x-signature`: HMAC signature for verification

### 3.4 Utility Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health check |
| `/invoice/:invoiceNumber` | GET | Public invoice viewer |
| `/invoice/:invoiceNumber/download` | GET | PDF invoice download |
| `/associate-contact-workshop` | POST | Link contact to workshop |
| `/cron/process-sms-reminders` | POST | Process SMS reminder queue |

---

## 4. Outgoing API Endpoints

### 4.1 GoHighLevel API

**Base URL:** `https://services.leadconnectorhq.com`

**Authentication:** `Authorization: Bearer {GHL_API_KEY}`

#### Contacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/contacts/` | Search contacts |
| POST | `/contacts/` | Create contact |
| PUT | `/contacts/{id}` | Update contact |
| GET | `/contacts/{id}` | Get contact details |
| POST | `/contacts/{id}/tasks` | Create task |

#### Opportunities

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/opportunities/` | Search opportunities |
| POST | `/opportunities/` | Create opportunity |
| PUT | `/opportunities/{id}` | Update opportunity |
| GET | `/opportunities/{id}` | Get opportunity details |

#### Invoices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/invoices/{id}` | Get invoice |
| POST | `/invoices/{id}/payments` | Record payment |

#### Custom Objects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/custom/{objectKey}/{recordId}` | Get custom object |
| PUT | `/custom/{objectKey}/{recordId}` | Update custom object |
| GET | `/relations/{recordId}` | Get associations |

#### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/calendars/{id}` | Get calendar details |
| GET | `/forms/submissions` | Search form submissions |
| GET | `/locations/{id}/customFields` | Get custom fields |

### 4.2 Confido Legal API (GraphQL)

**Endpoint:** `https://api.gravity-legal.com/graphql`

**Authentication:** `Authorization: Bearer {CONFIDO_API_KEY}`

#### Mutations

```graphql
# Create Client
mutation CreateClient($input: CreateClientInput!) {
  createClient(input: $input) {
    id
    name
    email
  }
}

# Create Matter
mutation CreateMatter($input: CreateMatterInput!) {
  createMatter(input: $input) {
    id
    name
    clientId
  }
}

# Create PaymentLink
mutation CreatePaymentLink($input: CreatePaymentLinkInput!) {
  createPaymentLink(input: $input) {
    id
    url
    amount
  }
}

# Delete PaymentLink
mutation DeletePaymentLink($id: ID!) {
  deletePaymentLink(id: $id) {
    success
  }
}
```

#### Queries

```graphql
# Find Client
query FindClient($externalId: String!) {
  clients(externalId: $externalId) {
    id
    name
  }
}

# Find Matter
query FindMatter($clientId: ID!, $name: String!) {
  matters(clientId: $clientId, name: $name) {
    id
    name
  }
}
```

### 4.3 JotForm API

**Base URL:** `https://api.jotform.com/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/form/{formId}/submissions/{submissionId}/files/{field}` | Download PDF |

### 4.4 Supabase (PostgreSQL)

**Base URL:** `https://{project}.supabase.co`

**Operations:**
- INSERT/UPDATE/UPSERT on `invoices`, `payments`, `ghl_tasks`, `workshops`
- SELECT from `ghl_task_list`

### 4.5 Make.com Webhooks

| Webhook | Purpose |
|---------|---------|
| `MAKE_INVOICE_EMAIL_WEBHOOK` | Trigger invoice email |
| `MAKE_APPOINTMENT_EMAIL_WEBHOOK` | Trigger appointment confirmation |

---

## 5. Services Reference

### 5.1 ghlService.js

Core GHL API wrapper providing CRUD operations.

**Key Functions:**

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `createGHLContact` | `contactData` | `{id, duplicate}` | Create/update contact |
| `getContact` | `contactId` | Contact object | Fetch contact details |
| `createTask` | `contactId, title, body, dueDate, assignedTo, opportunityId` | Task object | Create task on contact |
| `createGHLOpportunity` | `contactId, pipelineId, stageId, name` | Opportunity object | Create opportunity |
| `getOpportunity` | `opportunityId` | Opportunity object | Fetch opportunity |
| `updateOpportunity` | `opportunityId, data` | Updated opportunity | Update opportunity fields |
| `getInvoice` | `invoiceId` | Invoice object | Fetch invoice details |
| `recordInvoicePayment` | `invoiceId, paymentData` | Payment record | Record payment on invoice |
| `getCustomObject` | `objectKey, recordId` | Custom object | Fetch custom object |
| `updateCustomObject` | `objectKey, recordId, locationId, data` | Updated object | Update custom object fields |
| `getRelations` | `recordId, locationId` | Array of relations | Get object associations |

### 5.2 ghlOpportunityService.js

Opportunity and task automation logic.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `getTasksForStage(stageName)` | Fetch task templates from Supabase for stage |
| `createGHLTask(taskData, opportunityId, contactId)` | Create task with calculated due date |
| `processOpportunityStageChange(webhookData)` | Main handler for stage changes |
| `processTaskCompletion(taskData)` | Handle task completion |
| `calculateDueDate(taskData)` | Calculate due date in EST timezone |
| `searchOpportunitiesByContact(contactId)` | Find opportunities for contact |
| `updateOpportunityStage(opportunityId, stageId)` | Move opportunity |
| `checkOpportunityStageWithRetry(opportunityId, expectedStage)` | Verify stage with retries |

### 5.3 ghlTaskService.js

Task synchronization to Supabase for reporting.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `syncTaskToSupabase(taskData)` | Upsert task to database |
| `processTaskCreation(webhookData)` | Handle task creation webhook |
| `getAssigneeInfo(assigneeId, apiKey)` | Fetch assignee name from GHL |

### 5.4 appointmentService.js

Appointment management and opportunity transitions.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `processAppointmentCreated(webhookData)` | Main appointment handler |
| `getFormSubmission(formId, searchQuery)` | Find booking form submission |
| `extractMeetingData(submission)` | Extract meeting type & location |
| `getCalendar(calendarId)` | Fetch calendar details |
| `updateAppointmentTitle(appointmentId, calendarId, title)` | Format title |
| `shouldMoveOpportunity(meetingType)` | Check if stage change needed |
| `getTargetStageId(meetingType)` | Map meeting type to stage |

**Meeting Types:**
- `Initial Meeting`
- `Vision Meeting`
- `Standalone Meeting`
- `Probate Discovery Call`
- `EP Discovery Call`
- `Deed Discovery Call`
- `Trust Admin Meeting`
- `Doc Review Meeting`

### 5.5 appointmentEmailService.js

Meeting confirmation emails via Make.com.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `sendAppointmentEmail(appointmentData)` | Send confirmation based on meeting type |
| `getEmailTemplate(meetingType, location)` | Get template for meeting type |
| `getOfficeAddress(location)` | Get office address for location |

**Email Templates Include:**
- Meeting confirmation details
- Intake form links
- Brochure download links
- Workshop registration links
- Office addresses (Naples, Fort Myers)
- Questionnaire links for discovery calls

### 5.6 appointmentSmsService.js

SMS confirmation and reminder system.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `sendConfirmationSms(phoneNumber, appointmentData)` | Send booking confirmation |
| `scheduleReminderSms(appointmentData)` | Schedule 24-hour reminder |
| `processAppointmentReminders()` | Batch process reminder queue |

### 5.7 invoiceService.js

Invoice database operations (Supabase).

**Key Functions:**

| Function | Description |
|----------|-------------|
| `saveInvoiceToSupabase(invoiceData)` | Create/update invoice record |
| `updateInvoicePaymentStatus(confidoInvoiceId, paymentData)` | Mark as paid |
| `getInvoiceByGHLId(ghlInvoiceId)` | Fetch by GHL ID |
| `getInvoiceByConfidoId(confidoInvoiceId)` | Fetch by Confido ID |
| `savePaymentToSupabase(paymentData)` | Record payment transaction |
| `calculateInvoiceTotal(serviceItems)` | Sum service items |
| `updateInvoiceInSupabase(recordId, data)` | Update invoice fields |

### 5.8 invoicePdfService.js

PDF invoice generation using Puppeteer.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `generateInvoicePdf(invoiceData)` | Create PDF buffer |
| `formatCurrency(amount)` | Format as USD |
| `formatDate(date)` | Format date string |

### 5.9 invoiceEmailService.js

Invoice email delivery via Make.com.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `sendInvoiceEmail(invoiceData)` | Send invoice to client |
| `sendPaidInvoiceEmail(paidInvoiceData)` | Send payment confirmation |

### 5.10 confidoService.js

Confido Legal payment platform integration.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `findOrCreateClient(clientData)` | Get/create Confido client |
| `findOrCreateMatter(matterData)` | Get/create legal matter |
| `createInvoice(invoiceData)` | Create PaymentLink (3-step flow) |
| `deletePaymentLink(invoiceId)` | Remove payment link |
| `verifyWebhookSignature(body, signature)` | Verify payment webhook |

**GraphQL Client Creation:**
- Links GHL contact ID as external ID
- Creates client in Confido system

**PaymentLink Creation:**
- Generates unique payment URL
- Client can pay online

### 5.11 pdfService.js

PDF upload from JotForm to GHL contacts.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `handlePdfUpload(submissionId, formId, contactId, contactName)` | Download & upload PDF |
| `downloadPdfFromJotForm(formId, submissionId)` | Fetch PDF via API |
| `uploadPdfToGHL(contactId, pdfBuffer, pdfName, fieldId)` | Store in custom field |
| `checkExistingPdf(contactId, fieldId)` | Check for existing PDF |

---

## 6. Database Schema

### 6.1 invoices

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR NOT NULL UNIQUE,
  ghl_invoice_id VARCHAR,
  confido_invoice_id VARCHAR,
  ghl_record_id VARCHAR,
  contact_id VARCHAR,
  contact_name VARCHAR,
  contact_email VARCHAR,
  opportunity_id VARCHAR,
  opportunity_name VARCHAR,
  amount DECIMAL(10,2),
  subtotal DECIMAL(10,2),
  status VARCHAR DEFAULT 'unpaid',
  payment_link_url TEXT,
  service_items JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 6.2 payments

```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  confido_payment_id VARCHAR,
  amount DECIMAL(10,2),
  payment_method VARCHAR,
  payment_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 6.3 ghl_tasks

```sql
CREATE TABLE ghl_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_task_id VARCHAR UNIQUE,
  task_name VARCHAR,
  description TEXT,
  contact_id VARCHAR,
  opportunity_id VARCHAR,
  assignee_name VARCHAR,
  due_date TIMESTAMP,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 6.4 ghl_task_list

```sql
CREATE TABLE ghl_task_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_name VARCHAR,
  task_title VARCHAR,
  task_description TEXT,
  days_from_now INTEGER,
  assigned_to VARCHAR,
  active BOOLEAN DEFAULT TRUE
);
```

### 6.5 workshops

```sql
CREATE TABLE workshops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_record_id VARCHAR UNIQUE,
  name VARCHAR,
  event_date DATE,
  event_time TIME,
  address TEXT,
  description TEXT,
  notes TEXT,
  type VARCHAR,
  capacity INTEGER,
  participant_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 7. Configuration

### 7.1 Environment Variables

```env
# Server
PORT=3000

# GoHighLevel
GHL_API_KEY=                    # Bearer token for API
GHL_LOCATION_ID=                # Business location ID
GHL_PIPELINE_ID=                # Main pipeline ID
GHL_PDF_FIELD_ID=               # Custom field for PDFs
GHL_APPOINTMENT_FORM_ID=        # Appointment booking form

# JotForm
JOTFORM_API_KEY=                # API key for downloads

# Supabase
SUPABASE_URL=                   # Database URL
SUPABASE_KEY=                   # Anon key

# Confido
CONFIDO_API_URL=                # GraphQL endpoint
CONFIDO_API_KEY=                # Bearer token
CONFIDO_WEBHOOK_SECRET=         # Webhook verification

# Make.com
MAKE_INVOICE_EMAIL_WEBHOOK=     # Invoice email trigger
MAKE_APPOINTMENT_EMAIL_WEBHOOK= # Appointment email trigger
```

### 7.2 Field Mapping (jotform-to-ghl-mapping.json)

Maps JotForm field IDs to GHL custom field IDs for:
- Beneficiaries (1-5)
- Bank accounts (1-5)
- Spouse information
- Financial advisor details
- Accountant details

---

## 8. External Integrations

### 8.1 GoHighLevel (GHL)

| Integration | Type | Purpose |
|-------------|------|---------|
| Contacts API | REST | CRUD contact records |
| Opportunities API | REST | Pipeline management |
| Tasks API | REST | Task creation |
| Custom Objects API | REST | Invoice records |
| Invoices API | REST | Native invoice management |
| Calendars API | REST | Appointment management |
| Forms API | REST | Form submission lookup |

### 8.2 Confido Legal

| Integration | Type | Purpose |
|-------------|------|---------|
| Clients | GraphQL | Client management |
| Matters | GraphQL | Case/matter management |
| PaymentLinks | GraphQL | Invoice payment URLs |
| Webhooks | HTTP | Payment notifications |

### 8.3 JotForm

| Integration | Type | Purpose |
|-------------|------|---------|
| Webhooks | HTTP | Form submission notifications |
| Files API | REST | PDF download |

### 8.4 Supabase

| Integration | Type | Purpose |
|-------------|------|---------|
| PostgreSQL | REST/SDK | Data persistence |
| Realtime | WebSocket | Live updates (optional) |

### 8.5 Make.com

| Integration | Type | Purpose |
|-------------|------|---------|
| Webhooks | HTTP | Email automation triggers |

---

## Appendix: Error Codes & Handling

### GHL API Errors

| Code | Meaning | Handling |
|------|---------|----------|
| 400 | Bad request | Log and validate input |
| 401 | Unauthorized | Check API key |
| 404 | Not found | Handle gracefully |
| 422 | Duplicate | Use existing record |
| 429 | Rate limited | Implement backoff |
| 500 | Server error | Retry with backoff |

### Confido API Errors

| Error | Meaning | Handling |
|-------|---------|----------|
| `INVALID_CLIENT` | Client not found | Create client first |
| `INVALID_MATTER` | Matter not found | Create matter first |
| `DUPLICATE_PAYMENT_LINK` | Already exists | Use existing URL |

### Webhook Signature Errors

- Invalid signature: Log and reject
- Missing signature: Log and reject
- Expired timestamp: Log and reject
