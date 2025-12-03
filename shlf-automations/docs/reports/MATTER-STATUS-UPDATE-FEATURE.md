# Matter Status Update Feature

**Date:** October 9, 2025
**Feature:** Automatically update matter status based on stage changes

---

## Overview

The automation system now automatically updates the matter status in Clio whenever a matter's stage changes. This ensures that matters have the correct status (Open, Pending, Closed, etc.) based on their current workflow stage.

---

## Configuration

### Supabase Table: `stage_status_mappings`

A new configuration table maps stage names to their corresponding matter statuses.

**Schema:**
```sql
CREATE TABLE stage_status_mappings (
  id BIGSERIAL PRIMARY KEY,
  stage_name TEXT NOT NULL UNIQUE,
  matter_status TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Initial Mappings:**

| Stage Name | Matter Status |
|------------|---------------|
| I/V MEETING | Pending |
| Did Not Engage | Closed |
| Drafting | Open |
| Signing Meeting | Open |

---

## Setup Instructions

### 1. Create the Supabase Table

Go to your Supabase Dashboard → SQL Editor and run:

```sql
-- Create stage_status_mappings table
CREATE TABLE IF NOT EXISTS stage_status_mappings (
  id BIGSERIAL PRIMARY KEY,
  stage_name TEXT NOT NULL UNIQUE,
  matter_status TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_stage_status_mappings_stage_name
  ON stage_status_mappings(stage_name) WHERE active = true;

-- Add comment
COMMENT ON TABLE stage_status_mappings IS 'Maps matter stages to their corresponding matter statuses in Clio';

-- Insert initial mappings
INSERT INTO stage_status_mappings (stage_name, matter_status, active) VALUES
  ('I/V MEETING', 'Pending', true),
  ('Did Not Engage', 'Closed', true),
  ('Drafting', 'Open', true),
  ('Signing Meeting', 'Open', true)
ON CONFLICT (stage_name) DO UPDATE SET
  matter_status = EXCLUDED.matter_status,
  updated_at = NOW();
```

### 2. Deploy the Code Changes

The following files have been updated:

- **src/services/supabase.js** - Added `getMatterStatusByStage()` method
- **src/services/clio.js** - Added `updateMatterStatus()` method
- **src/automations/matter-stage-change.js** - Added logic to update matter status after stage change

Deploy these changes to your production environment.

---

## How It Works

### Workflow

1. **Matter Stage Changes** - Webhook received when matter stage is updated in Clio
2. **Lookup Mapping** - System queries `stage_status_mappings` table for the new stage name
3. **Update Status** - If mapping exists, system calls Clio API to update matter status
4. **Continue Automation** - Task generation continues as normal

### Code Flow

```javascript
// Step 2.75: Update matter status based on stage mapping
const matterStatus = await SupabaseService.getMatterStatusByStage(currentStageName);
if (matterStatus) {
  console.log(`[MATTER] ${matterId} Updating matter status to: ${matterStatus}`);
  await ClioService.updateMatterStatus(matterId, matterStatus);
  console.log(`[MATTER] ${matterId} Matter status updated successfully`);
}
```

### Error Handling

- If stage mapping doesn't exist, status update is skipped (no error)
- If Clio API call fails, error is logged but automation continues
- Status update failure doesn't block task generation

---

## Adding More Mappings

To add status mappings for additional stages:

```sql
INSERT INTO stage_status_mappings (stage_name, matter_status, active) VALUES
  ('Pending Engagement', 'Pending', true),
  ('Completed', 'Closed', true),
  ('For Recording and Submission', 'Open', true)
ON CONFLICT (stage_name) DO UPDATE SET
  matter_status = EXCLUDED.matter_status,
  updated_at = NOW();
```

### Valid Matter Statuses in Clio

Common matter statuses:
- `Open`
- `Pending`
- `Closed`
- `Suspended`

**Note:** Check your Clio instance for the exact status values available.

---

## Testing

### Test the Feature

1. **Create Mapping** - Run the SQL to create the table and insert mappings
2. **Update Test Matter** - Change test matter 1675950832 to "I/V MEETING" stage
3. **Verify Status** - Check that matter status in Clio is updated to "Pending"
4. **Check Logs** - Review application logs for status update confirmation

### Expected Log Output

```
[MATTER] 1675950832 Confirmed stage change
[MATTER] 1675950832 Changed to stage: I/V MEETING (Estate Planning)
[MATTER] 1675950832 Updating matter status to: Pending
[MATTER] 1675950832 Matter status updated successfully
```

---

## Files Modified

### New Files

- `migrations/create-stage-status-mappings.sql` - SQL migration script
- `setup-stage-status-mappings.mjs` - Setup instructions script
- `MATTER-STATUS-UPDATE-FEATURE.md` - This documentation

### Modified Files

1. **src/services/supabase.js**
   - Added `getMatterStatusByStage(stageName)` method (lines 640-654)

2. **src/services/clio.js**
   - Added `updateMatterStatus(matterId, status)` method (lines 101-111)

3. **src/automations/matter-stage-change.js**
   - Added status update logic after stage confirmation (lines 164-186)
   - Imports and error handling already in place

---

## Maintenance

### Updating Mappings

To change a mapping:

```sql
UPDATE stage_status_mappings
SET matter_status = 'Closed'
WHERE stage_name = 'I/V MEETING';
```

### Deactivating a Mapping

To disable a mapping without deleting:

```sql
UPDATE stage_status_mappings
SET active = false
WHERE stage_name = 'I/V MEETING';
```

### Viewing All Mappings

```sql
SELECT stage_name, matter_status, active, updated_at
FROM stage_status_mappings
ORDER BY stage_name;
```

---

## Benefits

✅ **Consistency** - Matter statuses automatically reflect current workflow stage
✅ **Accuracy** - Reduces manual status update errors
✅ **Visibility** - Improves reporting and filtering by matter status
✅ **Flexibility** - Easy to add/modify mappings via database
✅ **Reliability** - Failure-safe design doesn't block task generation

---

## Next Steps

1. Run the SQL migration in Supabase Dashboard
2. Deploy updated code to production
3. Test with a sample matter stage change
4. Add additional stage-status mappings as needed
5. Monitor logs for any status update errors

---

**Questions?** Check the implementation in:
- `src/automations/matter-stage-change.js` (lines 164-186)
- `src/services/supabase.js` (lines 640-654)
- `src/services/clio.js` (lines 101-111)
