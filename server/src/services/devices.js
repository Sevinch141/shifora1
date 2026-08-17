/**
 * Device integration surface.
 *
 * The MVP records measurements entered by hand — the platform itself does not
 * measure anything. This registry exists so that a real glucometer, CGM or
 * wearable integration can be added later without changing the data model or
 * the routes: a provider implements `pull()` and returns readings that are
 * stored with `source` set to its own key instead of 'manual'.
 *
 * No provider is registered in the MVP. Nothing here fabricates device data.
 */

/**
 * @typedef {Object} DeviceProvider
 * @property {string} key                     - stored in readings.source
 * @property {'glucose'|'blood_pressure'} kind
 * @property {(patientId: number, since: string) => Promise<Array<object>>} pull
 */

const providers = new Map();

export function registerDeviceProvider(provider) {
  providers.set(provider.key, provider);
}

export function getDeviceProvider(key) {
  return providers.get(key);
}

export function listDeviceProviders() {
  return [...providers.values()].map(({ key, kind }) => ({ key, kind }));
}

/** True when a real integration is available for the given source key. */
export function isIntegrationAvailable(key) {
  return providers.has(key);
}
