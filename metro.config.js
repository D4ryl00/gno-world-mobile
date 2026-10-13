// The demo video tool (demo/) has its own node_modules (Remotion, React for the renderer): Metro must not crawl it.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// only this project's demo/, not a package's own demo/ folder in node_modules
const demo = new RegExp(`^${path.join(__dirname, 'demo').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\].*`);
const block = config.resolver.blockList;
config.resolver.blockList = Array.isArray(block) ? [...block, demo] : block ? [block, demo] : [demo];

module.exports = config;
