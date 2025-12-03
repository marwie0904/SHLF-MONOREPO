# Data Flow Diagrams

**Complete visual flows for all automation processes**

---

## Table of Contents

1. [Form Submission Flows](#form-submission-flows)
2. [Appointment Flow](#appointment-flow)
3. [Invoice Lifecycle](#invoice-lifecycle)
4. [Task Automation Flow](#task-automation-flow)
5. [Workshop Flow](#workshop-flow)
6. [Payment Flow](#payment-flow)

---

## Form Submission Flows

### Estate Planning Form → GHL Contact

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           ESTATE PLANNING FORM FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐
│   CLIENT    │
│  fills out  │
│ JotForm EP  │
│    form     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  POST /webhook/jotform                                              │
│  └── Receives: { rawRequest, formID, submissionID }                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  jotformParser.js                                                   │
│  └── parseJotFormWebhook()                                          │
│      ├── Extracts contact info (name, phone, email)                │
│      ├── Extracts spouse information                                │
│      ├── Extracts financial advisor details                         │
│      ├── Extracts accountant details                                │
│      ├── Extracts beneficiaries (up to 5)                           │
│      └── Extracts bank accounts (up to 5)                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  dataMapper.js                                                      │
│  └── mapJotFormToGHL()                                              │
│      ├── Uses jotform-to-ghl-mapping.json                          │
│      └── Maps to GHL custom field IDs                               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ghlService.js                                                      │
│  └── createGHLContact()                                             │
│      ├── POST /contacts/ → Create contact                           │
│      │   └── If duplicate: findExistingContact() → updateGHLContact │
│      └── Returns: { contactId, isDuplicate }                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ghlService.js                                                      │
│  └── createGHLOpportunity()                                         │
│      ├── POST /opportunities/                                       │
│      ├── Pipeline: Main Pipeline                                    │
│      ├── Stage: "Pending Contact"                                   │
│      └── Returns: { opportunityId }                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  pdfService.js (if PDF attached)                                    │
│  └── handlePdfUpload()                                              │
│      ├── Download PDF from JotForm                                  │
│      └── Upload to GHL custom field                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RESPONSE                                                           │
│  {                                                                  │
│    success: true,                                                   │
│    contactId: "abc123",                                             │
│    opportunityId: "opp456",                                         │
│    isDuplicate: false                                               │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘

                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RESULT IN GHL                                                      │
│  ├── New Contact with all custom fields populated                  │
│  ├── New Opportunity in "Pending Contact" stage                    │
│  └── PDF attached to contact (if submitted)                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Appointment Flow

### Appointment Created → Email + SMS + Stage Update

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              APPOINTMENT FLOW                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐
│   CLIENT    │
│  books via  │
│ GHL Calendar│
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GHL Triggers Webhook                                               │
│  POST /webhooks/ghl/appointment-created                             │
│  └── Payload: { id, calendarId, contactId, title, startTime, ... } │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  appointmentService.processAppointmentCreated()                     │
│  ├── Get form submission data from booking                         │
│  └── Determine meeting type from calendar name                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌────────────────────┐
│  UPDATE TITLE       │ │  UPDATE STAGE       │ │  SEND NOTIFICATIONS│
│                     │ │                     │ │                    │
│  Format:            │ │  Discovery Call     │ │  1. Email via      │
│  "[Calendar] -      │ │  → "Scheduled       │ │     Make.com       │
│   [Meeting Type] -  │ │      Discovery"     │ │                    │
│   Meeting -         │ │                     │ │  2. Confirmation   │
│   [Contact Name]"   │ │  Other Meetings     │ │     SMS via GHL    │
│                     │ │  → "Scheduled I/V"  │ │                    │
│  PUT /calendars/    │ │                     │ │  3. Schedule       │
│  events/...         │ │  PUT /opportunities │ │     Reminder SMS   │
│                     │ │  /{id}              │ │     (24h before)   │
└─────────────────────┘ └─────────────────────┘ └────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EMAIL ROUTING (appointmentEmailService.js)                         │
├─────────────────────────────────────────────────────────────────────┤
│  Calendar/Meeting Type         │  Email Function                    │
│  ─────────────────────────────│───────────────────────────────────│
│  Probate Discovery Call        │  sendProbateDiscoveryCallEmail()   │
│  Trust Admin Meeting           │  sendTrustAdminMeetingEmail()      │
│  EP & Deed Discovery           │  sendEPAndDeedDiscoveryCallEmail() │
│  Doc Review Meeting            │  sendDocReviewMeetingEmail()       │
│  General Discovery             │  sendGeneralDiscoveryCallEmail()   │
│  Other                         │  sendMeetingConfirmationEmail()    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Make.com Webhook                                                   │
│  └── Sends email via configured template                           │
│      ├── Company branding                                           │
│      ├── Meeting details                                            │
│      ├── Location/Zoom link                                         │
│      └── Brochure download button                                   │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SMS FLOW (appointmentSmsService.js)                                │
│                                                                     │
│  ┌───────────────────┐    ┌────────────────────────────────────┐   │
│  │ Confirmation SMS  │    │ Reminder SMS (Scheduled)           │   │
│  │ (Immediate)       │    │                                    │   │
│  │                   │    │ Saved to Supabase scheduled_sms    │   │
│  │ Via GHL Webhook   │    │ table for processing 24h before    │   │
│  │ Automation        │    │ appointment (8am-4pm EST window)   │   │
│  └───────────────────┘    └────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Invoice Lifecycle

### Complete Invoice Flow: Creation → Payment

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              INVOICE LIFECYCLE                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘

PHASE 1: INVOICE CREATION
═══════════════════════════════════════════════════════════════════════════════════════

┌─────────────┐
│    USER     │
│ creates     │
│ Invoice     │
│ Custom Obj  │
│ in GHL      │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GHL Triggers Webhook                                               │
│  POST /webhooks/ghl/custom-object-created                           │
│  └── type: RecordCreate, objectKey: custom_objects.invoices         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RETRY LOOP (up to 6 attempts, 10s delay)                           │
│  Waiting for opportunity association...                             │
│                                                                     │
│  ├── GET /objects/{objectKey}/records/{recordId}                   │
│  │   └── Get invoice properties                                    │
│  │                                                                 │
│  └── GET /associations/relations/{recordId}                         │
│      └── Check for opportunity link                                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CALCULATE TOTAL                                                    │
│  invoiceService.calculateInvoiceTotal()                             │
│                                                                     │
│  SELECT from Supabase invoice_service_items                         │
│  WHERE service_name IN [selected_services]                          │
│  AND is_active = true                                               │
│                                                                     │
│  Returns: { total, lineItems, missingItems }                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CREATE IN CONFIDO                                                  │
│  confidoService.createInvoice()                                     │
│                                                                     │
│  GraphQL Mutation: createPaymentLink                                │
│  ├── externalId: GHL invoice record ID                             │
│  ├── amount: calculated total                                       │
│  ├── memo: service descriptions                                     │
│  └── lineItems: [{ description, amount }]                          │
│                                                                     │
│  Returns: { confidoInvoiceId, paymentUrl, status }                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌────────────────────┐
│  SAVE TO SUPABASE   │ │  UPDATE GHL         │ │  SEND EMAIL        │
│                     │ │                     │ │                    │
│  INSERT invoices    │ │  PUT custom object  │ │  Make.com Webhook  │
│  ├── ghl_invoice_id │ │  ├── payment_link   │ │  ├── Invoice PDF   │
│  ├── confido_id     │ │  ├── invoice_number │ │  ├── Line items    │
│  ├── payment_url    │ │  ├── subtotal       │ │  ├── Total         │
│  ├── amount_due     │ │  └── total          │ │  └── Pay Now link  │
│  └── status: unpaid │ │                     │ │                    │
└─────────────────────┘ └─────────────────────┘ └────────────────────┘


PHASE 2: PAYMENT RECEIVED
═══════════════════════════════════════════════════════════════════════════════════════

┌─────────────┐
│   CLIENT    │
│   pays via  │
│   Confido   │
│   payment   │
│   link      │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Confido Triggers Webhook                                           │
│  POST /webhooks/confido/payment-received                            │
│  └── { paymentLinkId, paymentId, amount, transactionDate }         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FIND INVOICE                                                       │
│  invoiceService.getInvoiceByconfidoId()                            │
│                                                                     │
│  SELECT * FROM invoices WHERE confido_invoice_id = ?                │
│  Returns: Full invoice record with GHL IDs                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌────────────────────┐
│  SAVE PAYMENT       │ │  UPDATE INVOICE     │ │  UPDATE GHL        │
│                     │ │                     │ │                    │
│  INSERT             │ │  UPDATE invoices    │ │  PUT custom object │
│  confido_payments   │ │  SET                │ │  SET               │
│  ├── payment_id     │ │  ├── status: paid   │ │  ├── status: paid  │
│  ├── amount         │ │  ├── paid_date      │ │  └── amount_paid   │
│  └── method         │ │  └── amount_paid    │ │                    │
└─────────────────────┘ └─────────────────────┘ └────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DELETE CONFIDO PAYMENTLINK                                         │
│  confidoService.deletePaymentLink()                                 │
│                                                                     │
│  GraphQL Mutation: deletePaymentLink                                │
│  (Prevents duplicate payments)                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌────────────────────┐
│  CREATE TASK        │ │  GET OPPORTUNITY    │ │  SEND PAID EMAIL   │
│                     │ │                     │ │                    │
│  POST /opportunities│ │  GET /opportunities │ │  Make.com Webhook  │
│  /tasks             │ │  /{id}              │ │  ├── PAID badge    │
│  ├── "Payment       │ │  └── Get contact    │ │  ├── Amount paid   │
│  │    Received"     │ │      email          │ │  └── Thank you     │
│  └── Due: Now       │ │                     │ │      message       │
└─────────────────────┘ └─────────────────────┘ └────────────────────┘


PHASE 3: INVOICE DELETION (Optional)
═══════════════════════════════════════════════════════════════════════════════════════

┌─────────────┐
│    USER     │
│  deletes    │
│  Invoice    │
│  in GHL     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  POST /webhooks/ghl/custom-object-deleted                           │
│  (Routed from custom-object-created for RecordDelete type)         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CLEANUP                                                            │
│                                                                     │
│  1. Get invoice from Supabase                                       │
│  2. Delete PaymentLink from Confido (if exists)                    │
│  3. Update Supabase: status = 'deleted' (keep for audit)           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Task Automation Flow

### Stage Change → Task Creation → Sync

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              TASK AUTOMATION FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  OPPORTUNITY STAGE CHANGES IN GHL                                   │
│  (Via drag-drop, workflow, or API)                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GHL Workflow triggers webhook                                      │
│  POST /webhooks/ghl/opportunity-stage-changed                       │
│                                                                     │
│  {                                                                  │
│    type: "OpportunityStageUpdate",                                  │
│    id: "opportunity_id",                                            │
│    contactId: "contact_id",                                         │
│    pipelineStageId: "new_stage_id",                                │
│    pipelineStageName: "Stage Name",                                 │
│    previousStageId: "old_stage_id"                                 │
│  }                                                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ghlOpportunityService.processOpportunityStageChange()              │
│                                                                     │
│  STAGE → TASK MAPPING:                                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Stage Name              │  Task(s) Created                    │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │  "Discovery Call"        │  "Follow up on Discovery Call"      │ │
│  │  "Scheduled Discovery"   │  "Prepare for Discovery Call"       │ │
│  │  "Initial/Vision"        │  "Prepare I/V Meeting Materials"    │ │
│  │  "Signing Meeting"       │  "Prepare Documents for Signing"    │ │
│  │  "Probate Started"       │  "Review Probate Timeline"          │ │
│  │  [Other stages]          │  [Stage-specific tasks]             │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FOR EACH TASK TO CREATE:                                           │
│                                                                     │
│  ghlService.createTask()                                            │
│  POST /opportunities/tasks                                          │
│  {                                                                  │
│    contactId: contact_id,                                           │
│    title: "Task Title",                                             │
│    body: "Task description",                                        │
│    dueDate: calculated_date,                                        │
│    opportunityId: opportunity_id,                                   │
│    assignedTo: default_assignee (optional)                         │
│  }                                                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GHL TRIGGERS TASK CREATED WEBHOOK                                  │
│  POST /webhooks/ghl/task-created                                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ghlTaskService.processTaskCreation()                               │
│                                                                     │
│  1. Extract task data from webhook                                  │
│  2. Get assignee info (if assignedTo provided)                     │
│  3. syncTaskToSupabase()                                           │
│                                                                     │
│  UPSERT ghl_tasks                                                   │
│  ON CONFLICT (ghl_task_id) UPDATE                                   │
│  {                                                                  │
│    ghl_task_id, ghl_contact_id, task_name,                         │
│    task_description, assignee_name, assignee_id,                   │
│    due_date, completed                                              │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  WHEN TASK COMPLETED IN GHL                                         │
│  POST /webhooks/ghl/task-completed                                  │
│                                                                     │
│  UPDATE ghl_tasks                                                   │
│  SET completed = true                                               │
│  WHERE ghl_task_id = ?                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Workshop Flow

### Workshop Creation + Contact Association

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              WORKSHOP FLOW                                           │
└─────────────────────────────────────────────────────────────────────────────────────┘

PHASE 1: WORKSHOP CREATION
═══════════════════════════════════════════════════════════════════════════════════════

┌─────────────┐
│   ADMIN     │
│ fills out   │
│ JotForm     │
│ Workshop    │
│ form        │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  POST /workshop                                                     │
│  └── rawRequest with workshop details and files                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  create-workshop-event.js - parseRawData()                          │
│                                                                     │
│  Extract:                                                           │
│  ├── q3_workshopName → title                                       │
│  ├── q5_workshopDate → date (MM/DD/YYYY)                           │
│  ├── q4_workshopTime → time (HH:MM AM/PM)                          │
│  ├── q7_workshopAddress → location                                 │
│  ├── q8_workshopDescription → notes (combined)                     │
│  ├── q9_workshopNotes → notes (combined)                           │
│  ├── q11_typeOfWorkshop → type (seminar/webinar)                   │
│  ├── q12_capacity → max_capacity                                    │
│  └── relevantFiles → file URLs                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  downloadFiles()                                                    │
│  └── Download files from JotForm URLs                              │
│                                                                     │
│  (Files downloaded but not uploaded - handled separately)          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  createWorkshopGHL()                                                │
│                                                                     │
│  POST /objects/custom_objects.workshops/records                     │
│  {                                                                  │
│    locationId: GHL_LOCATION_ID,                                     │
│    properties: {                                                    │
│      title: "Workshop Name",                                        │
│      date: "MM/DD/YYYY",                                            │
│      time: "HH:MM AM/PM",                                           │
│      location: "Full Address",                                      │
│      type: "seminar" | "webinar",                                   │
│      max_capacity: 100,                                             │
│      joined_attendees: 0,                                           │
│      notes: "Description + Notes",                                  │
│      status: "scheduled"                                            │
│    }                                                                │
│  }                                                                  │
│                                                                     │
│  Returns: { record: { id: "workshop_record_id" } }                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  saveWorkshopToSupabase()                                           │
│                                                                     │
│  INSERT INTO workshops {                                            │
│    ghl_workshop_id,                                                 │
│    title,                                                           │
│    event_date,                                                      │
│    event_time,                                                      │
│    workshop_type,                                                   │
│    location,                                                        │
│    description,                                                     │
│    notes,                                                           │
│    max_capacity                                                     │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘


PHASE 2: CONTACT ASSOCIATION
═══════════════════════════════════════════════════════════════════════════════════════

┌─────────────┐
│   CONTACT   │
│  registers  │
│  for        │
│  workshop   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  POST /associate-contact-workshop                                   │
│  {                                                                  │
│    contactId: "ghl_contact_id",                                     │
│    eventTitle: "Workshop Name",                                     │
│    eventDate: "MM/DD/YYYY",                                         │
│    eventTime: "HH:MM AM/PM",                                        │
│    eventType: "Seminar" | "Webinar" | "Office"                     │
│  }                                                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  associate-contact-to-workshop.js - findWorkshopId()                │
│                                                                     │
│  SELECT ghl_workshop_id FROM workshops                              │
│  WHERE title ILIKE 'Workshop Name'                                  │
│  AND event_date = 'MM/DD/YYYY'                                      │
│  AND event_time ILIKE 'HH:MM AM/PM'                                 │
│  AND workshop_type ILIKE 'Seminar'                                  │
│                                                                     │
│  Returns: workshop record ID                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  createContactWorkshopRelation()                                    │
│                                                                     │
│  POST /associations/relations                                       │
│  {                                                                  │
│    locationId: GHL_LOCATION_ID,                                     │
│    associationId: GHL_ASSOCIATION_ID,                               │
│    firstRecordId: contact_id,                                       │
│    secondRecordId: workshop_record_id                               │
│  }                                                                  │
│                                                                     │
│  Creates link: Contact ↔ Workshop                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Payment Flow

### Complete Payment Processing

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              PAYMENT FLOW                                            │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT receives invoice email with payment link                    │
│  └── https://pay.confido.com/paymentlink/{id}                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT COMPLETES PAYMENT                                           │
│  ├── Enters payment info (card, ACH, etc.)                         │
│  └── Confido processes payment                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CONFIDO PAYMENT WEBHOOK                                            │
│  POST /webhooks/confido/payment-received                            │
│                                                                     │
│  {                                                                  │
│    event: "payment.completed",                                      │
│    paymentLinkId: "confido_invoice_id",                            │
│    paymentId: "payment_transaction_id",                             │
│    amount: 5000.00,                                                 │
│    transactionDate: "2024-12-15T10:00:00Z",                        │
│    paymentMethod: "credit_card"                                     │
│  }                                                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LOOKUP INVOICE                                                     │
│                                                                     │
│  getInvoiceByconfidoId(paymentLinkId)                              │
│  SELECT * FROM invoices WHERE confido_invoice_id = ?                │
│                                                                     │
│  Returns:                                                           │
│  ├── ghl_invoice_id                                                 │
│  ├── ghl_opportunity_id                                             │
│  ├── ghl_contact_id                                                 │
│  └── All invoice details                                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: SAVE PAYMENT RECORD                                        │
│                                                                     │
│  savePaymentToSupabase()                                            │
│  INSERT INTO confido_payments {                                     │
│    confido_payment_id,                                              │
│    confido_invoice_id,                                              │
│    ghl_invoice_id,                                                  │
│    ghl_contact_id,                                                  │
│    ghl_opportunity_id,                                              │
│    amount,                                                          │
│    payment_method,                                                  │
│    status: 'completed',                                             │
│    transaction_date,                                                │
│    raw_webhook_data                                                 │
│  }                                                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: UPDATE INVOICE STATUS                                      │
│                                                                     │
│  updateInvoicePaymentStatus()                                       │
│  UPDATE invoices SET                                                │
│    status = 'paid',                                                 │
│    amount_paid = payment_amount,                                    │
│    paid_date = transaction_date                                     │
│  WHERE confido_invoice_id = ?                                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: UPDATE GHL CUSTOM OBJECT                                   │
│                                                                     │
│  updateCustomObject()                                               │
│  PUT /objects/custom_objects.invoices/records/{id}                 │
│  {                                                                  │
│    properties: {                                                    │
│      status: "paid",                                                │
│      amount_paid: { value: 5000, currency: "default" }             │
│    }                                                                │
│  }                                                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 4: DELETE CONFIDO PAYMENTLINK                                 │
│                                                                     │
│  deletePaymentLink()                                                │
│  GraphQL: mutation { deletePaymentLink(id: "...") }                │
│                                                                     │
│  (Prevents duplicate payments on same link)                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 5: GET OPPORTUNITY & CREATE TASK                              │
│                                                                     │
│  getOpportunity(ghl_opportunity_id)                                │
│  GET /opportunities/{id}                                            │
│                                                                     │
│  createTask()                                                       │
│  POST /opportunities/tasks                                          │
│  {                                                                  │
│    title: "Payment Received - {Invoice Number}",                    │
│    body: "Payment of ${amount} received via {method}",             │
│    dueDate: now,                                                    │
│    contactId: contact_id,                                           │
│    opportunityId: opportunity_id                                    │
│  }                                                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 6: SEND PAID CONFIRMATION EMAIL                               │
│                                                                     │
│  sendPaidInvoiceEmail()                                             │
│  POST Make.com Webhook                                              │
│  {                                                                  │
│    type: "invoice_paid",                                            │
│    recipientEmail: contact_email,                                   │
│    billedTo: client_name,                                           │
│    invoiceNumber: invoice_number,                                   │
│    paidDate: transaction_date,                                      │
│    amountPaid: amount                                               │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FINAL RESPONSE                                                     │
│  {                                                                  │
│    success: true,                                                   │
│    message: "Payment processed successfully",                       │
│    paymentId: payment_record_id,                                    │
│    invoiceId: invoice_id,                                           │
│    amount: 5000,                                                    │
│    invoiceStatus: "paid",                                           │
│    emailSent: true                                                  │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## System Integration Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE SYSTEM INTEGRATION                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────────┐
                    │               JOTFORM                     │
                    │  ├── Estate Planning Form                │
                    │  ├── Intake Form                         │
                    │  ├── Workshop Form                       │
                    │  └── Survey Form                         │
                    └──────────────────┬───────────────────────┘
                                       │ Webhooks
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                      │
│                            EXPRESS SERVER (server.js)                                │
│                                 Port: 3000                                           │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              SERVICES LAYER                                     │ │
│  ├────────────────────────────────────────────────────────────────────────────────┤ │
│  │ ghlService.js          │ Contact/Opportunity/Task CRUD, Custom Objects        │ │
│  │ ghlOpportunityService  │ Stage transitions, Task automation                   │ │
│  │ ghlTaskService.js      │ Task sync to Supabase                                │ │
│  │ appointmentService.js  │ Calendar/appointment processing                      │ │
│  │ appointmentEmailSvc    │ Meeting confirmation emails                          │ │
│  │ appointmentSmsSvc      │ SMS confirmations and reminders                      │ │
│  │ invoiceService.js      │ Invoice database operations                          │ │
│  │ invoicePdfService.js   │ PDF generation                                       │ │
│  │ invoiceEmailService    │ Invoice email delivery                               │ │
│  │ confidoService.js      │ Confido GraphQL integration                          │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
          │                    │                    │                    │
          ▼                    ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   GOHIGHLEVEL   │  │    SUPABASE     │  │    CONFIDO      │  │    MAKE.COM     │
│      (CRM)      │  │   (Database)    │  │   (Payments)    │  │ (Email/SMS)     │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • Contacts      │  │ • invoices      │  │ • PaymentLinks  │  │ • Email         │
│ • Opportunities │  │ • confido_pay   │  │ • Transactions  │  │   Templates     │
│ • Tasks         │  │ • ghl_tasks     │  │ • Clients       │  │ • SMS via       │
│ • Calendars     │  │ • workshops     │  │ • Matters       │  │   GHL Webhook   │
│ • Custom Objects│  │ • scheduled_sms │  │                 │  │                 │
│   - Invoices    │  │ • service_items │  │                 │  │                 │
│   - Workshops   │  │                 │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
          │                                         │
          └────────────────────┬────────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────────────────┐
                    │                CLIENT                     │
                    │  ├── Receives confirmation emails        │
                    │  ├── Receives SMS reminders              │
                    │  ├── Views invoice online                │
                    │  └── Makes payments via Confido          │
                    └──────────────────────────────────────────┘
```
