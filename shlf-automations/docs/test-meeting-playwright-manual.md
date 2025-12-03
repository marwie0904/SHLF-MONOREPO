# Meeting-Based Task Automation Test (Playwright Manual Steps)

This guide walks through testing meeting-based task generation using Playwright MCP tools.

## Test: Naples + Initial Meeting

### Step 1: Clean up and create calendar event

```bash
node cleanup-test-matter.js
```

Then create the calendar event via test script or manually via Clio API.

### Step 2: Wait for automation

Wait 30 seconds for the webhook automation to trigger and generate tasks.

### Step 3: Login to Clio via Playwright

Execute these Playwright MCP tool calls in sequence:

**1. Navigate to login page:**
```
mcp__playwright__browser_navigate
url: https://app.clio.com/nc/#/matters/1675950832/tasks
```

**2. Enter email:**
```
mcp__playwright__browser_type
element: Email textbox
ref: [from snapshot]
text: gabby@safeharborlawfirm.com
```

**3. Click Next:**
```
mcp__playwright__browser_click
element: Next: Password button
ref: [from snapshot]
```

**4. Enter password:**
```
mcp__playwright__browser_type
element: Password textbox
ref: [from snapshot]
text: Gabby@2025!SHLF
```

**5. Click Sign In:**
```
mcp__playwright__browser_click
element: Sign In button
ref: [from snapshot]
```

**6. Wait for page load:**
```
mcp__playwright__browser_wait_for
time: 5
```

### Step 4: Take screenshot

```
mcp__playwright__browser_take_screenshot
filename: .playwright-screenshots/meeting-based-tasks/Naples/Initial/1675950832-naples-kelly-initial-tasks.png
fullPage: true
```

### Step 5: Test dependencies (if applicable)

**1. Get dependency chain from Supabase:**

Query Supabase `tasks` table for tasks with `due_date_relation` containing "after task X".

**2. For each dependent task:**

a. Complete the parent task:
```javascript
await ClioService.updateTask(parentTaskId, { status: 'complete' });
```

b. Wait 20 seconds

c. Login via Playwright (repeat Step 3)

d. Take screenshot:
```
mcp__playwright__browser_take_screenshot
filename: .playwright-screenshots/meeting-based-tasks/Naples/Initial/1675950832-naples-kelly-initial-completed-task-1.png
fullPage: true
```

## Screenshot Folder Structure

```
.playwright-screenshots/
└── meeting-based-tasks/
    ├── Bonita Springs/
    │   ├── Initial/
    │   ├── Vision/
    │   ├── Design/
    │   ├── Signing/
    │   └── Maintenance/
    ├── Fort Myers/
    │   ├── Initial/
    │   ├── Vision/
    │   ├── Design/
    │   ├── Signing/
    │   └── Maintenance/
    └── Naples/
        ├── Initial/
        ├── Vision/
        ├── Design/
        ├── Signing/
        └── Maintenance/
```

## Screenshot Naming Convention

- Initial generation: `{matterId}-{location}-{attorney}-{meeting}-tasks.png`
  - Example: `1675950832-naples-kelly-initial-tasks.png`

- After task completion: `{matterId}-{location}-{attorney}-{meeting}-completed-task-{number}.png`
  - Example: `1675950832-naples-kelly-initial-completed-task-1.png`

## Meeting Configurations

| Meeting | Calendar Event ID | Stage ID |
|---------|------------------|----------|
| Initial | 334844 | 828076 |
| Vision | 334846 | 828078 |
| Design | 334848 | 828080 |
| Signing | 334850 | 828082 |
| Maintenance | 334852 | 828084 |

## Location Configurations

| Location | Location ID | Attorney |
|----------|-------------|----------|
| Naples | 334837 | kelly |
| Bonita Springs | 334835 | jacqui |
| Fort Myers | 334836 | jacqui |
