/**
 * Expo SDK 52 + expo-router.
 *
 * `babel-preset-expo` SDK 50'den beri expo-router'ın gerektirdiği dönüşümleri
 * (react-native-reanimated dâhil) kendisi kurar; ayrıca eklenti eklenmez.
 * `@/*` yol takma adı Metro tarafında tsconfig `paths` üzerinden çözülür.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "react" }]],
  };
};
