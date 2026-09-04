// Required because this app lives in an npm workspace.
//
// npm hoists shared dependencies to the repo root, and Metro's resolver is the
// classic casualty: it only looks in the project's own node_modules and stops.
// The three settings below tell it to watch the whole workspace and to look in
// both module directories.
//
// ESCAPE HATCH: if Metro keeps fighting (a stubborn "Unable to resolve module"
// that is definitely installed), remove "apps/mobile" from the `workspaces`
// array in the root package.json and run `npm install` inside apps/mobile. It
// then keeps its own complete node_modules. That costs disk and changes nothing
// else about the app.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Without this, Metro walks up the tree on its own and can pick a second copy
// of react out of a nested node_modules.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
