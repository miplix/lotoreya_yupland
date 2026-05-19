import type { NextConfig } from 'next';

// basePath='/lotoreya' — приложение деплоится отдельно и проксируется в
// service.yupland.io/lotoreya через vercel.json-rewrites в golden-drop.
// Все внутренние Link/asset-URL автоматически получат префикс.
const nextConfig: NextConfig = {
  basePath: '/lotoreya',
  assetPrefix: '/lotoreya',
};

export default nextConfig;
