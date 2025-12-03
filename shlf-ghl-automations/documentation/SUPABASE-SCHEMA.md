# Supabase Database Schema

**Complete database schema and table documentation**

---

## Table of Contents

1. [Overview](#overview)
2. [Tables](#tables)
3. [Indexes](#indexes)
4. [Relationships](#relationships)
5. [Row Level Security](#row-level-security)
6. [Functions & Triggers](#functions--triggers)

---

## Overview

### Database Configuration

| Setting | Value |
|---------|-------|
| Provider | Supabase (PostgreSQL) |
| Connection | Via `@supabase/supabase-js` |
| Environment Variables | `SUPABASE_URL`, `SUPABASE_KEY` |

### Tables Summary

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `ghl_tasks` | GHL task sync for reporting | `id` (UUID) |
| `invoices` | Invoice tracking between GHL and Confido | `id` (UUID) |
| `confido_payments` | Payment transaction records | `id` (UUID) |
| `invoice_service_items` | Service catalog with pricing | `id` (UUID) |
| `workshops` | Workshop event tracking | `id` (UUID) |
| `scheduled_sms` | SMS reminder queue | `id` (UUID) |

---

## Tables

### 1. ghl_tasks

**Purpose:** Syncs tasks created in GoHighLevel for reporting and tracking.

**Migration:** `create_tasks_table.sql`

```sql
CREATE TABLE public.ghl_tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ghl_task_id TEXT UNIQUE NOT NULL,
    ghl_contact_id TEXT,
    task_name TEXT NOT NULL,
    task_description TEXT,
    assignee_name TEXT,
    assignee_id TEXT,
    due_date TIMESTAMPTZ,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, auto-generated | Internal unique identifier |
| `ghl_task_id` | TEXT | UNIQUE, NOT NULL | GHL task ID for deduplication |
| `ghl_contact_id` | TEXT | nullable | Associated contact ID |
| `task_name` | TEXT | NOT NULL | Task title from GHL |
| `task_description` | TEXT | nullable | Task body/description |
| `assignee_name` | TEXT | nullable | Name of assigned user |
| `assignee_id` | TEXT | nullable | GHL user ID of assignee |
| `due_date` | TIMESTAMPTZ | nullable | Task due date |
| `completed` | BOOLEAN | DEFAULT FALSE | Completion status |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation time |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update time |

**Service Functions:**
- `syncTaskToSupabase()` - ghlTaskService.js:8
- `processTaskCreation()` - ghlTaskService.js:91

---

### 2. invoices

**Purpose:** Stores invoices synced between GHL custom objects and Confido Legal.

**Migration:** `create_invoices_and_payments_tables.sql`, `20251127_add_invoice_service_items.sql`

```sql
CREATE TABLE public.invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- GHL identifiers
    ghl_invoice_id TEXT UNIQUE NOT NULL,
    ghl_opportunity_id TEXT,
    ghl_contact_id TEXT,

    -- Display names
    opportunity_name TEXT,
    primary_contact_name TEXT,

    -- Confido identifiers
    confido_invoice_id TEXT UNIQUE,
    confido_client_id TEXT,
    confido_matter_id TEXT,
    invoice_number TEXT,
    payment_url TEXT,

    -- Service items
    service_items JSONB,

    -- Financial data
    amount_due DECIMAL(10,2) NOT NULL,
    amount_paid DECIMAL(10,2) DEFAULT 0.00,

    -- Status tracking
    status TEXT DEFAULT 'pending',

    -- Date tracking
    invoice_date TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    paid_date TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, auto-generated | Internal unique identifier |
| `ghl_invoice_id` | TEXT | UNIQUE, NOT NULL | GHL custom object record ID |
| `ghl_opportunity_id` | TEXT | nullable | Associated opportunity ID |
| `ghl_contact_id` | TEXT | nullable | Associated contact ID |
| `opportunity_name` | TEXT | nullable | Opportunity display name |
| `primary_contact_name` | TEXT | nullable | Contact display name |
| `confido_invoice_id` | TEXT | UNIQUE, nullable | Confido PaymentLink ID |
| `confido_client_id` | TEXT | nullable | Confido client directory ID |
| `confido_matter_id` | TEXT | nullable | Confido matter directory ID |
| `invoice_number` | TEXT | nullable | Display invoice number (INV-YYYYMMDD-XXXX) |
| `payment_url` | TEXT | nullable | Confido payment link URL |
| `service_items` | JSONB | nullable | Array of service items: `[{name, price, quantity}]` |
| `amount_due` | DECIMAL(10,2) | NOT NULL | Total amount due in dollars |
| `amount_paid` | DECIMAL(10,2) | DEFAULT 0.00 | Amount paid |
| `status` | TEXT | DEFAULT 'pending' | Status: pending, paid, overdue, cancelled, deleted |
| `invoice_date` | TIMESTAMPTZ | nullable | Invoice creation date |
| `due_date` | TIMESTAMPTZ | nullable | Payment due date |
| `paid_date` | TIMESTAMPTZ | nullable | Date payment received |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation time |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update time |

**Service Functions:**
- `saveInvoiceToSupabase()` - invoiceService.js:18
- `updateInvoicePaymentStatus()` - invoiceService.js:80
- `getInvoiceByGHLId()` - invoiceService.js:135
- `getInvoiceByInvoiceNumber()` - invoiceService.js:180
- `getInvoiceByconfidoId()` - invoiceService.js:225
- `updateInvoiceInSupabase()` - invoiceService.js:480

---

### 3. confido_payments

**Purpose:** Stores payment transactions received from Confido webhooks.

**Migration:** `create_invoices_and_payments_tables.sql`

```sql
CREATE TABLE public.confido_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Confido identifiers
    confido_payment_id TEXT UNIQUE NOT NULL,
    confido_invoice_id TEXT,

    -- GHL identifiers (from linked invoice)
    ghl_invoice_id TEXT,
    ghl_contact_id TEXT,
    ghl_opportunity_id TEXT,

    -- Payment details
    amount DECIMAL(10,2) NOT NULL,
    payment_method TEXT,
    status TEXT DEFAULT 'completed',

    -- Transaction info
    transaction_date TIMESTAMPTZ NOT NULL,

    -- Raw webhook data for debugging
    raw_webhook_data JSONB,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, auto-generated | Internal unique identifier |
| `confido_payment_id` | TEXT | UNIQUE, NOT NULL | Confido payment transaction ID |
| `confido_invoice_id` | TEXT | nullable | Associated Confido PaymentLink ID |
| `ghl_invoice_id` | TEXT | nullable | Associated GHL invoice record ID |
| `ghl_contact_id` | TEXT | nullable | Associated GHL contact ID |
| `ghl_opportunity_id` | TEXT | nullable | Associated GHL opportunity ID |
| `amount` | DECIMAL(10,2) | NOT NULL | Payment amount in dollars |
| `payment_method` | TEXT | nullable | Payment method (credit_card, ach, etc.) |
| `status` | TEXT | DEFAULT 'completed' | Status: completed, pending, failed, refunded |
| `transaction_date` | TIMESTAMPTZ | NOT NULL | When payment was processed |
| `raw_webhook_data` | JSONB | nullable | Full webhook payload for auditing |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation time |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update time |

**Service Functions:**
- `savePaymentToSupabase()` - invoiceService.js:270

---

### 4. invoice_service_items

**Purpose:** Catalog of billable service items with prices for GHL custom invoices.

**Migration:** `20251127_add_invoice_service_items.sql`

```sql
CREATE TABLE public.invoice_service_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    service_name TEXT UNIQUE NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, auto-generated | Internal unique identifier |
| `service_name` | TEXT | UNIQUE, NOT NULL | Service name matching GHL field |
| `price` | DECIMAL(10,2) | NOT NULL | Price in dollars |
| `description` | TEXT | nullable | Service description |
| `is_active` | BOOLEAN | DEFAULT true | Whether service is available |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation time |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update time |

**Usage:**
When an invoice is created in GHL, the selected service items are looked up in this table to calculate the total amount.

**Service Functions:**
- `calculateInvoiceTotal()` - invoiceService.js:361
- `getServiceItems()` - invoiceService.js:441

---

### 5. workshops

**Purpose:** Tracks workshop events created from JotForm submissions.

**Schema (implied from code):**

```sql
CREATE TABLE public.workshops (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ghl_workshop_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    event_date TEXT,
    event_time TEXT,
    workshop_type TEXT,
    location TEXT,
    description TEXT,
    notes TEXT,
    max_capacity INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, auto-generated | Internal unique identifier |
| `ghl_workshop_id` | TEXT | UNIQUE, NOT NULL | GHL custom object record ID |
| `title` | TEXT | NOT NULL | Workshop name |
| `event_date` | TEXT | nullable | Date (MM/DD/YYYY format) |
| `event_time` | TEXT | nullable | Time (HH:MM AM/PM format) |
| `workshop_type` | TEXT | nullable | Type: seminar, webinar |
| `location` | TEXT | nullable | Full address |
| `description` | TEXT | nullable | Workshop description |
| `notes` | TEXT | nullable | Additional notes |
| `max_capacity` | INTEGER | nullable | Maximum attendees |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation time |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update time |

**Service Functions:**
- `saveWorkshopToSupabase()` - create-workshop-event.js:285
- `findWorkshopId()` - associate-contact-to-workshop.js:28

---

### 6. scheduled_sms

**Purpose:** Queue for scheduled SMS reminders (processed by cron job).

**Schema (implied from code):**

```sql
CREATE TABLE public.scheduled_sms (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    contact_id TEXT NOT NULL,
    contact_name TEXT,
    contact_phone TEXT,
    appointment_id TEXT,
    event_title TEXT,
    appointment_time TIMESTAMPTZ,
    location TEXT,
    scheduled_send_time TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Columns:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, auto-generated | Internal unique identifier |
| `contact_id` | TEXT | NOT NULL | GHL contact ID |
| `contact_name` | TEXT | nullable | Contact full name |
| `contact_phone` | TEXT | nullable | Contact phone number |
| `appointment_id` | TEXT | nullable | GHL appointment ID |
| `event_title` | TEXT | nullable | Appointment title |
| `appointment_time` | TIMESTAMPTZ | nullable | Appointment date/time |
| `location` | TEXT | nullable | Meeting location |
| `scheduled_send_time` | TIMESTAMPTZ | NOT NULL | When to send SMS |
| `status` | TEXT | DEFAULT 'pending' | Status: pending, sent, failed, cancelled |
| `sent_at` | TIMESTAMPTZ | nullable | When SMS was actually sent |
| `error_message` | TEXT | nullable | Error message if failed |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Record creation time |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Last update time |

**Service Functions:**
- `scheduleReminderSms()` - appointmentSmsService.js:193
- `processScheduledReminders()` - appointmentSmsService.js:263
- `cancelScheduledReminder()` - appointmentSmsService.js:365

---

## Indexes

### ghl_tasks Indexes
```sql
CREATE INDEX idx_tasks_ghl_task_id ON public.ghl_tasks(ghl_task_id);
CREATE INDEX idx_tasks_ghl_contact_id ON public.ghl_tasks(ghl_contact_id);
CREATE INDEX idx_tasks_assignee_id ON public.ghl_tasks(assignee_id);
CREATE INDEX idx_tasks_due_date ON public.ghl_tasks(due_date);
```

### invoices Indexes
```sql
CREATE INDEX idx_invoices_ghl_invoice_id ON public.invoices(ghl_invoice_id);
CREATE INDEX idx_invoices_confido_invoice_id ON public.invoices(confido_invoice_id);
CREATE INDEX idx_invoices_ghl_opportunity_id ON public.invoices(ghl_opportunity_id);
CREATE INDEX idx_invoices_ghl_contact_id ON public.invoices(ghl_contact_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_created_at ON public.invoices(created_at);
CREATE INDEX idx_invoices_payment_url ON public.invoices(payment_url);
```

### confido_payments Indexes
```sql
CREATE INDEX idx_confido_payments_payment_id ON public.confido_payments(confido_payment_id);
CREATE INDEX idx_confido_payments_invoice_id ON public.confido_payments(confido_invoice_id);
CREATE INDEX idx_confido_payments_ghl_invoice_id ON public.confido_payments(ghl_invoice_id);
CREATE INDEX idx_confido_payments_transaction_date ON public.confido_payments(transaction_date);
```

### invoice_service_items Indexes
```sql
CREATE INDEX idx_service_items_name ON public.invoice_service_items(service_name);
CREATE INDEX idx_service_items_active ON public.invoice_service_items(is_active);
```

---

## Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ENTITY RELATIONSHIPS                            │
└─────────────────────────────────────────────────────────────────────────┘

                         ┌─────────────────────┐
                         │    GHL Contact      │
                         │  (External - GHL)   │
                         └──────────┬──────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   ghl_tasks     │       │    invoices     │       │  scheduled_sms  │
│ (ghl_contact_id)│       │ (ghl_contact_id)│       │  (contact_id)   │
└─────────────────┘       └────────┬────────┘       └─────────────────┘
                                   │
                                   │ (confido_invoice_id)
                                   ▼
                          ┌─────────────────┐
                          │confido_payments │
                          │(confido_invoice_│
                          │      id)        │
                          └─────────────────┘

                         ┌─────────────────────┐
                         │  GHL Opportunity    │
                         │  (External - GHL)   │
                         └──────────┬──────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│    invoices     │       │confido_payments │       │   (via GHL)     │
│(ghl_opportunity_│       │(ghl_opportunity_│       │                 │
│      id)        │       │      id)        │       │                 │
└─────────────────┘       └─────────────────┘       └─────────────────┘

               ┌─────────────────────┐
               │invoice_service_items│
               │    (Catalog)        │
               └──────────┬──────────┘
                          │
                          │ (Referenced by service_name in invoices.service_items)
                          ▼
               ┌─────────────────────┐
               │      invoices       │
               │   (service_items    │
               │       JSONB)        │
               └─────────────────────┘
```

### Logical Relationships

1. **invoices ↔ confido_payments**
   - Linked via `confido_invoice_id`
   - One invoice can have multiple payments (partial payments)

2. **invoices ↔ invoice_service_items**
   - Service items are looked up by name during invoice creation
   - Stored as JSONB array in `invoices.service_items`

3. **All tables ↔ GHL**
   - GHL IDs (contact, opportunity, invoice, task) link records to external GHL entities

---

## Row Level Security

All tables have RLS enabled with permissive policies (adjust for production):

```sql
-- Enable RLS
ALTER TABLE public.ghl_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.confido_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_service_items ENABLE ROW LEVEL SECURITY;

-- Policies (current: allow all)
CREATE POLICY "Allow all operations on tasks"
    ON public.ghl_tasks FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on invoices"
    ON public.invoices FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on confido_payments"
    ON public.confido_payments FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on service items"
    ON public.invoice_service_items FOR ALL USING (true) WITH CHECK (true);
```

**Note:** For production, consider implementing stricter policies based on user roles or API keys.

---

## Functions & Triggers

### updated_at Trigger Function

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Triggers Applied

```sql
-- ghl_tasks
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON public.ghl_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- invoices
CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- confido_payments
CREATE TRIGGER update_confido_payments_updated_at
    BEFORE UPDATE ON public.confido_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## Sample Queries

### Get Pending Invoices
```sql
SELECT * FROM invoices
WHERE status = 'pending'
ORDER BY created_at DESC;
```

### Get Invoice with Payment History
```sql
SELECT
    i.*,
    p.amount as payment_amount,
    p.payment_method,
    p.transaction_date
FROM invoices i
LEFT JOIN confido_payments p ON i.confido_invoice_id = p.confido_invoice_id
WHERE i.invoice_number = 'INV-20241215-A84C';
```

### Get Tasks by Contact
```sql
SELECT * FROM ghl_tasks
WHERE ghl_contact_id = 'contact_id_here'
AND completed = false
ORDER BY due_date ASC;
```

### Calculate Invoice Total from Service Items
```sql
SELECT
    service_name,
    price
FROM invoice_service_items
WHERE service_name IN ('Service A', 'Service B')
AND is_active = true;
```

### Get Due SMS Reminders
```sql
SELECT * FROM scheduled_sms
WHERE status = 'pending'
AND scheduled_send_time <= NOW()
ORDER BY scheduled_send_time ASC;
```
