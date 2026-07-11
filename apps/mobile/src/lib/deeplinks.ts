import { Alert, Linking, Platform } from 'react-native';
import { serviceById } from '@watchly/shared';

/**
 * Opens a title in its streaming app.
 *
 * We can't deep-link to a *specific title* reliably: TMDB gives us the provider,
 * not the provider's own content id, and each service uses a different id space.
 * So we open the app itself and fall back to a web search on the service's site,
 * which is the honest best available — better than a dead tap.
 *
 * The spec is right that this is the punchline, and it MUST be tested on real
 * devices: iOS silently refuses to open a scheme that isn't declared in
 * LSApplicationQueriesSchemes, and canOpenURL will return false even when the app
 * is installed. Those entries are in app.json.
 */
export async function openInService(serviceId: string, titleName: string): Promise<void> {
  const service = serviceById(serviceId);
  if (!service) return;

  const appUrl = Platform.select({
    ios: service.iosScheme,
    android: `intent://#Intent;package=${service.androidPackage};end`,
    default: service.iosScheme,
  });

  try {
    if (appUrl && (await Linking.canOpenURL(appUrl))) {
      await Linking.openURL(appUrl);
      return;
    }
  } catch {
    // canOpenURL throws rather than returning false on some Android configs.
  }

  // App isn't installed (or won't admit it) — fall back to the web.
  const web = `https://www.google.com/search?q=${encodeURIComponent(
    `${titleName} ${service.label} watch`,
  )}`;

  try {
    await Linking.openURL(web);
  } catch {
    Alert.alert('Could not open', `Search for "${titleName}" on ${service.label}.`);
  }
}
