import { createApp } from '../apps/api/src/app.js';
import { defaultConfig } from '../apps/api/src/config.js';

let appInstance = null;

function getApp() {
  if (!appInstance) {
    const cfg = defaultConfig();
    const { app } = createApp({ cfg });
    appInstance = app;
  }
  return appInstance;
}

export default function handler(req, res) {
  const app = getApp();
  return app(req, res);
}
