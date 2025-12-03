# Migration 003: Move Business Logic to Database

**Created:** 2025-10-03
**Status:** Ready for execution
**Risk Level:** LOW (additive only, no breaking changes)

---

## Problem Statement

**Current Issues:**
- Calendar event mappings hardcoded in meeting-scheduled.js
- Attempt sequences hardcoded in task-completion.js
- Location keywords hardcoded in assignee-resolver.js
- Requires code deployment to change business rules

**Benefits of Moving to Database:**
- Business users can update configuration without code changes
- No deployments needed for business rule changes
- Centralized configuration management
- Audit trail of configuration changes

---

## Configuration Tables

### 1. calendar_event_mappings

Maps calendar event types to matter stages.

```sql
CREATE TABLE calendar_event_mappings (
  calendar_event_id BIGINT PRIMARY KEY,
  stage_id BIGINT NOT NULL,
  stage_name TEXT NOT NULL,
  uses_meeting_location BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert current mappings
INSERT INTO calendar_event_mappings (calendar_event_id, stage_id, stage_name, uses_meeting_location) VALUES
  (334801, 707058, 'Initial Consultation', FALSE),
  (334816, 707073, 'Signing Meeting', TRUE),
  (334846, 828078, 'Vision Meeting', FALSE),
  (334831, 828078, 'Initial Meeting', FALSE),
  (372457, 1, 'Custom Meeting 1', FALSE),
  (398707, 2, 'Custom Meeting 2', FALSE);
```

### 2. attempt_sequences

Defines attempt task sequences (Attempt 1 → 2 → 3 → No Response).

```sql
CREATE TABLE attempt_sequences (
  id SERIAL PRIMARY KEY,
  current_attempt TEXT NOT NULL UNIQUE,
  next_attempt TEXT NOT NULL,
  sequence_order INTEGER NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert current sequences
INSERT INTO attempt_sequences (current_attempt, next_attempt, sequence_order) VALUES
  ('attempt 1', 'Attempt 2', 1),
  ('attempt 2', 'Attempt 3', 2),
  ('attempt 3', 'No Response', 3);

-- Index for quick lookups
CREATE INDEX idx_attempt_sequences_current ON attempt_sequences(current_attempt) WHERE active = TRUE;
```

### 3. location_keywords

Defines valid location keywords for assignee resolution.

```sql
CREATE TABLE location_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert current keywords
INSERT INTO location_keywords (keyword, description) VALUES
  ('fort', 'Fort Myers'),
  ('bonita', 'Bonita Springs'),
  ('naples', 'Naples'),
  ('springs', 'Bonita Springs (alternate)'),
  ('myers', 'Fort Myers (alternate)');

-- Index for quick lookups
CREATE INDEX idx_location_keywords_keyword ON location_keywords(keyword) WHERE active = TRUE;
```

---

## Code Changes

### 1. SupabaseService - Add Configuration Methods

```javascript
// In src/services/supabase.js

/**
 * Get calendar event mapping
 */
static async getCalendarEventMapping(calendarEventId) {
  const { data, error } = await supabase
    .from('calendar_event_mappings')
    .select('*')
    .eq('calendar_event_id', calendarEventId)
    .eq('active', true)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data || null;
}

/**
 * Get all active calendar event mappings
 */
static async getAllCalendarEventMappings() {
  const { data, error } = await supabase
    .from('calendar_event_mappings')
    .select('*')
    .eq('active', true);

  if (error) throw error;
  return data || [];
}

/**
 * Get attempt sequence
 */
static async getAttemptSequence(currentAttempt) {
  const { data, error } = await supabase
    .from('attempt_sequences')
    .select('*')
    .eq('current_attempt', currentAttempt.toLowerCase())
    .eq('active', true)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Get all active attempt sequences
 */
static async getAllAttemptSequences() {
  const { data, error } = await supabase
    .from('attempt_sequences')
    .select('*')
    .eq('active', true)
    .order('sequence_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get all active location keywords
 */
static async getLocationKeywords() {
  const { data, error } = await supabase
    .from('location_keywords')
    .select('keyword')
    .eq('active', true);

  if (error) throw error;
  return (data || []).map(row => row.keyword);
}
```

### 2. Update meeting-scheduled.js

```javascript
// BEFORE
const CALENDAR_STAGE_MAPPINGS = {
  334801: { stageId: 707058, stageName: 'Initial Consultation' },
  // ...
};

const mapping = CALENDAR_STAGE_MAPPINGS[calendarEventTypeId];

// AFTER
const mapping = await SupabaseService.getCalendarEventMapping(calendarEventTypeId);
if (!mapping) {
  console.log(`[CALENDAR] ${calendarEntryId} Event type not mapped`);
  return { success: true, action: 'not_mapped' };
}

// Update references:
// mapping.stageId → mapping.stage_id
// mapping.stageName → mapping.stage_name
// mapping.usesMeetingLocation → mapping.uses_meeting_location
```

