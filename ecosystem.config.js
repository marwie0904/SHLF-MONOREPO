module.exports = {
  apps: [
    {
      name: 'shlf-automations',
      cwd: './shlf-automations',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'shlf-ghl-automations',
      cwd: './shlf-ghl-automations',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G', // Higher for Puppeteer
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
  ],
};
