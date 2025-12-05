import { useState, useMemo } from 'react'
import { getWorkflowTemplate, matchTraceToWorkflow } from '../config/workflowTemplates'
import { getGHLWorkflowTemplate, matchGHLTraceToWorkflow, ghlWorkflowTemplates } from '../config/ghlWorkflowTemplates'

/**
 * Get the appropriate workflow trigger name for GHL traces
 * Maps generic custom-object endpoints to specific invoice triggers when applicable
 * @param {object} trace - The trace object
 * @param {array} steps - Optional array of steps to check for objectKey in first step's output
 */
function getGHLWorkflowTrigger(trace, steps = []) {
  const endpoint = trace?.endpoint || ''
  const endpointName = endpoint.split('/').pop() || endpoint

  // Check if this is an invoice-related trace by looking at objectKey
  // First check trace's requestBody, then fall back to first step's output
  let objectKey = trace?.requestBody?.objectKey || trace?.requestBody?.schemaKey || ''

  // If no objectKey in requestBody, check the first step's output (webhook_received step)
  if (!objectKey && steps?.length > 0) {
    const firstStep = steps[0]
    objectKey = firstStep?.output?.objectKey || ''
  }

  const isInvoice = objectKey === 'custom_objects.invoices'

  // Map custom-object endpoints to invoice-specific triggers when applicable
  if (isInvoice) {
    if (endpointName === 'custom-object-created') return 'invoice-created'
    if (endpointName === 'custom-object-updated') return 'invoice-updated'
    if (endpointName === 'custom-object-deleted') return 'invoice-deleted'
  }

  return endpointName
}

/**
 * Get icon for node type/layer
 */
function getNodeIcon(node) {
  if (node.type === 'decision') return '🔀'
  if (node.type === 'outcome') {
    if (node.status === 'success') return '✅'
    if (node.status === 'error') return '❌'
    return '⏭️'
  }

  const layerIcons = {
    webhook: '⚡',
    processing: '⚙️',
    automation: '🤖',
    service: '📦',
    external: '🌐',
  }
  return layerIcons[node.layer] || '○'
}

/**
 * Single Node Card Component
 */
