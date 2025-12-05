import { useState, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../convex/_generated/api'
import { format } from 'date-fns'

function formatDuration(ms) {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(2)}m`
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  return format(new Date(timestamp), 'MMM dd, yyyy HH:mm:ss')
}

function formatTimeRange(start, end) {
  if (!start) return '-'
  const startTime = format(new Date(start), 'HH:mm:ss')
  const endTime = end ? format(new Date(end), 'HH:mm:ss') : 'ongoing'
  return `${startTime} - ${endTime}`
}

// Determine effective status based on status field and resultAction
function getEffectiveStatus(trace) {
  const status = trace.status
  const resultAction = trace.resultAction?.toLowerCase() || ''

  // If resultAction contains skip indicators, show as skipped
  if (resultAction.includes('skipped') || resultAction.includes('skip') ||
      resultAction === 'already_processed' || resultAction === 'still_processing' ||
      resultAction === 'no_action' || resultAction === 'ignored') {
    return 'skipped'
  }

  // If resultAction contains error indicators, override to error
  if (resultAction === 'error' || resultAction.includes('error') || resultAction.includes('failed')) {
    return 'error'
  }

  // If status is success but errorMessage exists, it's an error
  if (trace.errorMessage) {
    return 'error'
  }

  // If trace status is "started" but has a successful resultAction, infer "completed"
  // This handles cases where trace completion didn't fire properly
  if (status === 'started' && resultAction) {
    if (resultAction.includes('invoice_created') || resultAction.includes('invoice_updated') ||
        resultAction.includes('tasks_created') || resultAction.includes('success') ||
        resultAction === 'self_update_skipped' || resultAction === 'forwarded') {
      return 'completed'
    }
  }

  // If trace has stepCount > 0 and status is still "started", likely completed
  if (status === 'started' && trace.stepCount > 0 && trace.durationMs) {
    return 'completed'
  }

  return status
}

/**
 * Get display trigger name for GHL traces
 * Maps generic custom-object endpoints to specific invoice triggers when applicable
 *
 * The key insight: GHL sends ALL custom object events to the same webhook URL,
 * but the `type` field in the request body tells us the actual event type:
 * - "RecordCreate" -> created
 * - "RecordUpdate" -> updated
 * - "RecordDelete" -> deleted
 */
function getGHLTriggerDisplayName(trace) {
  const endpoint = trace?.endpoint || ''
  let endpointName = endpoint.split('/').pop() || endpoint

  // PRIMARY: Check the `type` field in requestBody - this is the most reliable indicator
  const eventType = trace?.requestBody?.type || ''
  if (eventType === 'RecordUpdate') {
    endpointName = 'custom-object-updated'
  } else if (eventType === 'RecordDelete') {
    endpointName = 'custom-object-deleted'
  } else if (eventType === 'RecordCreate') {
    endpointName = 'custom-object-created'
  }

  // FALLBACK: Check resultAction/responseBody for forwarded requests (legacy)
  const resultAction = trace?.resultAction?.toLowerCase() || ''
  const responseAction = trace?.responseBody?.action?.toLowerCase() || ''
  if (endpointName === 'custom-object-created') {
    if (resultAction.includes('invoice_updated') || responseAction.includes('invoice_updated') ||
        resultAction === 'forwarded' || resultAction.includes('update')) {
      endpointName = 'custom-object-updated'
    } else if (resultAction.includes('deleted') || responseAction.includes('deleted')) {
      endpointName = 'custom-object-deleted'
    }
  }

  // Check if this is an invoice-related trace by looking at objectKey in requestBody
  const objectKey = trace?.requestBody?.objectKey || trace?.requestBody?.schemaKey || ''
  const isInvoice = objectKey === 'custom_objects.invoices'

  // Map custom-object endpoints to invoice-specific names when applicable
  if (isInvoice) {
    if (endpointName === 'custom-object-created') return 'invoice-created'
    if (endpointName === 'custom-object-updated') return 'invoice-updated'
    if (endpointName === 'custom-object-deleted') return 'invoice-deleted'
  }

  return endpointName
}

// Get skip reason from resultAction
function getSkipReason(resultAction) {
  if (!resultAction) return null
  const action = resultAction.toLowerCase()

  const reasons = {
    'skipped_test_mode': 'Test mode filter',
    'skipped_not_completed': 'Task not completed',
    'skipped_already_processed': 'Already processed',
    'already_processed': 'Already processed',
    'still_processing': 'Still processing',
    'skipped_no_stage': 'No stage found',
    'skipped_unknown_event': 'Unknown event type',
    'no_action': 'No action needed',
    'ignored': 'Ignored',
  }

  return reasons[action] || (action.includes('skip') ? resultAction : null)
}

export default function TracesPage() {
  const navigate = useNavigate()
  const [system, setSystem] = useState('clio') // Default to 'clio' until Convex is deployed with 'all' support
  const [statusFilter, setStatusFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchType, setSearchType] = useState('matterId')

  // Get all traces
  const tracesData = useQuery(api.dashboard.traces.listTraces, {
    system,
    limit: 100,
    status: statusFilter || undefined,
  })

  // Search traces by ID
  const searchParams = useMemo(() => {
    if (!searchTerm) return null
    const params = { system, limit: 50 }
    if (system === 'clio' && searchType === 'matterId') {
      const matterId = parseInt(searchTerm)
      if (!isNaN(matterId)) params.matterId = matterId
      else return null
    } else if (system === 'ghl') {
      if (searchType === 'contactId') params.contactId = searchTerm
      else if (searchType === 'opportunityId') params.opportunityId = searchTerm
    }
    return params
  }, [system, searchTerm, searchType])

  const searchResults = useQuery(
    api.dashboard.traces.searchTraces,
    searchParams || 'skip'
  )

  const traces = searchTerm && searchResults ? searchResults : (tracesData?.traces || [])
  const isLoading = tracesData === undefined

  const handleViewDetails = (traceId) => {
    navigate(`/trace/${system}/${traceId}`)
  }

  return (
    <div>
      {/* System Toggle */}
      <div className="filters-bar">
        <div className="header-nav">
          <button
            className={`nav-btn ${system === 'all' ? 'active' : ''}`}
            onClick={() => { setSystem('all'); setSearchTerm(''); setStatusFilter(''); }}
          >
            All
          </button>
          <button
            className={`nav-btn ${system === 'clio' ? 'active' : ''}`}
            onClick={() => { setSystem('clio'); setSearchTerm(''); }}
          >
            Clio
          </button>
          <button
            className={`nav-btn ${system === 'ghl' ? 'active' : ''}`}
            onClick={() => { setSystem('ghl'); setSearchTerm(''); }}
          >
            GHL
          </button>
        </div>

        {/* Search - hidden in "all" mode */}
        {system !== 'all' && (
          <>
            <select
              className="filter-select"
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
            >
              {system === 'clio' ? (
                <option value="matterId">Matter ID</option>
              ) : (
                <>
                  <option value="contactId">Contact ID</option>
                  <option value="opportunityId">Opportunity ID</option>
                </>
              )}
            </select>

            <input
              type="text"
              className="search-input"
              placeholder={`Search by ${searchType}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </>
        )}

        {/* Status Filter - hidden in "all" mode */}
        {system !== 'all' && (
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            {system === 'clio' ? (
              <>
                <option value="success">Success</option>
                <option value="error">Error</option>
                <option value="in_progress">In Progress</option>
                <option value="skipped">Skipped</option>
              </>
            ) : (
              <>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="started">Started</option>
                <option value="partial">Partial</option>
              </>
            )}
          </select>
        )}
      </div>

      {/* Traces Table */}
      {isLoading ? (
        <div className="loading">
          <div className="loading-spinner" />
          Loading traces...
        </div>
      ) : traces.length === 0 ? (
        <div className="empty-state">
          <h3>No traces found</h3>
          <p>Try adjusting your filters or search criteria</p>
        </div>
      ) : (
        <table className="traces-table">
          <thead>
            <tr>
              {system === 'all' && <th>System</th>}
              <th>Trigger</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th>{system === 'all' ? 'ID' : (system === 'clio' ? 'Matter ID' : 'Contact/Opp ID')}</th>
              <th>Duration</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((trace) => {
              // Determine the trace's system (for "all" mode, use trace.system; otherwise use selected system)
              const traceSystem = trace.system || system;
              const isGhl = traceSystem === 'ghl';

              return (
                <tr key={trace._id}>
                  {system === 'all' && (
                    <td>
                      <span className={`system-badge ${traceSystem}`}>
                        {traceSystem.toUpperCase()}
                      </span>
                    </td>
                  )}
                  <td>
                    <div className="trigger-cell">
                      <span className="trigger-name">
                        {isGhl
                          ? getGHLTriggerDisplayName(trace)
                          : trace.triggerName}
                      </span>
                      <span className="trigger-time">
                        {formatTime(trace.dateStarted)}
                        <br />
                        {formatTimeRange(trace.dateStarted, trace.dateFinished)}
                      </span>
                    </div>
                  </td>
                  <td className="endpoint-cell">{trace.endpoint || '-'}</td>
                  <td>
                    {(() => {
                      const effectiveStatus = getEffectiveStatus(trace)
                      const skipReason = getSkipReason(trace.resultAction)
                      return (
                        <>
                          <span className={`status-badge ${effectiveStatus}`}>
                            {effectiveStatus}
                          </span>
                          {effectiveStatus === 'skipped' && skipReason && (
                            <div style={{ fontSize: '11px', color: 'var(--accent-yellow)', marginTop: '4px' }}>
                              {skipReason}
                            </div>
                          )}
                          {effectiveStatus === 'error' && trace.resultAction && (
                            <div style={{ fontSize: '11px', color: 'var(--accent-red)', marginTop: '4px' }}>
                              {trace.resultAction}
                            </div>
                          )}
                          {effectiveStatus !== 'skipped' && effectiveStatus !== 'error' && trace.resultAction && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                              {trace.resultAction}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </td>
                  <td className="id-cell">
                    {isGhl
                      ? (trace.contactId || trace.opportunityId || '-')
                      : (trace.matterId || '-')
                    }
                  </td>
                  <td className="duration-cell">{formatDuration(trace.durationMs)}</td>
                  <td>
                    <button
                      className="view-btn"
                      onClick={() => navigate(`/trace/${traceSystem}/${trace.traceId}`)}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
