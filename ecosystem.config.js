module.exports = {
  apps: [
    {
      name: 'file-transfer-service',
      cwd: '/srv/file-transfer-service/current',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
