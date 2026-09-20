const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Shared packages use NodeNext-style `./foo.js` imports that point at `./foo.ts`.
// Metro doesn't map those, so retry relative `.js` imports without the extension.
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  // The AR package is native-only, and its own web build needs a renderer this
  // repo does not depend on. `pose.viro.ts` guards every call behind
  // `hasViro()`, so on web an empty module is exactly what the fallback wants.
  if (platform === 'web' && moduleName.startsWith('@reactvision/')) {
    return { type: 'empty' };
  }
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
