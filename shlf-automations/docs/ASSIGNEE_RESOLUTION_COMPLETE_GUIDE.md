# COMPLETE ASSIGNEE RESOLUTION DOCUMENTATION

## 📊 SUPABASE TABLE STRUCTURES

### 1. `assigned_user_reference` Table
**Purpose:** Lookup table for CSC, PARALEGAL, and FUND TABLE assignments

**Columns:**
```
- id (bigint)                    - Clio user ID
- name (text)                    - User display name
- location (text[])              - Array of office locations
- attorney_id (bigint[])         - Array of attorney IDs this person supports
- attorney_name (text)           - Attorney names (comma-separated)
- fund_table (bigint[])          - Array of fund table IDs
```

**Sample Data:**
```json
{
  "id": 357378916,
  "name": "Mackenzie McTevia",
  "location": ["SHLF Bonita Springs", "Bonita springs"],
  "attorney_id": ["0"],
  "attorney_name": "n/a",
  "fund_table": null
}
```

### 2. `task-list-non-meeting` Table
**Purpose:** Task templates for non-meeting-based stages (Estate Planning)

**Assignee Columns:**
```
- assignee (text)               - Template placeholder or user name
- assignee_id (text)            - Either numeric ID or placeholder keyword
```

**Assignee Values:**
| assignee | assignee_id | Meaning |
|----------|-------------|---------|
| ATTORNEY | "attorney" or "attorney_id" | Resolve to matter's originating_attorney |
| CSC | "location" | Resolve CSC by matter's location |
| FUNDING | "357378676" | Direct assignment to user 357378676 |
| Kelly | "357168768" | Direct assignment to user 357168768 |
| VA | "357379471" | Direct assignment to user 357379471 (Jacqui) |

**Key Insight:** `assignee_id` contains **placeholders** like "attorney", "location", NOT actual IDs (except for specific users)

### 3. `task-list-probate` Table
**Purpose:** Task templates for probate cases

**Assignee Columns:**
```
- assignee (text)               - User name (lowercase)
- assignee_id (bigint)          - Actual Clio user ID (numeric)
```

**Assignee Values:**
| assignee | assignee_id | User Name |
|----------|-------------|-----------|
| jacqui | 357379471 | Jacqui |
| jessica | 357379201 | Jessica Maristany |
| kelly | 357168768 | Kelly |
| peggy | 357863197 | Peggy |
| tom | 357387241 | Tom LaTorre |

**Key Insight:** All probate templates have **numeric assignee_id** for direct assignment

### 4. `task-list-meeting` Table
**Purpose:** Task templates for meeting-based events

**Assignee Column:**
```
- assignee (text)               - CSC or VA (no assignee_id column)
```

**Assignee Values:**
- `CSC` - Resolve by meeting location
- `VA` - Hardcoded to 357379471 (Jacqui)

---

## 🔄 COMPLETE ASSIGNEE RESOLUTION FLOW

### INPUT: `template` object from Supabase

### STEP 1: Determine Resolution Strategy

```javascript
const assigneeValue = template.assignee_id || template.assignee;
```

**Decision Tree:**

```
├─ Is assignee_id numeric (integer)?
│  ├─ YES → Use assignee_id directly (PROBATE CASE)
│  └─ NO → Check assignee field
│
├─ assignee === "ATTORNEY"?
│  └─ YES → Resolve from matter.originating_attorney
│
├─ assignee === "CSC"?
│  └─ YES → Resolve by location lookup in assigned_user_reference
│
├─ assignee === "PARALEGAL"?
│  └─ YES → Resolve by attorney_id lookup in assigned_user_reference
│
├─ assignee === "FUNDING"?
│  └─ YES → Check if assignee_id is numeric, else lookup in fund_table
│
├─ assignee === "VA"?
│  └─ YES → Check if assignee_id is numeric (357379471), else throw error
│
└─ Is assignee numeric?
   ├─ YES → Use as direct ID
   └─ NO → THROW ERROR
```

---

## 🎯 RESOLUTION METHODS

### Method 1: ATTORNEY
**Trigger:** `assignee === "ATTORNEY"`

**Source:** Matter data from Clio webhook

**Logic:**
```javascript
const attorney = matterData.originating_attorney;
// Returns: { id: 357387241, name: "Tom LaTorre" }
```

**Return:**
```javascript
{
  id: attorney.id,
  name: attorney.name,
  type: 'User'
}
```

**Can Fail:** Yes - if matter has no originating_attorney

---

### Method 2: CSC (Client Service Coordinator)
**Trigger:** `assignee === "CSC"`

**Source:** `assigned_user_reference` table

**Query:**
```sql
SELECT * FROM assigned_user_reference
WHERE location @> ARRAY['Main Office']::text[]
```

**Logic:**
```javascript
const location = meetingLocation || matterData.location;
const assignee = await SupabaseService.getAssigneeByLocation(location);
// Returns: { id: 357378916, name: "Mackenzie McTevia", location: [...] }
```

**Return:**
```javascript
{
  id: assignee.id,
  name: assignee.name,
  type: 'User'
}
```

**Can Fail:** Yes - if no CSC found for location

