const ZIP_COORDINATES = {
  '43215': { latitude: 39.9653, longitude: -83.0061, label: 'Columbus, OH 43215' },
  '43017': { latitude: 40.0992, longitude: -83.1141, label: 'Dublin, OH 43017' },
  '44114': { latitude: 41.5055, longitude: -81.6903, label: 'Cleveland, OH 44114' },
  '10001': { latitude: 40.7506, longitude: -73.9972, label: 'New York, NY 10001' },
  '60601': { latitude: 41.8864, longitude: -87.6186, label: 'Chicago, IL 60601' },
  '94103': { latitude: 37.7725, longitude: -122.4091, label: 'San Francisco, CA 94103' },
  '90012': { latitude: 34.0614, longitude: -118.2385, label: 'Los Angeles, CA 90012' },
};

const CITY_COORDINATES = {
  'columbus,oh': { latitude: 39.9612, longitude: -82.9988, label: 'Columbus, OH' },
  'dublin,oh': { latitude: 40.0992, longitude: -83.1141, label: 'Dublin, OH' },
  'cleveland,oh': { latitude: 41.4993, longitude: -81.6944, label: 'Cleveland, OH' },
  'new york,ny': { latitude: 40.7128, longitude: -74.006, label: 'New York, NY' },
  'chicago,il': { latitude: 41.8781, longitude: -87.6298, label: 'Chicago, IL' },
  'san francisco,ca': { latitude: 37.7749, longitude: -122.4194, label: 'San Francisco, CA' },
  'los angeles,ca': { latitude: 34.0522, longitude: -118.2437, label: 'Los Angeles, CA' },
  'austin,tx': { latitude: 30.2672, longitude: -97.7431, label: 'Austin, TX' },
  'atlanta,ga': { latitude: 33.749, longitude: -84.388, label: 'Atlanta, GA' },
};

function normalizeLocation(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractZip(value) {
  const match = String(value || '').match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : '';
}

function getCityStateKey(value) {
  const normalized = normalizeLocation(value);
  if (!normalized) return '';

  const segments = normalized.split(',').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length >= 2) {
    const state = segments[1].split(' ')[0];
    if (segments[0] && state) {
      return `${segments[0]},${state}`;
    }
  }

  const compact = normalized.replace(/\s+/g, ' ');
  for (const key of Object.keys(CITY_COORDINATES)) {
    const [city, state] = key.split(',');
    if (compact.includes(city) && compact.includes(` ${state}`)) {
      return key;
    }
  }

  return '';
}

function geocodeLocation(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const zip = extractZip(raw);
  if (zip && ZIP_COORDINATES[zip]) {
    return {
      latitude: ZIP_COORDINATES[zip].latitude,
      longitude: ZIP_COORDINATES[zip].longitude,
      source: 'zip',
      label: ZIP_COORDINATES[zip].label,
    };
  }

  const cityStateKey = getCityStateKey(raw);
  if (cityStateKey && CITY_COORDINATES[cityStateKey]) {
    return {
      latitude: CITY_COORDINATES[cityStateKey].latitude,
      longitude: CITY_COORDINATES[cityStateKey].longitude,
      source: 'city',
      label: CITY_COORDINATES[cityStateKey].label,
    };
  }

  return null;
}

function haversineDistanceMiles(from, to) {
  if (!from || !to) return null;
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(to.latitude - from.latitude);
  const lngDelta = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

module.exports = {
  extractZip,
  geocodeLocation,
  haversineDistanceMiles,
  normalizeLocation,
};