### 3. Update task-completion.js

```javascript
// BEFORE
const attemptMap = {
  'attempt 1': 'Attempt 2',
  'attempt 2': 'Attempt 3',
  'attempt 3': 'No Response',
};

for (const [current, next] of Object.entries(attemptMap)) {
  if (taskName.includes(current)) {
    // ...
  }
}

// AFTER
const attemptSequences = await SupabaseService.getAllAttemptSequences();

for (const sequence of attemptSequences) {
  if (taskName.includes(sequence.current_attempt)) {
    console.log(`[TASK] ${taskId} Attempt sequence: ${sequence.current_attempt} → ${sequence.next_attempt}`);

    const nextTemplate = taskTemplates.find(t =>
      t.task_title.toLowerCase().includes(sequence.next_attempt.toLowerCase())
    );
    // ... rest of logic
  }
}
```

### 4. Update assignee-resolver.js

```javascript
// BEFORE
function extractLocationKeyword(locationString) {
  if (!locationString) return null;
  const pattern = /\b(fort|bonita|naples|springs|myers)\b/i;
  const match = locationString.match(pattern);
  return match ? match[1].toLowerCase() : null;
}

// AFTER
async function extractLocationKeyword(locationString) {
  if (!locationString) return null;

  // Get valid keywords from database
  const keywords = await SupabaseService.getLocationKeywords();

  // Build dynamic regex pattern
  const pattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'i');
  const match = locationString.match(pattern);
  return match ? match[1].toLowerCase() : null;
}
```

### 5. Update getAssigneeByLocation in supabase.js

```javascript
// BEFORE
if (['fort', 'bonita', 'naples', 'springs', 'myers'].includes(location.toLowerCase())) {
  // ...
}

// AFTER
const keywords = await this.getLocationKeywords();
if (keywords.includes(location.toLowerCase())) {
  // ...
}
```

---

## Migration Steps

### Step 1: Create Tables

```sql
-- Execute in Supabase
CREATE TABLE calendar_event_mappings (
  calendar_event_id BIGINT PRIMARY KEY,
  stage_id BIGINT NOT NULL,
  stage_name TEXT NOT NULL,
  uses_meeting_location BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO calendar_event_mappings (calendar_event_id, stage_id, stage_name, uses_meeting_location) VALUES
  (334801, 707058, 'Initial Consultation', FALSE),
  (334816, 707073, 'Signing Meeting', TRUE),
  (334846, 828078, 'Vision Meeting', FALSE),
  (334831, 828078, 'Initial Meeting', FALSE),
  (372457, 1, 'Custom Meeting 1', FALSE),
  (398707, 2, 'Custom Meeting 2', FALSE);

CREATE TABLE attempt_sequences (
  id SERIAL PRIMARY KEY,
  current_attempt TEXT NOT NULL UNIQUE,
  next_attempt TEXT NOT NULL,
  sequence_order INTEGER NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO attempt_sequences (current_attempt, next_attempt, sequence_order) VALUES
  ('attempt 1', 'Attempt 2', 1),
  ('attempt 2', 'Attempt 3', 2),
  ('attempt 3', 'No Response', 3);

CREATE INDEX idx_attempt_sequences_current ON attempt_sequences(current_attempt) WHERE active = TRUE;

CREATE TABLE location_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO location_keywords (keyword, description) VALUES
  ('fort', 'Fort Myers'),
  ('bonita', 'Bonita Springs'),
  ('naples', 'Naples'),
  ('springs', 'Bonita Springs (alternate)'),
  ('myers', 'Fort Myers (alternate)');

CREATE INDEX idx_location_keywords_keyword ON location_keywords(keyword) WHERE active = TRUE;
```

### Step 2: Add SupabaseService Methods

Update `src/services/supabase.js` with configuration methods.

### Step 3: Update Automations

Update all three automations to use database configuration.

### Step 4: Test

Test all three automations with database configuration.

---

## Rollback Plan

If issues arise, simply revert code changes. The database tables can remain (they don't break anything).

To disable database configuration:
```sql
-- Disable all mappings
UPDATE calendar_event_mappings SET active = FALSE;
UPDATE attempt_sequences SET active = FALSE;
UPDATE location_keywords SET active = FALSE;
```

Code will fall back to empty results and fail gracefully.

---

## Future Enhancements

### Admin UI (Future)

Create a simple admin interface to manage:
- Calendar event mappings
- Attempt sequences
- Location keywords

### Configuration Audit Trail (Future)

Track who changed what and when:

```sql
CREATE TABLE config_audit_log (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'created', 'updated', 'deleted'
  old_values JSONB,
  new_values JSONB,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

**Ready for execution:** YES
**Requires downtime:** NO
**Estimated time:** 2 hours
**Risk level:** LOW
