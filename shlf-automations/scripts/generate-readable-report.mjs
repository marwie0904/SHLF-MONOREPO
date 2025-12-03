#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get report file from command line argument
const reportFile = process.argv[2];

if (!reportFile) {
  console.error('Usage: node generate-readable-report.mjs <report-file.json>');
  process.exit(1);
}

// Read the JSON report
const reportPath = join(__dirname, '..', reportFile);
const reportData = JSON.parse(await fs.readFile(reportPath, 'utf-8'));

// Generate HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Validation Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f7fa;
      padding: 20px;
      line-height: 1.6;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 8px 8px 0 0;
    }

    .header h1 {
      font-size: 28px;
      margin-bottom: 10px;
    }

    .header-info {
      opacity: 0.9;
      font-size: 14px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      padding: 30px;
      border-bottom: 1px solid #e0e0e0;
    }

    .summary-card {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 6px;
      border-left: 4px solid #667eea;
    }

    .summary-card h3 {
      font-size: 14px;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .summary-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #333;
    }

    .config-section {
      margin: 30px;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      overflow: hidden;
    }

    .config-header {
      background: #667eea;
      color: white;
      padding: 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .config-header:hover {
      background: #5568d3;
    }

    .config-header h2 {
      font-size: 20px;
    }

    .config-stats {
      display: flex;
      gap: 30px;
      font-size: 14px;
      opacity: 0.95;
    }

    .config-content {
      padding: 20px;
    }

    .stage-card {
      margin-bottom: 20px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
    }

    .stage-header {
      background: #f8f9fa;
      padding: 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e0e0e0;
    }

    .stage-header.has-tasks {
      background: #e8f5e9;
      border-left: 4px solid #4caf50;
    }

    .stage-header.no-tasks {
      background: #fff3e0;
      border-left: 4px solid #ff9800;
    }

    .stage-header.error {
      background: #ffebee;
      border-left: 4px solid #f44336;
    }

    .stage-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .stage-name {
      font-weight: 600;
      font-size: 16px;
      color: #333;
    }

    .stage-id {
      color: #666;
      font-size: 12px;
      background: white;
      padding: 2px 8px;
      border-radius: 3px;
    }

    .stage-type {
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 3px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .stage-type.meeting {
      background: #e3f2fd;
      color: #1976d2;
    }

    .stage-type.non-meeting {
      background: #f3e5f5;
      color: #7b1fa2;
    }

    .stage-type.probate {
      background: #fff3e0;
      color: #f57c00;
    }

    .stage-badge {
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 3px;
      font-weight: 600;
    }

    .badge-success {
      background: #4caf50;
      color: white;
    }

    .badge-warning {
      background: #ff9800;
      color: white;
    }

    .badge-error {
      background: #f44336;
      color: white;
    }

    .tasks-list {
      padding: 15px;
      background: white;
    }

    .task-item {
      padding: 12px;
      margin-bottom: 8px;
      background: #f8f9fa;
      border-radius: 4px;
      border-left: 3px solid #667eea;
    }

    .task-name {
      font-weight: 500;
      color: #333;
      margin-bottom: 6px;
    }

    .task-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 10px;
      font-size: 13px;
      color: #666;
    }

    .task-detail {
      display: flex;
      gap: 5px;
    }

    .task-detail-label {
      font-weight: 600;
      color: #555;
    }

    .error-message {
      padding: 15px;
      background: #ffebee;
      color: #c62828;
      font-size: 14px;
      border-radius: 4px;
      margin: 15px;
    }

    .no-tasks-message {
      padding: 15px;
      background: #fff3e0;
      color: #e65100;
      font-size: 14px;
      text-align: center;
      margin: 15px;
    }

    .toggle-icon {
      transition: transform 0.3s;
    }

    .toggle-icon.open {
      transform: rotate(180deg);
    }

    @media print {
      body {
        background: white;
      }

      .config-section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 Task Generation Validation Report</h1>
      <div class="header-info">
        <div>Matter ID: ${reportData.test_matter_id}</div>
        <div>Test Started: ${new Date(reportData.start_time).toLocaleString()}</div>
        <div>Test Ended: ${new Date(reportData.end_time).toLocaleString()}</div>
        <div>Duration: ${Math.round((new Date(reportData.end_time) - new Date(reportData.start_time)) / 1000 / 60)} minutes</div>
      </div>
    </div>

    <div class="summary">
      <div class="summary-card">
        <h3>Total Configurations</h3>
        <div class="value">${reportData.overall_summary.total_configs}</div>
      </div>
      <div class="summary-card">
        <h3>Stages per Config</h3>
        <div class="value">${reportData.overall_summary.total_stages_per_config}</div>
      </div>
      <div class="summary-card">
        <h3>Total Test Runs</h3>
        <div class="value">${reportData.overall_summary.total_test_runs}</div>
      </div>
      <div class="summary-card">
        <h3>Total Tasks Generated</h3>
        <div class="value">${reportData.configurations.reduce((sum, cfg) => sum + cfg.summary.total_tasks_generated, 0)}</div>
      </div>
    </div>

    ${reportData.configurations.map((config, configIndex) => `
      <div class="config-section">
        <div class="config-header" onclick="toggleConfig(${configIndex})">
          <div>
            <h2>${config.config_name}</h2>
            <div style="font-size: 14px; margin-top: 5px; opacity: 0.9;">
              Location: ${config.location_id} | Attorney: ${config.attorney_id}
            </div>
          </div>
          <div class="config-stats">
            <span>✅ ${config.summary.stages_with_tasks} with tasks</span>
            <span>⚠️ ${config.summary.stages_without_tasks} no tasks</span>
            <span>❌ ${config.summary.stages_with_errors} errors</span>
            <span>📊 ${config.summary.total_tasks_generated} total tasks</span>
            <span class="toggle-icon" id="toggle-${configIndex}">▼</span>
          </div>
        </div>

        <div class="config-content" id="config-${configIndex}" style="display: none;">
          ${config.results.map(stage => {
            const hasError = stage.error !== null;
            const hasTasks = stage.tasks_generated.length > 0;
            const statusClass = hasError ? 'error' : (hasTasks ? 'has-tasks' : 'no-tasks');
            const badge = hasError ? 'badge-error' : (hasTasks ? 'badge-success' : 'badge-warning');
            const badgeText = hasError ? 'ERROR' : (hasTasks ? `${stage.tasks_generated.length} TASKS` : 'NO TASKS');

            return `
              <div class="stage-card">
                <div class="stage-header ${statusClass}">
                  <div class="stage-title">
                    <span class="stage-name">${stage.stage_name}</span>
                    <span class="stage-id">ID: ${stage.stage_id}</span>
                    <span class="stage-type ${stage.stage_type}">${stage.stage_type}</span>
                    ${stage.calendar_event_id ? `<span class="stage-id">📅 Event: ${stage.calendar_name}</span>` : ''}
                  </div>
                  <span class="stage-badge ${badge}">${badgeText}</span>
                </div>

                ${hasError ? `
                  <div class="error-message">
                    ❌ Error: ${stage.error}
                  </div>
                ` : hasTasks ? `
                  <div class="tasks-list">
                    ${stage.tasks_generated.map((task, idx) => `
                      <div class="task-item">
                        <div class="task-name">${idx + 1}. ${task.task_name}</div>
                        <div class="task-details">
                          <div class="task-detail">
                            <span class="task-detail-label">ID:</span>
                            <span>${task.task_id}</span>
                          </div>
                          <div class="task-detail">
                            <span class="task-detail-label">Assignee:</span>
                            <span>${task.assignee_name} (${task.assignee_id || 'N/A'})</span>
                          </div>
                          <div class="task-detail">
                            <span class="task-detail-label">Due:</span>
                            <span>${task.due_at || 'No due date'}</span>
                          </div>
                          <div class="task-detail">
                            <span class="task-detail-label">Status:</span>
                            <span>${task.status}</span>
                          </div>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                ` : `
                  <div class="no-tasks-message">
                    ⚠️ No tasks were generated for this stage
                  </div>
                `}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('')}
  </div>

  <script>
    function toggleConfig(index) {
      const content = document.getElementById('config-' + index);
      const toggle = document.getElementById('toggle-' + index);

      if (content.style.display === 'none') {
        content.style.display = 'block';
        toggle.classList.add('open');
      } else {
        content.style.display = 'none';
        toggle.classList.remove('open');
      }
    }

    // Open first config by default
    toggleConfig(0);
  </script>
</body>
</html>`;

// Save HTML report
const htmlPath = reportPath.replace('.json', '.html');
await fs.writeFile(htmlPath, html);

console.log('\n✅ Human-readable report generated!');
console.log(`📄 Report: ${htmlPath}`);
console.log(`\n💡 Open in browser: open "${htmlPath}"\n`);
