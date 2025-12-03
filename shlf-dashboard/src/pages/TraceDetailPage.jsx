import { useState } from 'react'
import { useQuery } from 'convex/react'
import { useParams, useNavigate } from 'react-router-dom'
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
    skipped: 'var(--text-muted)',
    partial: 'var(--accent-yellow)',
  }
  return colors[status] || 'var(--text-muted)'
}

// Flow Node Component (Left side)
function FlowNode({ item, type, isSelected, onClick, isFirst, isLast, system }) {
  const isTrace = type === 'trace'
  const isStep = type === 'step'

  let title, subtitle, status, duration

  if (isTrace) {
    title = system === 'clio' ? item.triggerName : item.endpoint
    subtitle = system === 'clio' ? item.endpoint : item.httpMethod
    status = item.status
    duration = item.durationMs
  } else if (isStep) {
    title = system === 'clio' ? item.stepName : item.functionName
    subtitle = system === 'clio' ? item.layerName : item.serviceName
    status = item.status
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
          <div className="flow-node-subtitle">{subtitle}</div>
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
function DetailPanel({ item, type, system, onClose }) {
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

  let title, subtitle, status, duration, startTime, endTime

  if (isTrace) {
    title = system === 'clio' ? item.triggerName : item.endpoint
    subtitle = system === 'clio' ? (item.source || 'webhook') : item.triggerType
    status = item.status
    duration = item.durationMs
    startTime = system === 'clio' ? item.dateStarted : item.startTime
    endTime = system === 'clio' ? item.dateFinished : item.endTime
  } else if (isStep) {
    title = system === 'clio' ? item.stepName : item.functionName
    subtitle = system === 'clio' ? item.layerName : item.serviceName
    status = item.status
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

// Detail Item for nested operations
function DetailItem({ detail, system }) {
  const [expanded, setExpanded] = useState(false)

  const operation = system === 'clio' ? detail.operation : (detail.operationName || detail.apiEndpoint || 'Unknown')
  const detailType = system === 'clio' ? detail.operationType : detail.detailType
  const status = detail.status

  return (
    <div className={`panel-detail-item ${expanded ? 'expanded' : ''}`}>
      <div className="panel-detail-header" onClick={() => setExpanded(!expanded)}>
        <div className="panel-detail-info">
          <span className={`status-dot ${status}`} />
          <span className="panel-detail-operation">{operation}</span>
          <span className="panel-detail-type">{detailType}</span>
        </div>
        <span className="panel-detail-duration">{formatDuration(detail.durationMs)}</span>
      </div>

      {expanded && (
        <div className="panel-detail-body">
          {system === 'clio' ? (
            <>
              {detail.input && (
                <div className="panel-detail-data">
                  <div className="panel-detail-data-label">Input</div>
                  <pre>{JSON.stringify(detail.input, null, 2)}</pre>
                </div>
              )}
              {detail.output && (
                <div className="panel-detail-data">
                  <div className="panel-detail-data-label">Output</div>
                  <pre>{JSON.stringify(detail.output, null, 2)}</pre>
                </div>
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
          {detail.errorMessage && (
            <div className="panel-detail-error">
              Error: {detail.errorMessage}
            </div>
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

  return (
    <div className="trace-detail-page">
      <div className="trace-detail-header">
        <button className="back-btn" onClick={() => navigate('/')}>
          ← Back to Traces
        </button>
        <div className="trace-detail-title">
          <h1>{system === 'clio' ? trace.triggerName : trace.endpoint}</h1>
          <span className={`status-badge ${trace.status}`}>{trace.status}</span>
          <span className="trace-id">ID: {trace.traceId}</span>
        </div>
      </div>

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
        />
      </div>
    </div>
  )
}
