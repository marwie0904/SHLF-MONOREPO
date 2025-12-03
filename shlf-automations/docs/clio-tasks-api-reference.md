# Clio Tasks API Reference

A comprehensive guide for retrieving and managing tasks in Clio, with focus on querying tasks by assignee.

---

## Table of Contents
1. [Authentication](#authentication)
2. [Base Configuration](#base-configuration)
3. [API Endpoints](#api-endpoints)
4. [Querying Tasks by Assignee](#querying-tasks-by-assignee)
5. [Task Fields](#task-fields)
6. [Common Query Parameters](#common-query-parameters)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Rate Limits & Best Practices](#rate-limits--best-practices)

---

## Authentication

### Access Token
Clio uses OAuth 2.0 Bearer token authentication. All API requests must include an Authorization header.

**Environment Variables Required:**
```bash
CLIO_API_BASE_URL=https://app.clio.com
CLIO_ACCESS_TOKEN=your_access_token_here
CLIO_REFRESH_TOKEN=your_refresh_token_here  # For automatic token refresh
CLIO_CLIENT_ID=your_oauth_client_id
CLIO_CLIENT_SECRET=your_oauth_client_secret
```

### Getting an Access Token

**Method 1: OAuth Flow (Recommended)**
1. Create an OAuth application in Clio: https://app.clio.com/settings/developer_applications
2. Implement OAuth 2.0 authorization code flow
3. Exchange authorization code for access token
4. Store both access_token and refresh_token securely

**Method 2: Manual (Development Only)**
1. Log into Clio Developer Console: https://app.clio.com/settings/developer_applications
2. Navigate to your application
3. Generate a test access token (expires in 7 days)
4. Add to `.env` file

### Token Refresh
Access tokens expire after **7 days (604,800 seconds)**. Use the refresh token to obtain a new access token:

```bash
POST https://app.clio.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=YOUR_REFRESH_TOKEN
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
```

**Response:**
```json
{
  "access_token": "new_access_token_here",
  "refresh_token": "new_refresh_token_here",
  "expires_in": 604800,
  "token_type": "Bearer"
}
```

---

## Base Configuration

### Axios Client Setup
```javascript
import axios from 'axios';

const clioClient = axios.create({
  baseURL: 'https://app.clio.com',
  headers: {
    'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
});
```

### Request Headers
```
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
```

---

## API Endpoints

### Tasks Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v4/tasks` | List all tasks (with filters) |
| GET | `/api/v4/tasks/{id}` | Get a single task by ID |
| POST | `/api/v4/tasks` | Create a new task |
| PATCH | `/api/v4/tasks/{id}` | Update a task |
| DELETE | `/api/v4/tasks/{id}` | Delete a task |

---

## Querying Tasks by Assignee

### Endpoint
```
GET https://app.clio.com/api/v4/tasks
```

### Query Parameters for Assignee Filtering

**Primary Parameter:**
- `assignee_id` - Filter tasks by the Clio user ID assigned to the task

**Example URL:**
```
GET /api/v4/tasks?assignee_id=357168768&status=pending&fields=id,name,assignee{id,name},due_at,status
```

### Complete Request Example

```javascript
const response = await clioClient.get('/api/v4/tasks', {
  params: {
    assignee_id: 357168768,           // The Clio user ID
    status: 'pending',                 // Optional: filter by status
    fields: 'id,name,description,status,assignee{id,name},matter{id,display_number},due_at',
  },
});

const tasks = response.data.data;  // Array of task objects
```

### Understanding the Response

**Single GET request** returns **ALL matching tasks** - it counts as **1 API request** regardless of result count.

```json
{
  "data": [
    {
      "id": 12345678,
      "name": "Review documents",
      "description": "Review client intake forms",
      "status": "pending",
      "assignee": {
        "id": 357168768,
        "name": "John Smith"
      },
      "matter": {
        "id": 1675950832,
        "display_number": "00001-Smith"
      },
      "due_at": "2025-11-20T17:00:00.000-05:00"
    },
    {
      "id": 12345679,
      "name": "File motion",
      "status": "pending",
      "assignee": {
        "id": 357168768,
        "name": "John Smith"
      },
      "due_at": "2025-11-25T12:00:00.000-05:00"
    }
  ],
  "meta": {
    "paging": {
      "total_records": 2
    }
  }
}
```

---

## Task Fields

### Available Fields
Use the `fields` parameter to specify which fields to return. Reduces response size and improves performance.

**Common Task Fields:**
```
id                  - Unique task identifier
name                - Task name/title
description         - Task description
status              - pending, completed, cancelled
priority            - high, normal, low
due_at              - ISO 8601 datetime
created_at          - ISO 8601 datetime
updated_at          - ISO 8601 datetime
```

**Related Object Fields (use dot notation):**
```
assignee            - User assigned to task
  assignee{id}            - Assignee's Clio user ID
  assignee{name}          - Assignee's full name
  assignee{email}         - Assignee's email

matter              - Associated matter
  matter{id}              - Matter ID
  matter{display_number}  - Matter display number
  matter{description}     - Matter description

created_by          - User who created the task
  created_by{id}
  created_by{name}
```

### Field Selection Examples

**Minimal (fast):**
```
fields=id,name,status
```

**With assignee details:**
```
fields=id,name,status,assignee{id,name,email}
```

**Complete task info:**
```
fields=id,name,description,status,priority,due_at,assignee{id,name},matter{id,display_number},created_at,updated_at
```

---

## Common Query Parameters

### Filtering Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `assignee_id` | integer | Filter by assignee user ID | `357168768` |
| `matter_id` | integer | Filter by matter ID | `1675950832` |
| `status` | string | Filter by status | `pending`, `completed`, `cancelled` |
| `priority` | string | Filter by priority | `high`, `normal`, `low` |
| `created_since` | ISO 8601 | Tasks created after date | `2025-11-01T00:00:00Z` |
| `updated_since` | ISO 8601 | Tasks updated after date | `2025-11-01T00:00:00Z` |
| `due_start` | ISO 8601 | Due date range start | `2025-11-01T00:00:00Z` |
| `due_end` | ISO 8601 | Due date range end | `2025-11-30T23:59:59Z` |

### Pagination Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | integer | Results per page | 50 |
| `offset` | integer | Skip N results | 0 |
| `order` | string | Sort field | `due_at(asc)` |

### Example with Multiple Filters
```javascript
{
  params: {
    assignee_id: 357168768,
    status: 'pending',
    priority: 'high',
    due_start: '2025-11-13T00:00:00Z',
    due_end: '2025-11-20T23:59:59Z',
    order: 'due_at(asc)',
    fields: 'id,name,assignee{name},due_at',
  }
}
```

---

## Code Examples

### Example 1: Get All Pending Tasks for an Assignee

```javascript
import axios from 'axios';

const CLIO_API_BASE_URL = 'https://app.clio.com';
const CLIO_ACCESS_TOKEN = process.env.CLIO_ACCESS_TOKEN;

const clioClient = axios.create({
  baseURL: CLIO_API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${CLIO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

async function getPendingTasksByAssignee(assigneeId) {
  try {
    const response = await clioClient.get('/api/v4/tasks', {
      params: {
        assignee_id: assigneeId,
        status: 'pending',
        fields: 'id,name,description,assignee{id,name},due_at,matter{id,display_number}',
      },
    });

    const tasks = response.data.data;
    console.log(`Found ${tasks.length} pending tasks for assignee ${assigneeId}`);

    return tasks;
  } catch (error) {
    console.error('Error fetching tasks:', error.response?.data || error.message);
    throw error;
  }
}

// Usage
const assigneeId = 357168768;
const tasks = await getPendingTasksByAssignee(assigneeId);
```

### Example 2: Get Tasks Due This Week

```javascript
async function getTasksDueThisWeek(assigneeId) {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const response = await clioClient.get('/api/v4/tasks', {
    params: {
      assignee_id: assigneeId,
      status: 'pending',
      due_start: now.toISOString(),
      due_end: weekFromNow.toISOString(),
      order: 'due_at(asc)',
      fields: 'id,name,assignee{name},due_at,priority',
    },
  });

  return response.data.data;
}
```

### Example 3: Get Single Task Details

```javascript
async function getTaskDetails(taskId) {
  const response = await clioClient.get(`/api/v4/tasks/${taskId}`, {
    params: {
      fields: 'id,name,description,status,assignee{id,name},matter{id,display_number},due_at',
    },
  });

  return response.data.data;
}
```

### Example 4: Get All Tasks for a Matter

```javascript
async function getTasksByMatter(matterId) {
  const response = await clioClient.get('/api/v4/tasks', {
    params: {
      matter_id: matterId,
      fields: 'id,name,description,status,assignee{id,name},due_at',
    },
  });

  return response.data.data;
}
```

### Example 5: Create a Task

```javascript
async function createTask(taskData) {
  const response = await clioClient.post('/api/v4/tasks', {
    data: {
      name: taskData.name,
      description: taskData.description,
      status: 'pending',
      assignee: { id: taskData.assigneeId },
      matter: { id: taskData.matterId },
      due_at: taskData.dueDate,
      priority: taskData.priority || 'normal',
    },
  }, {
    params: {
      fields: 'id,name,assignee{name},due_at',
    },
  });

  return response.data.data;
}

// Usage
const newTask = await createTask({
  name: 'Review contract',
  description: 'Review and approve client contract',
  assigneeId: 357168768,
  matterId: 1675950832,
  dueDate: '2025-11-20T17:00:00-05:00',
  priority: 'high',
});
```

### Example 6: Update a Task

```javascript
async function updateTask(taskId, updates) {
  const response = await clioClient.patch(`/api/v4/tasks/${taskId}`, {
    data: updates,
  });

  return response.data.data;
}

// Usage - Mark task as completed
await updateTask(12345678, { status: 'completed' });

// Usage - Change assignee
await updateTask(12345678, { assignee: { id: 357168999 } });

// Usage - Update due date
await updateTask(12345678, { due_at: '2025-11-25T17:00:00-05:00' });
```

### Example 7: Delete a Task

```javascript
async function deleteTask(taskId) {
  await clioClient.delete(`/api/v4/tasks/${taskId}`);
  console.log(`Task ${taskId} deleted successfully`);
}
```

---

## Error Handling

### Common HTTP Status Codes

| Code | Meaning | Common Cause |
|------|---------|--------------|
| 200 | Success | Request completed successfully |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid parameters or missing required fields |
| 401 | Unauthorized | Invalid or expired access token |
| 404 | Not Found | Task ID doesn't exist |
| 422 | Unprocessable Entity | Validation errors (e.g., invalid assignee_id) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Clio internal error |

### Error Response Format

```json
{
  "errors": [
    {
      "error": "Validation error message",
      "field": "assignee_id"
    }
  ]
}
```

### Error Handling Pattern

```javascript
async function safeGetTasks(assigneeId) {
  try {
    const response = await clioClient.get('/api/v4/tasks', {
      params: {
        assignee_id: assigneeId,
        status: 'pending',
        fields: 'id,name,assignee{name}',
      },
    });

    return { success: true, data: response.data.data };

  } catch (error) {
    // Handle 401 - Token expired
    if (error.response?.status === 401) {
      console.error('Access token expired. Refresh token required.');
      // Trigger token refresh logic
      return { success: false, error: 'UNAUTHORIZED' };
    }

    // Handle 404 - Not found
    if (error.response?.status === 404) {
      console.error('Resource not found');
      return { success: false, error: 'NOT_FOUND' };
    }

    // Handle 429 - Rate limit
    if (error.response?.status === 429) {
      console.error('Rate limit exceeded. Retry after delay.');
      return { success: false, error: 'RATE_LIMIT' };
    }

    // Generic error handling
    console.error('Error fetching tasks:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return { success: false, error: 'UNKNOWN_ERROR' };
  }
}
```

### Handling 404 on Task Retrieval

When a task is deleted in Clio, GET requests will return 404:

```javascript
async function getTaskIfExists(taskId) {
  try {
    const task = await clioClient.get(`/api/v4/tasks/${taskId}`);
    return { exists: true, task: task.data.data };
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`Task ${taskId} not found - may have been deleted`);
      return { exists: false, task: null };
    }
    throw error;
  }
}
```

---

## Rate Limits & Best Practices

### Rate Limits
- Clio imposes rate limits on API requests
- Exact limits vary by plan and endpoint
- Monitor `X-RateLimit-*` headers in responses:
  - `X-RateLimit-Limit`: Total requests allowed
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: Timestamp when limit resets

### Best Practices

**1. Use Field Selection**
Only request fields you need to reduce response size and improve performance:
```javascript
// ❌ Bad - returns all fields
fields: '*'

// ✅ Good - returns only needed fields
fields: 'id,name,assignee{name},due_at'
```

**2. Batch Queries When Possible**
Instead of fetching tasks one-by-one, use filters to get multiple at once:
```javascript
// ❌ Bad - multiple requests
for (const assigneeId of assigneeIds) {
  await getTasks(assigneeId);  // N requests
}

// ✅ Better - but Clio doesn't support multiple assignee_id values
// So query all tasks and filter in code if needed
const allTasks = await getTasks();
const filtered = allTasks.filter(t => assigneeIds.includes(t.assignee.id));
```

**3. Cache Task Data**
Cache frequently accessed task data locally to reduce API calls:
```javascript
const taskCache = new Map();

async function getCachedTask(taskId) {
  if (taskCache.has(taskId)) {
    return taskCache.get(taskId);
  }

  const task = await getTaskDetails(taskId);
  taskCache.set(taskId, task);

  return task;
}
```

**4. Handle Token Expiration Gracefully**
Implement automatic token refresh on 401 errors:
```javascript
// Use axios interceptors to automatically refresh tokens
clioClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;

      // Refresh token
      const newToken = await refreshAccessToken();

      // Retry with new token
      error.config.headers['Authorization'] = `Bearer ${newToken}`;
      return clioClient(error.config);
    }

    return Promise.reject(error);
  }
);
```

**5. Use Pagination for Large Result Sets**
```javascript
async function getAllTasksPaginated(assigneeId) {
  const allTasks = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await clioClient.get('/api/v4/tasks', {
      params: {
        assignee_id: assigneeId,
        limit,
        offset,
        fields: 'id,name',
      },
    });

    const tasks = response.data.data;
    allTasks.push(...tasks);

    if (tasks.length < limit) break;  // No more results
    offset += limit;
  }

  return allTasks;
}
```

**6. Log API Requests in Development**
```javascript
clioClient.interceptors.request.use((config) => {
  console.log(`[CLIO] ${config.method.toUpperCase()} ${config.url}`);
  console.log('  Params:', config.params);
  return config;
});
```

---

## Summary

### Quick Reference Card

**Get all pending tasks for assignee:**
```javascript
GET /api/v4/tasks?assignee_id=357168768&status=pending
```

**Get task details:**
```javascript
GET /api/v4/tasks/{taskId}?fields=id,name,assignee{name},due_at
```

**Get tasks for matter:**
```javascript
GET /api/v4/tasks?matter_id=1675950832
```

**Create task:**
```javascript
POST /api/v4/tasks
Body: { data: { name, description, assignee: { id }, matter: { id }, due_at } }
```

**Update task:**
```javascript
PATCH /api/v4/tasks/{taskId}
Body: { data: { status: 'completed' } }
```

**Delete task:**
```javascript
DELETE /api/v4/tasks/{taskId}
```

---

## Additional Resources

- **Clio API Documentation:** https://app.clio.com/api/v4/documentation
- **Clio Developer Portal:** https://app.clio.com/settings/developer_applications
- **OAuth 2.0 Spec:** https://oauth.net/2/

---

*Last Updated: 2025-11-13*
