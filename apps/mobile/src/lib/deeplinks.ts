import { Alert, Linking, Platform } from 'react-native';
import { serviceById } from '@watchly/shared';

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