function NodeCard({ node, matchStatus, isSelected, onClick }) {
  const isTaken = matchStatus === 'taken' || matchStatus === 'current'
  const icon = getNodeIcon(node)

  return (
    <div
      className={`wf-node ${node.type} ${matchStatus} ${isSelected ? 'selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(node)
      }}
    >
      <div className="wf-node-icon">{icon}</div>
      <div className="wf-node-content">
        <div className="wf-node-name">{node.name}</div>
        {node.type === 'decision' && node.condition && (
          <div className="wf-node-condition">{node.condition}</div>
        )}
        {node.layer && node.type === 'step' && (
          <div className={`wf-node-layer layer-${node.layer}`}>{node.layer}</div>
        )}
      </div>
      {node.type === 'outcome' && (
        <div className={`wf-outcome-badge ${node.status}`}>{node.status}</div>
      )}
    </div>
  )
}

/**
 * Connector line between nodes
 */
function Connector({ taken }) {
  return <div className={`wf-connector ${taken ? 'taken' : ''}`} />
}

/**
 * Branch label (Yes/No/etc)
 */
function BranchLabel({ label, taken }) {
  return (
    <div className={`wf-branch-label ${taken ? 'taken' : ''}`}>
      {label}
    </div>
  )
}

/**
 * Recursive Tree Node Renderer
 */
function TreeNode({ node, selectedNodeId, onNodeClick }) {
  // Use matchStatus for path highlighting, status for outcome display
  const matchStatus = node.matchStatus || node.status || 'not-taken'
  const isTaken = matchStatus === 'taken' || matchStatus === 'current'
  const isSelected = selectedNodeId === node.id

  // For decision nodes, render branches side by side
  if (node.type === 'decision' && node.children && node.children.length > 0) {
    return (
      <div className="wf-tree-node">
        <NodeCard node={node} matchStatus={matchStatus} isSelected={isSelected} onClick={onNodeClick} />
        <Connector taken={isTaken} />

        {/* Horizontal line spanning all branches */}
        <div className="wf-branch-container">
          <div className={`wf-branch-line ${isTaken ? 'taken' : ''}`} />

          <div className="wf-branches">
            {node.children.map((branch, idx) => {
              const branchMatchStatus = branch.node.matchStatus || branch.node.status || 'not-taken'
              const branchTaken = branchMatchStatus === 'taken' || branchMatchStatus === 'current'
              return (
                <div key={idx} className={`wf-branch ${branchTaken ? 'taken' : 'not-taken'}`}>
                  <div className={`wf-branch-connector ${branchTaken ? 'taken' : ''}`} />
                  <BranchLabel label={branch.label} taken={branchTaken} />
                  <TreeNode node={branch.node} selectedNodeId={selectedNodeId} onNodeClick={onNodeClick} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // For step nodes with children, render vertically
  if (node.type === 'step' && node.children && node.children.length > 0) {
    // Check if children are branches (decision-like) or direct nodes
    const hasBranchChildren = node.children[0]?.node !== undefined

    if (hasBranchChildren) {
      // Step with branch children (rare, but handle it)
      return (
        <div className="wf-tree-node">
          <NodeCard node={node} matchStatus={matchStatus} isSelected={isSelected} onClick={onNodeClick} />
          <Connector taken={isTaken} />
          <div className="wf-branch-container">
            <div className={`wf-branch-line ${isTaken ? 'taken' : ''}`} />
            <div className="wf-branches">
              {node.children.map((branch, idx) => {
                const branchMatchStatus = branch.node.matchStatus || branch.node.status || 'not-taken'
                const branchTaken = branchMatchStatus === 'taken' || branchMatchStatus === 'current'
                return (
                  <div key={idx} className={`wf-branch ${branchTaken ? 'taken' : 'not-taken'}`}>
                    <div className={`wf-branch-connector ${branchTaken ? 'taken' : ''}`} />
                    <BranchLabel label={branch.label} taken={branchTaken} />
                    <TreeNode node={branch.node} selectedNodeId={selectedNodeId} onNodeClick={onNodeClick} />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )
    }

    // Step with direct children (linear flow)
    return (
      <div className="wf-tree-node">
        <NodeCard node={node} matchStatus={matchStatus} isSelected={isSelected} onClick={onNodeClick} />
        {node.children.map((child, idx) => {
          const childMatchStatus = child.matchStatus || child.status || 'not-taken'
          return (
            <div key={idx} className="wf-linear-child">
              <Connector taken={isTaken && (childMatchStatus === 'taken' || childMatchStatus === 'current')} />
              <TreeNode node={child} selectedNodeId={selectedNodeId} onNodeClick={onNodeClick} />
            </div>
          )
        })}
      </div>
    )
  }

  // Leaf node (outcome or step without children)
  return (
    <div className="wf-tree-node">
      <NodeCard node={node} matchStatus={matchStatus} isSelected={isSelected} onClick={onNodeClick} />
    </div>
  )
}

/**
 * Workflow Legend Component
 */
function WorkflowLegend() {
  return (
    <div className="wf-legend">
      <div className="wf-legend-item">
        <span className="wf-legend-dot taken" />
        <span>Path Taken</span>
      </div>
      <div className="wf-legend-item">
        <span className="wf-legend-dot not-taken" />
        <span>Not Taken</span>
      </div>
      <div className="wf-legend-separator" />
      <div className="wf-legend-item">
        <span className="wf-legend-icon">⚡</span>
        <span>Webhook</span>
      </div>
      <div className="wf-legend-item">
        <span className="wf-legend-icon">🔀</span>
        <span>Decision</span>
      </div>
      <div className="wf-legend-item">
        <span className="wf-legend-icon">📦</span>
        <span>Service</span>
      </div>
      <div className="wf-legend-item">
        <span className="wf-legend-icon">🤖</span>
        <span>Automation</span>
      </div>
    </div>
  )
}

/**
 * Main Workflow Visualization Component
 */
export default function WorkflowVisualization({ trace, steps, system = 'clio', selectedNodeId, onNodeSelect }) {
  const [showAll, setShowAll] = useState(true)

  // Get workflow template and match with trace data
  const matchedWorkflow = useMemo(() => {
    if (system === 'ghl') {
      // GHL uses endpoint to identify workflow, but map to invoice-specific triggers
      const triggerName = getGHLWorkflowTrigger(trace, steps)
      const template = ghlWorkflowTemplates[triggerName] || getGHLWorkflowTemplate(trace?.endpoint)
      if (!template) return null
      return matchGHLTraceToWorkflow(template, trace, steps)
    } else {
      // Clio uses triggerName
      const template = getWorkflowTemplate(trace?.triggerName)
      if (!template) return null
      return matchTraceToWorkflow(template, trace, steps)
    }
  }, [trace, steps, system])

  if (!matchedWorkflow) {
    const identifier = system === 'ghl'
      ? getGHLWorkflowTrigger(trace, steps)
      : trace?.triggerName
    return (
      <div className="wf-visualization empty">
        <div className="wf-empty-state">
          <p>No workflow template for: {identifier}</p>
        </div>
      </div>
    )
  }

  const handleNodeClick = (node) => {
    if (onNodeSelect) {
      onNodeSelect(node)
    }
  }

  return (
    <div className="wf-visualization">
      <div className="wf-header">
        <h3 className="wf-title">
          <span className="wf-title-icon">🔄</span>
          Workflow Path
        </h3>
        <div className="wf-controls">
          <label className="wf-toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            <span>Show all branches</span>
          </label>
        </div>
      </div>

      <WorkflowLegend />

      <div className={`wf-tree-container ${showAll ? 'show-all' : 'show-taken'}`}>
        <TreeNode
          node={matchedWorkflow.root}
          selectedNodeId={selectedNodeId}
          onNodeClick={handleNodeClick}
        />
      </div>
    </div>
  )
}
