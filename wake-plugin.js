const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withWakeScreen(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;
    
    // Find the main screen of the app
    const mainActivity = androidManifest.application[0].activity.find(
      (a) => a.$['android:name'] === '.MainActivity'
    );
    
    // Inject the God Mode lockscreen bypass tags
    if (mainActivity) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
    }
    
    return config;
  });
};