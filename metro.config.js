// The demo video tool (demo/) has its own node_modules (Remotion, React for the renderer): Metro must not crawl it.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const demo = /[/\\]demo[/\\].*/;
const block = config.resolver.blockList;
config.resolver.blockList = Array.isArray(block) ? [...block, demo] : block ? [block, demo] : [demo];

module.exports = config;
