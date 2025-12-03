# Outgoing Integrations Documentation

**Complete reference for all outbound API calls and webhooks**

---

## Table of Contents

1. [GoHighLevel API](#gohighlevel-api)
2. [Confido Legal API](#confido-legal-api)
3. [Supabase Database](#supabase-database)
4. [Make.com Webhooks](#makecom-webhooks)
5. [JotForm API](#jotform-api)

---

## GoHighLevel API

**Base URL:** `https://services.leadconnectorhq.com`
**API Version:** `2021-07-28`
**Authentication:** Bearer token via `GHL_API_KEY`
**Service File:** `services/ghlService.js`

### Contact Operations

#### Search Contacts
```
GET /contacts/
Query: { locationId, query: phone/email }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `findExistingContact()` in `ghlService.js:14`

#### Create Contact
```
POST /contacts/
Body: { locationId, firstName, lastName, phone, email, customFields, ... }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `createGHLContact()` in `ghlService.js:72`

#### Update Contact
```
PUT /contacts/{contactId}
Body: { firstName, lastName, phone, email, customFields, ... }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `updateGHLContact()` in `ghlService.js:45`

#### Get Contact
```
GET /contacts/{contactId}
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `getContact()` in `ghlService.js:235`

---

### Opportunity Operations

#### Create Opportunity
```
POST /opportunities/
Body: { pipelineId, locationId, name, pipelineStageId, status, contactId }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `createGHLOpportunity()` in `ghlService.js:153`

#### Get Opportunity
```
GET /opportunities/{opportunityId}
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `getOpportunity()` in `ghlService.js:527`

#### Update Opportunity Stage
```
PUT /opportunities/{opportunityId}
Body: { pipelineStageId }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `updateOpportunityStage()` in `ghlOpportunityService.js`

---

### Task Operations

#### Create Task
```
POST /opportunities/tasks
Body: { contactId, title, body, dueDate, completed, assignedTo?, opportunityId? }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `createTask()` in `ghlService.js:271`

---

### Custom Object Operations

#### Get Custom Object
```
GET /objects/{objectKey}/records/{recordId}
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `getCustomObject()` in `ghlService.js:406`

#### Create Custom Object Record
```
POST /objects/{schemaKey}/records
Body: { locationId, properties: { field1, field2, ... } }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `createWorkshopGHL()` in `automations/create-workshop-event.js:362`

#### Update Custom Object
```
PUT /objects/{objectKey}/records/{recordId}?locationId={locationId}
Body: { properties: { field1, field2, ... } }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `updateCustomObject()` in `ghlService.js:445`

**Important Notes:**
- `locationId` MUST be passed as query parameter (not body)
- `MONETORY` fields require format: `{ value: number, currency: 'default' }`

---

### Association/Relations Operations

#### Get Relations
```
GET /associations/relations/{recordId}?locationId={locationId}
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `getRelations()` in `ghlService.js:490`

#### Create Relation
```
POST /associations/relations
Body: { locationId, associationId, firstRecordId, secondRecordId }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `createContactWorkshopRelation()` in `automations/associate-contact-to-workshop.js:83`

---

### Invoice Operations

#### Get Invoice
```
GET /invoices/{invoiceId}
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `getInvoice()` in `ghlService.js:371`

#### Record Payment
```
POST /invoices/{invoiceId}/record-payment
Body: { amount, paymentMode, transactionId, note }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `recordInvoicePayment()` in `ghlService.js:326`

---

### Media Operations

#### Upload File
```
POST /medias/upload-file?locationId={locationId}
Body: FormData with file
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28, ...FormData headers }
```
**Used by:** `uploadFilesToMediaStorage()` in `automations/create-workshop-event.js:186`

---

### Other Operations

#### Get Custom Fields
```
GET /locations/{locationId}/customFields
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `getCustomFields()` in `ghlService.js:199`

#### Get User Info
```
GET /users/{userId}
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `getAssigneeInfo()` in `ghlTaskService.js:69`

#### Search Appointments
```
GET /calendars/events/appointments
Query: { calendarId, startTime, endTime }
Headers: { Authorization: Bearer {apiKey}, Version: 2021-07-28 }
```
**Used by:** `searchAppointmentByCalendarId()` in `appointmentService.js`

---

## Confido Legal API

**Base URL:** From `CONFIDO_API_URL` (default: `https://api.confido.com`)
**API Type:** GraphQL
**Authentication:** Bearer token via `CONFIDO_API_KEY`
**Service File:** `services/confidoService.js`

### Create PaymentLink (Invoice)

```graphql
mutation CreatePaymentLink($input: CreatePaymentLinkInput!) {
  createPaymentLink(input: $input) {
    id
    paymentUrl
    status
    amount
    matterId
    clientId
  }
}
```

**Input Variables:**
```json
{
  "input": {
    "externalId": "ghl_invoice_id",
    "matterId": "matter_id",
    "clientId": "client_id",
    "amount": 5000,
    "memo": "Invoice description",
    "lineItems": [
      { "description": "Service Name", "amount": 2500 }
    ]
  }
}
```

**Used by:** `createInvoice()` in `confidoService.js`

**Returns:**
```json
{
  "success": true,
  "confidoInvoiceId": "paymentlink_id",
  "paymentUrl": "https://pay.confido.com/...",
  "status": "unpaid"
}
```

---

### Query PaymentLink

```graphql
query GetPaymentLink($id: ID!) {
  paymentLink(id: $id) {
    id
    paymentUrl
    status
    amount
    paidAmount
    transactions {
      id
      amount
      status
      createdAt
    }
  }
}
```

**Used by:** `queryInvoiceFromConfido()` in `confidoService.js`

---

### Delete PaymentLink

```graphql
mutation DeletePaymentLink($id: ID!) {
  deletePaymentLink(id: $id) {
    success
    message
  }
}
```

**Used by:** `deletePaymentLink()` in `confidoService.js`

---

## Supabase Database

**URL:** From `SUPABASE_URL`
**Key:** From `SUPABASE_KEY`
**Client:** `@supabase/supabase-js`

### Tables & Operations

#### invoices Table

**Insert/Upsert Invoice:**
```javascript
await supabase.from('invoices')
  .upsert(record, { onConflict: 'ghl_invoice_id' })
  .select().single();
```
**Used by:** `saveInvoiceToSupabase()` in `invoiceService.js:18`

**Update Invoice:**
```javascript
await supabase.from('invoices')
  .update(updateData)
  .eq('ghl_invoice_id', ghlInvoiceId);
```
**Used by:** `updateInvoiceInSupabase()` in `invoiceService.js:480`

**Get Invoice by GHL ID:**
```javascript
await supabase.from('invoices')
  .select('*')
  .eq('ghl_invoice_id', ghlInvoiceId)
  .single();
```
**Used by:** `getInvoiceByGHLId()` in `invoiceService.js:135`

**Get Invoice by Invoice Number:**
```javascript
await supabase.from('invoices')
  .select('*')
  .eq('invoice_number', invoiceNumber)
  .single();
```
**Used by:** `getInvoiceByInvoiceNumber()` in `invoiceService.js:180`

---

#### confido_payments Table

**Insert Payment:**
```javascript
await supabase.from('confido_payments')
  .upsert(record, { onConflict: 'confido_payment_id' })
  .select().single();
```
**Used by:** `savePaymentToSupabase()` in `invoiceService.js:270`

---

#### ghl_tasks Table

**Upsert Task:**
```javascript
await supabase.from('ghl_tasks')
  .upsert(record, { onConflict: 'ghl_task_id' })
  .select().single();
```
**Used by:** `syncTaskToSupabase()` in `ghlTaskService.js:34`

---

#### workshops Table

**Insert Workshop:**
```javascript
await supabase.from('workshops')
  .insert({
    ghl_workshop_id, title, event_date, event_time,
    workshop_type, location, description, notes, max_capacity
  })
  .select().single();
```
**Used by:** `saveWorkshopToSupabase()` in `create-workshop-event.js:285`

**Find Workshop:**
```javascript
await supabase.from('workshops')
  .select('ghl_workshop_id')
  .ilike('title', title)
  .eq('event_date', date)
  .ilike('event_time', time)
  .ilike('workshop_type', type)
  .single();
```
**Used by:** `findWorkshopId()` in `associate-contact-to-workshop.js:28`

---

#### scheduled_sms Table

**Insert Scheduled SMS:**
```javascript
await supabase.from('scheduled_sms')
  .insert({
    contact_id, contact_name, contact_phone, appointment_id,
    event_title, appointment_time, location, scheduled_send_time, status
  })
  .select().single();
```
**Used by:** `scheduleReminderSms()` in `appointmentSmsService.js:221`

**Get Pending Reminders:**
```javascript
await supabase.from('scheduled_sms')
  .select('*')
  .eq('status', 'pending')
  .lte('scheduled_send_time', now)
  .order('scheduled_send_time', { ascending: true });
```
**Used by:** `processScheduledReminders()` in `appointmentSmsService.js:279`

**Update SMS Status:**
```javascript
await supabase.from('scheduled_sms')
  .update({ status: 'sent', sent_at: now })
  .eq('id', id);
```

---

#### invoice_service_items Table (Catalog)

**Get Service Items:**
```javascript
await supabase.from('invoice_service_items')
  .select('service_name, price, description')
  .in('service_name', serviceItemNames)
  .eq('is_active', true);
```
**Used by:** `calculateInvoiceTotal()` in `invoiceService.js:376`

---

## Make.com Webhooks

**Purpose:** Trigger email and SMS automations

### Appointment Email Webhook

**URL:** From `MAKE_APPOINTMENT_EMAIL_WEBHOOK` or hardcoded
**Method:** POST

```javascript
axios.post(MAKE_WEBHOOK_URL, {
  type: 'meeting_confirmation',
  recipientEmail: email,
  recipientName: name,
  meetingType: type,
  meetingDateTime: dateTime,
  meetingLocation: location,
  calendarLink: link
});
```

**Email Types:**
- `meeting_confirmation` - General meeting
- `probate_discovery_call` - Probate specific
- `trust_admin_meeting` - Trust admin
- `ep_deed_discovery` - Estate Planning & Deed
- `doc_review_meeting` - Document review
- `general_discovery` - General discovery call

**Used by:** Functions in `appointmentEmailService.js`

---

### Invoice Email Webhook

**URL:** From `MAKE_INVOICE_EMAIL_WEBHOOK`
**Method:** POST

```javascript
axios.post(MAKE_INVOICE_WEBHOOK_URL, {
  type: 'invoice',
  recipientEmail: email,
  billedTo: clientName,
  invoiceNumber: invoiceNumber,
  issueDate: date,
  dueDate: dueDate,
  lineItems: items,
  subtotal: subtotal,
  amountDue: amountDue,
  paymentLink: paymentUrl
});
```

**Used by:** `sendInvoiceEmail()` in `invoiceEmailService.js`

---

### Paid Invoice Email Webhook

```javascript
axios.post(MAKE_INVOICE_WEBHOOK_URL, {
  type: 'invoice_paid',
  recipientEmail: email,
  billedTo: clientName,
  invoiceNumber: invoiceNumber,
  paidDate: date,
  amountPaid: amount
});
```

**Used by:** `sendPaidInvoiceEmail()` in `invoiceEmailService.js`

---

### SMS Webhook (via GHL)

**URL:** `https://services.leadconnectorhq.com/hooks/{locationId}/webhook-trigger/{webhookId}`
**Method:** POST

```javascript
axios.post(GHL_SMS_WEBHOOK_URL, {
  type: 'confirmation' | 'reminder',
  eventTitle: title,
  time: formattedTime,
  location: location,
  contactId: contactId,
  contactName: name,
  contactPhone: phone
});
```

**Used by:** `sendAppointmentSms()` in `appointmentSmsService.js:109`

---

## JotForm API

**Base URL:** `https://api.jotform.com`
**Authentication:** API Key via `JOTFORM_API_KEY`
**Purpose:** Download PDF files from form submissions

### Download File

```javascript
axios.get(fileUrl, {
  responseType: 'arraybuffer'
});
```

**Used by:** `downloadFiles()` in `create-workshop-event.js:94`

---

## Integration Summary

| Platform | Protocol | Purpose | Auth |
|----------|----------|---------|------|
| GHL | REST API | CRM, Tasks, Calendar | Bearer Token |
| Confido | GraphQL | Payments | Bearer Token |
| Supabase | PostgreSQL | Database | API Key |
| Make.com | Webhooks | Email/SMS | URL Secret |
| JotForm | REST API | File Download | API Key |