---

### Method 3: PARALEGAL
**Trigger:** `assignee === "PARALEGAL"`

**Source:** `assigned_user_reference` table

**Query:**
```sql
SELECT * FROM assigned_user_reference
WHERE attorney_id @> ARRAY[357387241]::bigint[]
```

**Logic:**
```javascript
const attorneyId = matterData.originating_attorney?.id;
const assignee = await SupabaseService.getAssigneeByAttorneyId(attorneyId);
// Returns: { id: 357168768, name: "Kelly", attorney_id: [357387241, ...] }
```

**Return:**
```javascript
{
  id: assignee.id,
  name: assignee.name,
  type: 'User'
}
```

**Can Fail:** Yes - if no paralegal found for attorney

---

### Method 4: FUND TABLE
**Trigger:** `assignee === "FUNDING"` or `type === 'FUND TABLE'`

**Source:** `assigned_user_reference` table

**Query:**
```sql
SELECT * FROM assigned_user_reference
WHERE fund_table @> ARRAY[357380836]::bigint[]
```

**Logic:**
```javascript
const fundTableId = matterData.fund_table_id;
const assignee = await SupabaseService.getAssigneeByFundTable(fundTableId);
// Returns: { id: 357379471, name: "Jacqui", fund_table: [...] }
```

**Return:**
```javascript
{
  id: assignee.id,
  name: assignee.name,
  type: 'User'
}
```

**Can Fail:** Yes - if no user found for fund table

---

### Method 5: VA (Virtual Assistant)
**Trigger:** `assignee === "VA"`

**Source:** Template's `assignee_id` field

**Logic:**
```javascript
// Non-meeting templates: assignee_id = "357379471"
if (template.assignee_id && !isNaN(template.assignee_id)) {
  return {
    id: parseInt(template.assignee_id),
    name: 'Direct Assignment',
    type: 'User'
  };
}

// Meeting templates: No assignee_id, hardcode to 357379471
if (assignee === 'VA') {
  return {
    id: 357379471,
    name: 'Jacqui',
    type: 'User'
  };
}
```

**Return:**
```javascript
{
  id: 357379471,
  name: 'Jacqui',
  type: 'User'
}
```

**Can Fail:** No - hardcoded

---

### Method 6: Direct Numeric ID
**Trigger:** `assignee_id` is numeric (probate templates)

**Source:** Template's `assignee_id` field

**Logic:**
```javascript
const id = parseInt(template.assignee_id);
return {
  id: id,
  name: 'Direct Assignment',
  type: 'User'
};
```

**Return:**
```javascript
{
  id: 357379201,
  name: 'Direct Assignment',
  type: 'User'
}
```

**Can Fail:** No - assumes ID is valid in Clio

---

## ❌ ERROR HANDLING

### When Resolution Fails

**Create Error Task:**
```javascript
{
  name: "⚠️ Assignment Error - Matter-123",
  description: "Unable to generate tasks for stage. <error message>",
  matter: { id: 1675950832 },
  assignee: {
    id: matterData.originating_attorney.id,
    type: 'User'
  },
  due_at: "2025-10-02T...",
  priority: "high"
}
```

