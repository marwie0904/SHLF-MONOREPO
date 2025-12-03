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

function JsonViewer({ data, label }) {
  const [expanded, setExpanded] = useState(false)

  if (!data) return null

  return (
    <div className="payload-section">
      <button className="payload-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▼' : '▶'} {label}
      </button>
      {expanded && (
        <div className="detail-content">
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

function DetailItem({ detail, system }) {
  const [expanded, setExpanded] = useState(false)

  const operation = system === 'clio' ? detail.operation : (detail.operationName || detail.apiEndpoint || 'Unknown')
  const detailType = system === 'clio' ? detail.operationType : detail.detailType
  const status = detail.status

  return (
    <div className="detail-item">
      <div className="detail-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <div>
          <span className="detail-operation">{operation}</span>
          <span className={`status-badge ${status}`} style={{ marginLeft: '8px' }}>
            {status}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span className="detail-type">{detailType}</span>
          <span className="step-duration">{formatDuration(detail.durationMs)}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '12px' }}>
          {system === 'clio' ? (
            <>
              <JsonViewer data={detail.input} label="Input" />
              <JsonViewer data={detail.output} label="Output" />
            </>
          ) : (
            <>
              <JsonViewer data={detail.requestBody} label="Request Body" />
              <JsonViewer data={detail.responseBody} label="Response Body" />
              <JsonViewer data={detail.operationInput} label="Operation Input" />
              <JsonViewer data={detail.operationOutput} label="Operation Output" />
            </>
          )}
          {detail.errorMessage && (
            <div style={{ marginTop: '8px', color: 'var(--accent-red)', fontSize: '13px' }}>
              Error: {detail.errorMessage}
            </div>
          )}
          {detail.error && (
            <JsonViewer data={detail.error} label="Error Details" />
          )}
        </div>
      )}
    </div>
  )
}

function StepCard({ step, system }) {
  const [expanded, setExpanded] = useState(false)

  const stepName = system === 'clio' ? step.stepName : step.functionName
  const layerName = system === 'clio' ? step.layerName : step.serviceName
  const status = step.status
  const details = step.details || []

  return (
    <div className={`flow-item ${status}`}>
      <div
        className={`step-card ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="step-header">
          <div>
            <div className="step-title">{stepName}</div>
            <div className="step-layer">{layerName}</div>
          </div>
          <div className="step-stats">
            <span className={`status-badge ${status}`}>{status}</span>
            <span className="step-duration">{formatDuration(step.durationMs)}</span>
            {details.length > 0 && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {details.length} detail{details.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {expanded && details.length > 0 && (
          <div className="details-container">
            {details.map((detail, idx) => (
              <DetailItem key={detail.detailId || idx} detail={detail} system={system} />
            ))}
          </div>
        )}

        {expanded && step.errorMessage && (
          <div style={{ marginTop: '12px', color: 'var(--accent-red)', fontSize: '13px' }}>
            Error: {step.errorMessage}
          </div>
        )}

        {expanded && (
          <div style={{ marginTop: '12px' }}>
            <JsonViewer data={step.metadata || step.contextData} label="Context Data" />
          </div>
        )}
      </div>
    </div>
  )
}

export default function TraceDetailPage() {
  const { system, traceId } = useParams()
  const navigate = useNavigate()

  const data = useQuery(api.dashboard.traces.getTraceDetails, {
    system: system,
    traceId: traceId,
  })

  if (data === undefined) {
    return (
      <div className="trace-detail">
        <div className="loading">
          <div className="loading-spinner" />
          Loading trace details...
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="trace-detail">
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
  const triggerName = system === 'clio' ? trace.triggerName : trace.endpoint
  const startTime = system === 'clio' ? trace.dateStarted : trace.startTime
  const endTime = system === 'clio' ? trace.dateFinished : trace.endTime

  return (
    <div className="trace-detail">
      <button className="back-btn" onClick={() => navigate('/')}>
        ← Back to Traces
      </button>

      {/* Trace Header */}
      <div className="trace-header">
        <h1>
          {triggerName}
          <span className={`status-badge ${trace.status}`}>{trace.status}</span>
        </h1>

        <div className="trace-meta">
          <div className="meta-item">
            <span className="meta-label">Trace ID</span>
            <span className="meta-value">{trace.traceId}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Started</span>
            <span className="meta-value">{formatTime(startTime)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Ended</span>
            <span className="meta-value">{formatTime(endTime)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Duration</span>
            <span className="meta-value">{formatDuration(trace.durationMs)}</span>
          </div>
          {system === 'clio' && trace.matterId && (
            <div className="meta-item">
              <span className="meta-label">Matter ID</span>
              <span className="meta-value">{trace.matterId}</span>
            </div>
          )}
          {system === 'ghl' && trace.contactId && (
            <div className="meta-item">
              <span className="meta-label">Contact ID</span>
              <span className="meta-value">{trace.contactId}</span>
            </div>
          )}
          {system === 'ghl' && trace.opportunityId && (
            <div className="meta-item">
              <span className="meta-label">Opportunity ID</span>
              <span className="meta-value">{trace.opportunityId}</span>
            </div>
          )}
          {trace.resultAction && (
            <div className="meta-item">
              <span className="meta-label">Result Action</span>
              <span className="meta-value">{trace.resultAction}</span>
            </div>
          )}
        </div>

        {trace.errorMessage && (
          <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(244, 33, 46, 0.1)', borderRadius: '8px', color: 'var(--accent-red)' }}>
            <strong>Error:</strong> {trace.errorMessage}
          </div>
        )}

        {trace.error && (
          <div style={{ marginTop: '16px' }}>
            <JsonViewer data={trace.error} label="Error Details" />
          </div>
        )}

        {/* Request/Response for GHL */}
        {system === 'ghl' && (
          <div style={{ marginTop: '16px' }}>
            <JsonViewer data={trace.requestBody} label="Request Body" />
            <JsonViewer data={trace.responseBody} label="Response Body" />
          </div>
        )}

        {/* Metadata for Clio */}
        {system === 'clio' && trace.metadata && (
          <div style={{ marginTop: '16px' }}>
            <JsonViewer data={trace.metadata} label="Metadata" />
          </div>
        )}
      </div>

      {/* Steps Flow */}
      <h2 style={{ marginBottom: '16px', fontSize: '16px', color: 'var(--text-secondary)' }}>
        Execution Flow ({steps.length} step{steps.length !== 1 ? 's' : ''})
      </h2>

      <div className="trace-flow">
        {steps.map((step, idx) => (
          <StepCard key={step.stepId || idx} step={step} system={system} />
        ))}
      </div>

      {steps.length === 0 && (
        <div className="empty-state">
          <p>No steps recorded for this trace</p>
        </div>
      )}
    </div>
  )
}
