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
// Do NOT set resolver.disableHierarchicalLookup = true here. As of SDK 58 npm
// installs expo-modules-core nested inside node_modules/expo, and disabling the
// hierarchical lookup stops Metro from finding it ("Unable to resolve
// expo-modules-core"). The duplicate-react risk it guarded against is handled by
// keeping one react/react-native version across the workspace (`npm dedupe`;
// `npm ls react react-native` should show a single copy of each).

module.exports = config;
