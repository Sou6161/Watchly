const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Metro doesn't look outside the app directory by default, so in a workspace it
// has to be told where the hoisted node_modules and the sibling @watchly/shared
// source actually live.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Hierarchical lookup stays ON. The Expo monorepo guide suggests disabling it,
// but that assumes npm hoists every package to the root. It doesn't: when
// versions conflict, npm nests them (expo-asset lives inside expo/node_modules).
// With lookup disabled Metro only searches nodeModulesPaths and never walks into
// a package's own node_modules, so those nested deps become unresolvable.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
