// gradle-network-plugin.js — make dependency resolution resilient to slow Maven hosts.
//
// Why this exists: @notifee/react-native declares its native lib with a DYNAMIC version
// (app.notifee:core:+). The "+" forces Gradle to enumerate versions across EVERY repo in
// android/build.gradle's allprojects block — including jitpack.io. notifee's core is
// actually bundled locally (node_modules/@notifee/react-native/android/libs), so jitpack
// hosts none of it — but it's queried anyway, and when it's slow the metadata fetch blows
// past Gradle's default ~30s socket timeout. The whole build then dies with:
//   Could not resolve app.notifee:core:+ > ... maven-metadata.xml > Read timed out
//
// Bumping the HTTP timeouts gives a sluggish repo room to answer (a fast 404, usually)
// instead of failing the build. Ungated — applies to EVERY build (sideload APK and the
// future Play AAB). Structured gradle.properties edit only; no build.gradle string surgery.
const { withGradleProperties } = require('@expo/config-plugins');

const TIMEOUTS = {
  'systemProp.org.gradle.internal.http.connectionTimeout': '120000',
  'systemProp.org.gradle.internal.http.socketTimeout': '120000',
};

module.exports = function withGradleNetworkTimeouts(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(TIMEOUTS)) {
      const idx = cfg.modResults.findIndex(
        (p) => p.type === 'property' && p.key === key
      );
      if (idx >= 0) cfg.modResults[idx].value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
