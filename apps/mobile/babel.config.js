module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets/plugin must be last. It replaces
    // react-native-reanimated/plugin from Reanimated 4 on.
    plugins: ['react-native-worklets/plugin'],
  };
};
