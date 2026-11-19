import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import dotenv from 'dotenv';

dotenv.config({path : '../.env'}); // load env vars from .env

const browserSettingNames = [
  'BACKEND_API_BASE',
  'FRONTEND_VITE_AUTH',
  'VITE_REALM',
  'VITE_CLIENT'
] as const;
export default defineConfig({
  // depending on your application, base can also be "/"
  base: '',
  plugins: [react()],
  envPrefix: [],
  preview: {
    allowedHosts: ['.mitre.org', '.elb.us-east-1.amazonaws.com'],
  },
  define: Object.fromEntries(
    browserSettingNames.map(settingName => [
      'import.meta.env.' + settingName,
      JSON.stringify(process.env[settingName]) ?? 'undefined'
    ])
  ),
  server: {
    port: parseInt(process.env.FRONTEND_PORT!),
    open: false,
    host: true,
    allowedHosts: ['.mitre.org', '.elb.us-east-1.amazonaws.com']
  }
});
