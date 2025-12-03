import { useState } from 'react'
import { useQuery } from 'convex/react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../convex/_generated/api'
import { format } from 'date-fns'
import WorkflowVisualization from '../components/WorkflowVisualization'

function formatDuration(ms) {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(2)}m`
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  return format(new Date(timestamp), 'MMM dd, yyyy HH:mm:ss.SSS')
}

function getStepIcon(layerName) {
  const icons = {
    webhook: '⚡',
    processing: '⚙️',
    automation: '🤖',
    service: '📦',
    external: '🌐',
    validation: '✓',
    default: '○'
  }
  return icons[layerName?.toLowerCase()] || icons.default
}

function getStatusColor(status) {
  const colors = {
    success: 'var(--accent-green)',
    completed: 'var(--accent-green)',
    error: 'var(--accent-red)',
    failed: 'var(--accent-red)',
    in_progress: 'var(--accent-blue)',
    started: 'var(--accent-blue)',
    skipped: 'var(--accent-yellow)',
    partial: 'var(--accent-yellow)',
  }
  return colors[status] || 'var(--text-muted)'
}

// Determine effective status from step metadata and other fields
function getEffectiveStepStatus(step, system) {
  const status = step.status
  const metadata = step.metadata || {}
  const resultAction = step.resultAction?.toLowerCase() || ''

  // Check metadata.reason for skip indicators
  const reason = metadata.reason?.toLowerCase() || ''
  if (reason === 'no_matter_id' || reason === 'no_contact_id' ||
      reason.includes('skip') || reason.includes('bypass') ||
      reason === 'already_processed' || reason === 'test_mode') {
    return 'skipped'
  }

  // Check resultAction for skip indicators
  if (resultAction.includes('skipped') || resultAction.includes('skip') ||
      resultAction === 'already_processed' || resultAction === 'still_processing' ||
      resultAction === 'no_action' || resultAction === 'ignored') {
    return 'skipped'
  }

  // Check for error indicators
  if (resultAction === 'error' || resultAction.includes('error') || resultAction.includes('failed')) {
    return 'error'
  }

  // Check for error message
  if (step.errorMessage || step.error) {
    return 'error'
  }

  return status
}

// Get human-readable skip reason from step
function getStepSkipReason(step) {
  const metadata = step.metadata || {}
  const reason = metadata.reason?.toLowerCase() || ''
  const resultAction = step.resultAction?.toLowerCase() || ''

  const reasonMap = {
    'no_matter_id': 'No Matter ID',
    'no_contact_id': 'No Contact ID',
    'already_processed': 'Already processed',
    'test_mode': 'Test mode filter',
    'bypass': 'Bypassed',
  }

  // Check metadata.reason first
  if (metadata.reason) {
    return reasonMap[reason] || metadata.reason
  }

  // Check resultAction
  const actionReasons = {
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

  return actionReasons[resultAction] || (resultAction.includes('skip') ? step.resultAction : null)
}

// Determine effective trace status based on steps
function getEffectiveTraceStatus(trace, steps, system) {
  const traceStatus = trace.status
  const resultAction = trace.resultAction?.toLowerCase() || ''

  // Check if any step has an error
  const hasError = steps.some(step => {
    const effectiveStatus = getEffectiveStepStatus(step, system)
    return effectiveStatus === 'error'
  })
  if (hasError) return 'error'

  // Check if all meaningful steps are skipped
  const allSkipped = steps.length > 0 && steps.every(step => {
    const effectiveStatus = getEffectiveStepStatus(step, system)
    return effectiveStatus === 'skipped'
  })
  if (allSkipped) return 'skipped'

  // Check if any step is skipped (partial)
  const hasSkipped = steps.some(step => {
    const effectiveStatus = getEffectiveStepStatus(step, system)
    return effectiveStatus === 'skipped'
  })

  // Check trace-level indicators
  if (resultAction.includes('skipped') || resultAction.includes('skip') ||
      resultAction === 'already_processed' || resultAction === 'no_action') {
    return 'skipped'
  }

  if (resultAction === 'error' || resultAction.includes('error') || resultAction.includes('failed')) {
    return 'error'
  }

  if (trace.errorMessage) {
    return 'error'
  }

  return traceStatus
}

// Flow Node Component (Left side)
function FlowNode({ item, type, isSelected, onClick, isFirst, isLast, system, effectiveStatus: overrideStatus }) {
  const isTrace = type === 'trace'
  const isStep = type === 'step'

  let title, subtitle, status, duration, skipReason

  if (isTrace) {
    title = system === 'clio' ? item.triggerName : item.endpoint
    subtitle = system === 'clio' ? item.endpoint : item.httpMethod
    status = overrideStatus || item.status
    duration = item.durationMs
  } else if (isStep) {
    title = system === 'clio' ? item.stepName : item.functionName
    subtitle = system === 'clio' ? item.layerName : item.serviceName
    // Use effective status for steps
    status = getEffectiveStepStatus(item, system)
    skipReason = status === 'skipped' ? getStepSkipReason(item) : null
    duration = item.durationMs
  }

  const icon = isTrace ? '⚡' : getStepIcon(subtitle)
  const statusColor = getStatusColor(status)

  return (
    <div className="flow-node-wrapper">
      {/* Connector line */}
      {!isFirst && <div className="flow-connector" />}

      {/* Node */}
      <div
        className={`flow-node ${isSelected ? 'selected' : ''} ${isTrace ? 'trigger' : ''}`}
        onClick={onClick}
        style={{ '--status-color': statusColor }}
      >
        <div className="flow-node-icon">{icon}</div>
        <div className="flow-node-content">
          <div className="flow-node-title">{title}</div>
          {subtitle && (
            <div className={`flow-node-layer-badge layer-${subtitle?.toLowerCase()}`}>
              {subtitle} Layer
            </div>
          )}
          {skipReason && (
            <div className="flow-node-skip-reason">{skipReason}</div>
          )}
        </div>
        <div className="flow-node-meta">
          <span className={`status-dot ${status}`} />
          <span className="flow-node-duration">{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Bottom connector */}
      {!isLast && <div className="flow-connector" />}
    </div>
  )
}

// Detail Panel Component (Right side)
function DetailPanel({ item, type, system, onClose, effectiveTraceStatus }) {
  const [expandedSections, setExpandedSections] = useState({})

  if (!item) {
    return (
      <div className="detail-panel empty">
        <div className="detail-panel-placeholder">
          <div className="placeholder-icon">👈</div>
          <p>Select a step to view details</p>
        </div>
      </div>
    )
  }

  const toggleSection = (key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const isTrace = type === 'trace'
  const isStep = type === 'step'

  let title, subtitle, status, duration, startTime, endTime, skipReason

  if (isTrace) {
    title = system === 'clio' ? item.triggerName : item.endpoint
    subtitle = system === 'clio' ? (item.source || 'webhook') : item.triggerType
    status = effectiveTraceStatus || item.status
    duration = item.durationMs
    startTime = system === 'clio' ? item.dateStarted : item.startTime
    endTime = system === 'clio' ? item.dateFinished : item.endTime
  } else if (isStep) {
    title = system === 'clio' ? item.stepName : item.functionName
    subtitle = system === 'clio' ? item.layerName : item.serviceName
    // Use effective status for steps
    status = getEffectiveStepStatus(item, system)
    skipReason = status === 'skipped' ? getStepSkipReason(item) : null
    duration = item.durationMs
    startTime = system === 'clio' ? item.dateStarted : item.startTime
    endTime = system === 'clio' ? item.dateFinished : item.endTime
  }

  const renderJsonSection = (data, label, key) => {
    if (!data) return null
    const isExpanded = expandedSections[key]

    return (
      <div className="panel-section">
        <div className="panel-section-header" onClick={() => toggleSection(key)}>
          <span>{isExpanded ? '▼' : '▶'} {label}</span>
        </div>
        {isExpanded && (
          <div className="panel-json">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <div>
          <h2>{title}</h2>
          <span className="panel-subtitle">{subtitle}</span>
        </div>
        <button className="panel-close" onClick={onClose}>×</button>
      </div>

      <div className="detail-panel-body">
        {/* Status & Timing */}
        <div className="panel-section">
          <div className="panel-grid">
            <div className="panel-stat">
              <span className="panel-stat-label">Status</span>
              <span className={`status-badge ${status}`}>{status}</span>
              {skipReason && (
                <div className="skip-reason-badge">{skipReason}</div>
              )}
            </div>
            <div className="panel-stat">
              <span className="panel-stat-label">Duration</span>
              <span className="panel-stat-value">{formatDuration(duration)}</span>
            </div>
            <div className="panel-stat">
              <span className="panel-stat-label">Started</span>
              <span className="panel-stat-value">{formatTime(startTime)}</span>
            </div>
            <div className="panel-stat">
              <span className="panel-stat-label">Ended</span>
              <span className="panel-stat-value">{formatTime(endTime)}</span>
            </div>
          </div>
        </div>

        {/* Trace-specific fields */}
        {isTrace && (
          <>
            {system === 'clio' && item.matterId && (
              <div className="panel-section">
                <div className="panel-stat">
                  <span className="panel-stat-label">Matter ID</span>
                  <span className="panel-stat-value highlight">{item.matterId}</span>
                </div>
              </div>
            )}
            {system === 'ghl' && (item.contactId || item.opportunityId) && (
              <div className="panel-section">
                <div className="panel-grid">
                  {item.contactId && (
                    <div className="panel-stat">
                      <span className="panel-stat-label">Contact ID</span>
                      <span className="panel-stat-value">{item.contactId}</span>
                    </div>
                  )}
                  {item.opportunityId && (
                    <div className="panel-stat">
                      <span className="panel-stat-label">Opportunity ID</span>
                      <span className="panel-stat-value">{item.opportunityId}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {item.resultAction && (
              <div className="panel-section">
                <div className="panel-stat">
                  <span className="panel-stat-label">Result Action</span>
                  <span className="panel-stat-value">{item.resultAction}</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Error Message */}
        {(item.errorMessage || item.error) && (
          <div className="panel-section error">
            <div className="panel-error">
              <strong>Error:</strong> {item.errorMessage || item.error?.message}
            </div>
            {item.error?.stack && (
              <div className="panel-json error-stack">
                <pre>{item.error.stack}</pre>
              </div>
            )}
          </div>
        )}

        {/* Data Payloads */}
        {isTrace && system === 'ghl' && (
          <>
            {renderJsonSection(item.requestBody, 'Request Body', 'requestBody')}
            {renderJsonSection(item.responseBody, 'Response Body', 'responseBody')}
            {renderJsonSection(item.requestHeaders, 'Request Headers', 'requestHeaders')}
          </>
        )}

        {isTrace && system === 'clio' && (
          <>
            {renderJsonSection(item.metadata, 'Metadata', 'metadata')}
          </>
        )}

        {isStep && (
          <>
            {system === 'clio' ? (
              <>
                {renderJsonSection(item.metadata, 'Context Data', 'metadata')}
              </>
            ) : (
              <>
                {renderJsonSection(item.input, 'Input', 'input')}
                {renderJsonSection(item.output, 'Output', 'output')}
                {renderJsonSection(item.contextData, 'Context Data', 'contextData')}
              </>
            )}
          </>
        )}

        {/* Nested Details for Steps */}
        {isStep && item.details && item.details.length > 0 && (
          <div className="panel-section">
            <h3 className="panel-section-title">Operations ({item.details.length})</h3>
            <div className="panel-details-list">
              {item.details.map((detail, idx) => (
                <DetailItem key={detail.detailId || idx} detail={detail} system={system} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Get operation type icon
function getOperationTypeIcon(operationType) {
  const icons = {
    api_call: '🌐',
    db_query: '📖',
    db_mutation: '💾',
    validation: '✓',
    calculation: '🧮',
    decision: '🔀',
    external_call: '📡',
    webhook: '⚡',
  }
  return icons[operationType] || '○'
}

// Render operation-specific summary for Clio details
function renderOperationSummary(detail) {
  const { operation, operationType, input, output } = detail

  // Task creation
  if (operation === 'clio_createTask' || operation === 'task_created') {
    return (
      <div className="operation-summary task-created">
        <div className="summary-row">
          <span className="summary-label">Task:</span>
          <span className="summary-value">{input?.name || output?.name || '-'}</span>
        </div>
        {input?.taskNumber && (
          <div className="summary-row">
            <span className="summary-label">Task #:</span>
            <span className="summary-value">{input.taskNumber}</span>
          </div>
        )}
        {input?.assigneeName && (
          <div className="summary-row">
            <span className="summary-label">Assignee:</span>
            <span className="summary-value">
              {input.assigneeName}
              {input.assigneeType && <span className="badge-small">{input.assigneeType}</span>}
            </span>
          </div>
        )}
        {input?.dueDate && (
          <div className="summary-row">
            <span className="summary-label">Due:</span>
            <span className="summary-value">{formatTime(new Date(input.dueDate).getTime())}</span>
          </div>
        )}
        {output?.taskId && (
          <div className="summary-row">
            <span className="summary-label">Task ID:</span>
            <span className="summary-value highlight">{output.taskId}</span>
          </div>
        )}
      </div>
    )
  }

  // Stage change detection
  if (operation === 'stage_change_detected') {
    return (
      <div className="operation-summary stage-change">
        <div className="summary-row stage-transition">
          <span className="stage-from">{input?.previousStageName || 'Unknown'}</span>
          <span className="stage-arrow">→</span>
          <span className="stage-to">{input?.newStageName || 'Unknown'}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Matter:</span>
          <span className="summary-value highlight">{input?.matterId}</span>
        </div>
      </div>
    )
  }

  // Webhook received
  if (operation === 'webhook_received' || operationType === 'webhook') {
    return (
      <div className="operation-summary webhook-received">
        <div className="summary-row">
          <span className="summary-label">Event:</span>
          <span className="summary-value">{input?.eventType || '-'}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Resource:</span>
          <span className="summary-value">
            {input?.resourceType} #{input?.resourceId}
          </span>
        </div>
      </div>
    )
  }

  // Decision operations
  if (operationType === 'decision') {
    return (
      <div className="operation-summary decision">
        {output?.action && (
          <div className="summary-row">
            <span className="summary-label">Decision:</span>
            <span className="summary-value">{output.action}</span>
          </div>
        )}
        {output?.reason && (
          <div className="summary-row">
            <span className="summary-label">Reason:</span>
            <span className="summary-value">{output.reason}</span>
          </div>
        )}
      </div>
    )
  }

  return null
}

// Render structured error display
function renderErrorDetails(detail) {
  const { error, errorMessage } = detail

  // If we have the new structured error object
  if (error) {
    return (
      <div className="panel-detail-error structured-error">
        <div className="error-header">
          <span className="error-icon">❌</span>
          <span className="error-message">{error.message}</span>
        </div>
        <div className="error-badges">
          {error.code && (
            <span className="error-badge code">{error.code}</span>
          )}
          {error.httpStatus && (
            <span className="error-badge http-status">HTTP {error.httpStatus}</span>
          )}
        </div>
        {error.stack && (
          <details className="error-stack-details">
            <summary>Stack Trace</summary>
            <pre className="error-stack">{error.stack}</pre>
          </details>
        )}
        {error.response && (
          <details className="error-response-details">
            <summary>API Response</summary>
            <pre className="error-response">{JSON.stringify(error.response, null, 2)}</pre>
          </details>
        )}
      </div>
    )
  }

  // Fallback to legacy errorMessage
  if (errorMessage) {
    return (
      <div className="panel-detail-error">
        <span className="error-icon">❌</span> {errorMessage}
      </div>
    )
  }

  return null
}

// Detail Item for nested operations
function DetailItem({ detail, system }) {
  const [expanded, setExpanded] = useState(false)

  const operation = system === 'clio' ? detail.operation : (detail.operationName || detail.apiEndpoint || 'Unknown')
  const detailType = system === 'clio' ? detail.operationType : detail.detailType
  const status = detail.status
  const hasError = detail.error || detail.errorMessage

  return (
    <div className={`panel-detail-item ${expanded ? 'expanded' : ''} ${hasError ? 'has-error' : ''}`}>
      <div className="panel-detail-header" onClick={() => setExpanded(!expanded)}>
        <div className="panel-detail-info">
          <span className={`status-dot ${status}`} />
          <span className="panel-detail-icon">{getOperationTypeIcon(detailType)}</span>
          <span className="panel-detail-operation">{operation}</span>
          <span className={`panel-detail-type type-${detailType}`}>{detailType}</span>
        </div>
        <span className="panel-detail-duration">{formatDuration(detail.durationMs)}</span>
      </div>

      {expanded && (
        <div className="panel-detail-body">
          {/* Operation-specific summary (Clio only) */}
          {system === 'clio' && renderOperationSummary(detail)}

          {/* Error details (with structured error support) */}
          {hasError && renderErrorDetails(detail)}

          {/* Standard input/output sections */}
          {system === 'clio' ? (
            <>
              {detail.input && (
                <details className="panel-detail-data-section">
                  <summary className="panel-detail-data-label">Input Data</summary>
                  <pre>{JSON.stringify(detail.input, null, 2)}</pre>
                </details>
              )}
              {detail.output && (
                <details className="panel-detail-data-section">
                  <summary className="panel-detail-data-label">Output Data</summary>
                  <pre>{JSON.stringify(detail.output, null, 2)}</pre>
                </details>
              )}
            </>
          ) : (
            <>
              {detail.requestBody && (
                <div className="panel-detail-data">
                  <div className="panel-detail-data-label">Request</div>
                  <pre>{JSON.stringify(detail.requestBody, null, 2)}</pre>
                </div>
              )}
              {detail.responseBody && (
                <div className="panel-detail-data">
                  <div className="panel-detail-data-label">Response</div>
                  <pre>{JSON.stringify(detail.responseBody, null, 2)}</pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function TraceDetailPage() {
  const { system, traceId } = useParams()
  const navigate = useNavigate()
  const [selectedItem, setSelectedItem] = useState({ type: 'trace', item: null })
  const [viewMode, setViewMode] = useState('workflow') // 'workflow' or 'steps'

  const data = useQuery(api.dashboard.traces.getTraceDetails, {
    system: system,
    traceId: traceId,
  })

  // Auto-select trace when data loads
  if (data && !selectedItem.item && data.trace) {
    setSelectedItem({ type: 'trace', item: data.trace })
  }

  if (data === undefined) {
    return (
      <div className="trace-detail-page">
        <div className="loading">
          <div className="loading-spinner" />
          Loading trace details...
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="trace-detail-page">
        <button className="back-btn" onClick={() => navigate('/')}>
          ← Back to Traces
        </button>
        <div className="empty-state">
          <h3>Trace not found</h3>
          <p>The trace you're looking for doesn't exist</p>
        </div>
      </div>
    )
  }

  const { trace, steps } = data

  // Compute effective trace status based on steps
  const effectiveTraceStatus = getEffectiveTraceStatus(trace, steps, system)

  return (
    <div className="trace-detail-page">
      <div className="trace-detail-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          ← Back to Traces
        </button>
        <div className="trace-detail-title">
          <h1>{system === 'clio' ? trace.triggerName : trace.endpoint}</h1>
          <span className={`status-badge ${effectiveTraceStatus}`}>{effectiveTraceStatus}</span>
          <span className="trace-id">ID: {trace.traceId}</span>
        </div>
        {/* View Mode Toggle - Only for Clio */}
        {system === 'clio' && (
          <div className="view-mode-toggle">
            <button
              className={`view-mode-btn ${viewMode === 'workflow' ? 'active' : ''}`}
              onClick={() => setViewMode('workflow')}
            >
              🔄 Workflow
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'steps' ? 'active' : ''}`}
              onClick={() => setViewMode('steps')}
            >
              📋 Steps
            </button>
          </div>
        )}
      </div>

      {/* Workflow View */}
      {system === 'clio' && viewMode === 'workflow' && (
        <div className="trace-detail-workflow">
          <WorkflowVisualization trace={trace} steps={steps} />
        </div>
      )}

      {/* Steps View (original layout) */}
      {(system !== 'clio' || viewMode === 'steps') && (
        <div className="trace-detail-layout">
          {/* Left: Flow Graph */}
          <div className="flow-graph">
            <div className="flow-graph-container">
              {/* Trigger Node */}
              <FlowNode
                item={trace}
                type="trace"
                isSelected={selectedItem.type === 'trace'}
                onClick={() => setSelectedItem({ type: 'trace', item: trace })}
                isFirst={true}
                isLast={steps.length === 0}
                system={system}
                effectiveStatus={effectiveTraceStatus}
              />

              {/* Step Nodes */}
              {steps.map((step, idx) => (
                <FlowNode
                  key={step.stepId || idx}
                  item={step}
                  type="step"
                  isSelected={selectedItem.type === 'step' && selectedItem.item?.stepId === step.stepId}
                  onClick={() => setSelectedItem({ type: 'step', item: step })}
                  isFirst={false}
                  isLast={idx === steps.length - 1}
                  system={system}
                />
              ))}
            </div>
          </div>

          {/* Right: Detail Panel */}
          <DetailPanel
            item={selectedItem.item}
            type={selectedItem.type}
            system={system}
            onClose={() => setSelectedItem({ type: null, item: null })}
            effectiveTraceStatus={effectiveTraceStatus}
          />
        </div>
      )}
    </div>
  )
}
