# GHL Automation System Overview

**Project:** Safe Harbor Law - GoHighLevel Automations
**Version:** 1.0
**Last Updated:** December 2024

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Integrated Platforms](#integrated-platforms)
4. [Core Modules](#core-modules)
5. [Quick Reference](#quick-reference)

---

## System Overview

This is an integration hub that connects multiple platforms for Safe Harbor Law's client management workflow. The system handles:

- **Form Processing**: JotForm submissions for intake and estate planning
- **CRM Management**: Contact and opportunity management in GoHighLevel
- **Pipeline Automation**: Stage transitions and automated task creation
- **Calendar Integration**: Appointment scheduling with email/SMS confirmations
- **Invoice Processing**: Invoice creation, payment processing via Confido Legal
- **Workshop Management**: Custom object management for workshops

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SOURCES                                │
├───────────────┬─────────────┬─────────────┬─────────────┬──────────────┤
│    JotForm    │     GHL     │   Confido   │   Make.com  │   Browser    │
│   (Forms)     │  (Webhooks) │  (Payments) │   (Email)   │  (Viewer)    │
└───────┬───────┴──────┬──────┴──────┬──────┴──────┬──────┴───────┬──────┘
        │              │             │             │              │
        ▼              ▼             ▼             ▼              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     EXPRESS SERVER (server.js)                           │
│                          Port: 3000                                      │
├─────────────────────────────────────────────────────────────────────────┤
│  /webhook/jotform         │ JotForm estate planning form               │
│  /webhook/jotform-intake  │ JotForm intake form                        │
│  /webhooks/intakeForm     │ Intake form with call details              │
│  /webhooks/intakeSurvey   │ Intake survey → stage update               │
│  /workshop                │ Workshop creation from JotForm             │
│  /associate-contact-workshop │ Contact-Workshop association            │
│  /webhooks/ghl/*          │ GHL webhook handlers                       │
│  /webhooks/confido/*      │ Confido payment webhooks                   │
│  /invoice/:invoiceNumber  │ Invoice viewer page                        │
└─────────────────────────────────────────────────────────────────────────┘
        │              │             │             │              │
        ▼              ▼             ▼             ▼              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          SERVICES LAYER                                  │
├───────────────┬─────────────┬─────────────┬─────────────┬──────────────┤
│  ghlService   │ appointment │  invoice    │  confido    │  ghlTask     │
│               │  Service    │  Service    │  Service    │  Service     │
└───────────────┴─────────────┴─────────────┴─────────────┴──────────────┘
        │              │             │             │              │
        ▼              ▼             ▼             ▼              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       EXTERNAL DESTINATIONS                              │
├───────────────┬─────────────┬─────────────┬─────────────┬──────────────┤
│  GoHighLevel  │  Supabase   │   Confido   │   Make.com  │   Client     │
│   (CRM API)   │    (DB)     │  (GraphQL)  │  (Webhooks) │   (Email)    │
└───────────────┴─────────────┴─────────────┴─────────────┴──────────────┘
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18.x |
| Framework | Express.js |
| Database | PostgreSQL (Supabase) |
| HTTP Client | Axios |
| PDF Generation | Puppeteer |
| Form Parsing | Multer |
| Environment | dotenv |

---

## Integrated Platforms

### 1. GoHighLevel (GHL)
- **Purpose**: CRM, pipeline management, task management, calendar
- **API Base URL**: `https://services.leadconnectorhq.com`
- **API Version**: 2021-07-28
- **Auth**: Bearer token
- **Operations**:
  - Contact CRUD
  - Opportunity management
  - Task creation/sync
  - Appointment search
  - Custom object management (Invoices, Workshops)

### 2. JotForm
- **Purpose**: Form submissions for client intake and data collection
- **Integration Type**: Webhooks
- **Forms**:
  - Estate Planning Form
  - Intake Form
  - Workshop Registration Form

### 3. Confido Legal
- **Purpose**: Payment processing and invoice management
- **API Type**: GraphQL
- **Operations**:
  - Create PaymentLinks (invoices)
  - Query invoice status
  - Delete PaymentLinks
  - Receive payment webhooks

### 4. Supabase
- **Purpose**: Data persistence and reporting
- **Tables**:
  - `invoices` - Invoice tracking
  - `confido_payments` - Payment records
  - `ghl_tasks` - Task sync from GHL
  - `workshops` - Workshop events
  - `scheduled_sms` - SMS reminders queue
  - `invoice_service_items` - Service catalog

### 5. Make.com (Integromat)
- **Purpose**: Email and SMS automation
- **Webhooks**:
  - Appointment confirmation emails
  - Invoice emails
  - SMS notifications (via GHL)

---

## Core Modules

### Services Directory Structure

```
services/
├── ghlService.js              # GHL API operations (contacts, opportunities, tasks)
├── ghlOpportunityService.js   # Opportunity stage processing
├── ghlTaskService.js          # Task sync to Supabase
├── appointmentService.js      # Calendar/appointment management
├── appointmentEmailService.js # Meeting confirmation emails
├── appointmentSmsService.js   # SMS reminders
├── invoiceService.js          # Invoice database operations
├── invoicePdfService.js       # PDF generation
├── invoiceEmailService.js     # Invoice email delivery
├── confidoService.js          # Confido payment integration
├── pdfService.js              # PDF upload from JotForm
└── webhookService.js          # Webhook helpers
```

---

## Quick Reference

### Webhook Endpoints Summary

| Endpoint | Source | Purpose |
|----------|--------|---------|
| `POST /webhook/jotform` | JotForm | Estate planning form |
| `POST /webhook/jotform-intake` | JotForm | Intake form |
| `POST /webhooks/intakeForm` | JotForm | Intake with call details |
| `POST /webhooks/intakeSurvey` | JotForm | Survey → stage update |
| `POST /workshop` | JotForm | Workshop creation |
| `POST /associate-contact-workshop` | Internal | Contact-workshop link |
| `POST /webhooks/ghl/opportunity-stage-changed` | GHL | Stage transitions |
| `POST /webhooks/ghl/task-created` | GHL | Task sync |
| `POST /webhooks/ghl/task-completed` | GHL | Task completion |
| `POST /webhooks/ghl/appointment-created` | GHL | Appointment handling |
| `POST /webhooks/ghl/custom-object-created` | GHL | Invoice/custom object |
| `POST /webhooks/ghl/custom-object-updated` | GHL | Invoice updates |
| `POST /webhooks/ghl/custom-object-deleted` | GHL | Invoice deletion |
| `POST /webhooks/ghl/association-created` | GHL | Record associations |
| `POST /webhooks/confido/payment-received` | Confido | Payment notifications |
| `GET /invoice/:invoiceNumber` | Browser | Invoice viewer |
| `GET /health` | Monitoring | Health check |

### Environment Variables

```bash
# GHL Configuration
GHL_API_KEY=                    # Bearer token for GHL API
GHL_LOCATION_ID=                # GHL location ID
GHL_PIPELINE_ID=                # Pipeline ID
GHL_ASSOCIATION_ID=             # Contact-Workshop association ID

# JotForm Configuration
JOTFORM_API_KEY=                # JotForm API key

# Supabase Configuration
SUPABASE_URL=                   # Supabase project URL
SUPABASE_KEY=                   # Supabase anon key

# Confido Configuration
CONFIDO_API_URL=                # Confido API URL
CONFIDO_API_KEY=                # Confido API key

# Make.com Webhooks
MAKE_INVOICE_EMAIL_WEBHOOK=     # Invoice email webhook
MAKE_APPOINTMENT_EMAIL_WEBHOOK= # Appointment email webhook

# Server
PORT=3000                       # Server port
```

---

## Related Documentation

- [WEBHOOK-ENDPOINTS.md](./WEBHOOK-ENDPOINTS.md) - Detailed webhook documentation
- [OUTGOING-INTEGRATIONS.md](./OUTGOING-INTEGRATIONS.md) - External API calls
- [DATA-FLOW-DIAGRAMS.md](./DATA-FLOW-DIAGRAMS.md) - Visual flow diagrams
- [SUPABASE-SCHEMA.md](./SUPABASE-SCHEMA.md) - Database schema
