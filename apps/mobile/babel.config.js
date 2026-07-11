module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 ships its worklet transform in react-native-worklets.
    // Must stay last in the plugin list.
    plugins: ['react-native-worklets/plugin'],
  };
};
