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

  // If resultAction contains error indicators, override to error
  if (resultAction === 'error' || resultAction.includes('error') || resultAction.includes('failed')) {
    return 'error'
  }

  // If status is success but errorMessage exists, it's an error
  if (trace.errorMessage) {
    return 'error'
  }

  return status
}

export default function TracesPage() {
  const navigate = useNavigate()
  const [system, setSystem] = useState('clio')
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

        {/* Search */}
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

        {/* Status Filter */}
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
              <th>Trigger</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th>{system === 'clio' ? 'Matter ID' : 'Contact/Opp ID'}</th>
              <th>Duration</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((trace) => (
              <tr key={trace._id}>
                <td>
                  <div className="trigger-cell">
                    <span className="trigger-name">{trace.triggerName}</span>
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
                    return (
                      <>
                        <span className={`status-badge ${effectiveStatus}`}>
                          {effectiveStatus}
                        </span>
                        {trace.resultAction && trace.resultAction !== effectiveStatus && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {trace.resultAction}
                          </div>
                        )}
                      </>
                    )
                  })()}
                </td>
                <td className="id-cell">
                  {system === 'clio'
                    ? (trace.matterId || '-')
                    : (trace.contactId || trace.opportunityId || '-')
                  }
                </td>
                <td className="duration-cell">{formatDuration(trace.durationMs)}</td>
                <td>
                  <button
                    className="view-btn"
                    onClick={() => handleViewDetails(trace.traceId)}
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
