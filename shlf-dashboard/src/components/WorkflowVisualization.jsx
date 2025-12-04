import { useState, useMemo } from 'react'
import { getWorkflowTemplate, matchTraceToWorkflow } from '../config/workflowTemplates'

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
function NodeCard({ node, nodeStatus, isSelected, onClick }) {
  const isTaken = nodeStatus === 'taken' || nodeStatus === 'current'
  const icon = getNodeIcon(node)

  return (
    <div
      className={`wf-node ${node.type} ${nodeStatus} ${isSelected ? 'selected' : ''}`}
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
  const nodeStatus = node.status || 'not-taken'
  const isTaken = nodeStatus === 'taken' || nodeStatus === 'current'
  const isSelected = selectedNodeId === node.id

  // For decision nodes, render branches side by side
  if (node.type === 'decision' && node.children && node.children.length > 0) {
    return (
      <div className="wf-tree-node">
        <NodeCard node={node} nodeStatus={nodeStatus} isSelected={isSelected} onClick={onNodeClick} />
        <Connector taken={isTaken} />

        {/* Horizontal line spanning all branches */}
        <div className="wf-branch-container">
          <div className={`wf-branch-line ${isTaken ? 'taken' : ''}`} />

          <div className="wf-branches">
            {node.children.map((branch, idx) => {
              const branchTaken = branch.node.status === 'taken' || branch.node.status === 'current'
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
          <NodeCard node={node} nodeStatus={nodeStatus} isSelected={isSelected} onClick={onNodeClick} />
          <Connector taken={isTaken} />
          <div className="wf-branch-container">
            <div className={`wf-branch-line ${isTaken ? 'taken' : ''}`} />
            <div className="wf-branches">
              {node.children.map((branch, idx) => {
                const branchTaken = branch.node.status === 'taken' || branch.node.status === 'current'
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
        <NodeCard node={node} nodeStatus={nodeStatus} isSelected={isSelected} onClick={onNodeClick} />
        {node.children.map((child, idx) => (
          <div key={idx} className="wf-linear-child">
            <Connector taken={isTaken && (child.status === 'taken' || child.status === 'current')} />
            <TreeNode node={child} selectedNodeId={selectedNodeId} onNodeClick={onNodeClick} />
          </div>
        ))}
      </div>
    )
  }

  // Leaf node (outcome or step without children)
  return (
    <div className="wf-tree-node">
      <NodeCard node={node} nodeStatus={nodeStatus} isSelected={isSelected} onClick={onNodeClick} />
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
export default function WorkflowVisualization({ trace, steps, selectedNodeId, onNodeSelect }) {
  const [showAll, setShowAll] = useState(true)

  // Get workflow template and match with trace data
  const matchedWorkflow = useMemo(() => {
    const template = getWorkflowTemplate(trace?.triggerName)
    if (!template) return null
    return matchTraceToWorkflow(template, trace, steps)
  }, [trace, steps])

  if (!matchedWorkflow) {
    return (
      <div className="wf-visualization empty">
        <div className="wf-empty-state">
          <p>No workflow template for: {trace?.triggerName}</p>
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