**Behavior:**
- Logs error
- Creates error task assigned to attorney
- Continues to next task (doesn't abort entire workflow)

---

## 🔧 CURRENT BUG

### Issue: "Invalid assignee: 'location'"

**Root Cause:**
Current code does:
```javascript
const assigneeValue = template.assignee_id || template.assignee;
assignee = await resolveAssignee(assigneeValue, matterDetails);
```

When `assignee = "CSC"` and `assignee_id = "location"`:
- Code uses `assignee_id` first ("location")
- Tries to resolve "location" as if it's a value
- Fails because "location" is not ATTORNEY, CSC, PARALEGAL, or numeric

**Correct Logic:**
```javascript
// Priority order:
// 1. If assignee_id is numeric → use directly
// 2. Otherwise → resolve based on assignee field
// 3. Never use assignee_id as a value (it's a placeholder keyword)

let assigneeValue;
if (template.assignee_id && !isNaN(template.assignee_id)) {
  // Probate case: numeric assignee_id
  assigneeValue = template.assignee_id;
} else {
  // Non-meeting case: use assignee field (ATTORNEY, CSC, VA, etc.)
  assigneeValue = template.assignee;
}

assignee = await resolveAssignee(assigneeValue, matterDetails);
```

---

## ✅ CORRECT IMPLEMENTATION

### Updated Logic:

```javascript
// In matter-stage-change.js
let assignee;
try {
  // Step 1: Determine which value to use
  let assigneeValue;

  if (template.assignee_id && typeof template.assignee_id === 'number') {
    // Probate templates: numeric assignee_id
    assigneeValue = template.assignee_id;
  } else if (template.assignee_id && !isNaN(String(template.assignee_id).trim())) {
    // Non-meeting templates: assignee_id might be string number
    assigneeValue = String(template.assignee_id).trim();
  } else {
    // Use assignee field for keyword resolution
    assigneeValue = template.assignee;
  }

  // Step 2: Resolve the assignee
  assignee = await resolveAssignee(assigneeValue, matterDetails);

} catch (assigneeError) {
  // Create error task assigned to attorney
  console.error(`[MATTER] ${matterId} Assignee error: ${assigneeError.message}`);
  const errorTask = createAssigneeErrorTask(matterDetails, stageId, assigneeError.message);
  await ClioService.createTask(errorTask);
  continue; // Skip this task
}
```

### In assignee-resolver.js:

```javascript
export async function resolveAssignee(assigneeType, matterData, meetingLocation = null) {
  const type = assigneeType?.toString().toUpperCase().trim();

  try {
    // ATTORNEY - use matter's attorney
    if (type === 'ATTORNEY') {
      const attorney = matterData.originating_attorney;
      if (!attorney) {
        throw new Error(`No attorney assigned to matter: ${matterData.id}`);
      }
      return { id: attorney.id, name: attorney.name, type: 'User' };
    }

    // CSC - resolve by location
    if (type === 'CSC') {
      const location = meetingLocation || matterData.location;
      if (!location) {
        throw new Error(`No location found for CSC assignment. Matter: ${matterData.id}`);
      }
      const assignee = await SupabaseService.getAssigneeByLocation(location);
      if (!assignee) {
        throw new Error(`No CSC found for location: ${location}`);
      }
      return { id: assignee.id, name: assignee.name, type: 'User' };
    }

    // PARALEGAL - resolve by attorney_id
    if (type === 'PARALEGAL') {
      const attorneyId = matterData.originating_attorney?.id || matterData.attorney_id;
      if (!attorneyId) {
        throw new Error(`No attorney found for PARALEGAL assignment. Matter: ${matterData.id}`);
      }
      const assignee = await SupabaseService.getAssigneeByAttorneyId(attorneyId);
      if (!assignee) {
        throw new Error(`No PARALEGAL found for attorney ID: ${attorneyId}`);
      }
      return { id: assignee.id, name: assignee.name, type: 'User' };
    }

    // FUND TABLE - resolve by fund_table_id
    if (type === 'FUND TABLE' || type === 'FUNDING') {
      const fundTableId = matterData.fund_table_id;
      if (!fundTableId) {
        throw new Error(`No fund table found for matter: ${matterData.id}`);
      }
      const assignee = await SupabaseService.getAssigneeByFundTable(fundTableId);
      if (!assignee) {
        throw new Error(`No assignee found for fund table: ${fundTableId}`);
      }
      return { id: assignee.id, name: assignee.name, type: 'User' };
    }

    // VA - hardcoded ID
    if (type === 'VA') {
      return { id: 357379471, name: 'Jacqui', type: 'User' };
    }

    // Direct numeric ID
    if (!isNaN(assigneeType)) {
      return {
        id: parseInt(assigneeType),
        name: 'Direct Assignment',
        type: 'User'
      };
    }

    // Invalid assignee
    throw new Error(`Invalid assignee type: "${assigneeType}". Must be ATTORNEY, CSC, PARALEGAL, FUND TABLE, VA, or numeric ID.`);

  } catch (error) {
    console.error('Error resolving assignee:', error.message);
    throw error;
  }
}
```

---

## 📋 VALIDATION MATRIX

| Template Type | assignee | assignee_id | Resolution Method | Final ID |
|---------------|----------|-------------|-------------------|----------|
| Non-Meeting | ATTORNEY | "attorney" | Matter attorney | Varies |
| Non-Meeting | CSC | "location" | Location lookup | Varies |
| Non-Meeting | FUNDING | "357378676" | Direct numeric | 357378676 |
| Non-Meeting | Kelly | "357168768" | Direct numeric | 357168768 |
| Non-Meeting | VA | "357379471" | Direct numeric | 357379471 |
| Probate | jacqui | 357379471 | Direct numeric | 357379471 |
| Probate | jessica | 357379201 | Direct numeric | 357379201 |
| Probate | kelly | 357168768 | Direct numeric | 357168768 |
| Meeting | CSC | (no column) | Location lookup | Varies |
| Meeting | VA | (no column) | Hardcoded | 357379471 |

---

## 🎯 KEY RULES

1. **Never use `assignee_id` as a value** when it's "attorney", "location", or other placeholder keywords
2. **Always check if `assignee_id` is numeric first** - if yes, use directly
3. **Fall back to `assignee` field** for keyword-based resolution (ATTORNEY, CSC, etc.)
4. **All assignees are type: 'User'** - never "Contact"
5. **VA is always user 357379471** (Jacqui)
6. **Error tasks assigned to attorney** - never left unassigned

---

## 🐛 BUGS TO FIX

1. ❌ Using `assignee_id` when it's "location" placeholder
2. ❌ Not checking if `assignee_id` is numeric before using
3. ❌ VA in meeting templates not handled (no assignee_id column)

---

## ✅ NEXT STEPS

1. Fix logic to check if `assignee_id` is numeric before using
2. Use `assignee` field for all keyword-based resolution
3. Hardcode VA to 357379471 when assignee = "VA" and no numeric assignee_id
4. Test all template types (non-meeting, probate, meeting)
5. Validate with actual stage change on matter 1675950832
