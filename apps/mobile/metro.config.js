const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The calculation engine and types are shared with the API, and the API's business routes
// run on the phone against its own database when there is no connection.
config.watchFolders = [
  path.resolve(__dirname, '../../packages/shared'),
  path.resolve(__dirname, '../api/src'),
  path.resolve(__dirname, '../api/node_modules/zod'),
];

// expo-sqlite on web runs SQLite as WebAssembly and needs SharedArrayBuffer.
if (!config.resolver.assetExts.includes('wasm')) config.resolver.assetExts.push('wasm');
const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhanced = enhanceMiddleware ? enhanceMiddleware(middleware, metroServer) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return enhanced(req, res, next);
  };
};

module.exports = config;
