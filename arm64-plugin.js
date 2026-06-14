// arm64-plugin.js — shrink the sideload APK to arm64-v8a only (~1/3 the size of the
// universal build, ~140MB → ~50MB). Gated on ARM64_ONLY=1, so it's a NO-OP for every
// other build — importantly a Play Store .aab (production), which must keep all ABIs
// for Google to split per device.
//
//   EAS:    eas build -p android --profile preview-arm64       (env set in eas.json)
//   Local:  $env:ARM64_ONLY='1'; npx expo run:android --variant release
//
// Trade-off: an arm64-only APK won't install on x86 emulators or (vanishingly rare)
// 32-bit-only phones. Every real modern Android device is arm64. Test on a physical
// phone or an arm64 emulator image; use the normal universal build for x86 emulators.
const { withGradleProperties, withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withArm64Only(config) {
  if (process.env.ARM64_ONLY !== '1') return config;

  // 1) Build only the arm64 native libs (RN / Hermes / reanimated / etc.). This is
  //    the bulk of the size win, and it speeds the build up too.
  config = withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const idx = props.findIndex((p) => p.type === 'property' && p.key === 'reactNativeArchitectures');
    if (idx >= 0) props[idx].value = 'arm64-v8a';
    else props.push({ type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' });
    return cfg;
  });

  // 2) Belt-and-suspenders: filter the packaged .so files to arm64, so any dependency
  //    that ships prebuilt all-ABI binaries gets trimmed from the final APK too.
  config = withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('abiFilters')) {
      const m = src.match(/\n([ \t]*)defaultConfig\s*\{/);
      if (m) {
        const ind = m[1] + '    ';
        const block = `\n${ind}ndk {\n${ind}    abiFilters "arm64-v8a"\n${ind}}`;
        src = src.replace(m[0], m[0] + block);
        cfg.modResults.contents = src;
      }
    }
    return cfg;
  });

  return config;
};
