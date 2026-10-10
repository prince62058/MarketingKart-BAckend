const KEY_GROUPS = ['cities', 'regions', 'zips'];
function number(value, label, min, max) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error(`${label} is required`);
  const n = Number(value);
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return n;
}
function normalizeGeo(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Select a target location');
  const allowed = ['coordinates', 'custom_locations', 'countries', ...KEY_GROUPS];
  if (Object.keys(data).some(k => !allowed.includes(k))) throw new Error('Unsupported location targeting field');
  const geo = {};
  for (const group of KEY_GROUPS) {
    if (data[group] !== undefined && !Array.isArray(data[group])) throw new Error(`Invalid ${group}`);
    if (!data[group]?.length) continue;
    geo[group] = data[group].map(item => {
      const key = String(item?.key || '').trim();
      if (!key || !/^[A-Za-z0-9:_-]+$/.test(key)) throw new Error(`Invalid Meta ${group} key`);
      if (Object.keys(item).some(k => !['key', 'radius', 'distance_unit'].includes(k))) throw new Error(`Unsupported ${group} field`);
      if (group !== 'cities' && (item.radius !== undefined || item.distance_unit !== undefined)) throw new Error('State/PIN targeting cannot have a radius');
      if (group === 'cities') {
        // City-only is explicit; never allow an implicit surrounding radius.
        if (item.radius !== undefined && Number(item.radius) !== 0) throw new Error('Use Pin + radius for a radius area');
        return { key, radius: 0, distance_unit: 'kilometer' };
      }
      return { key };
    });
    geo[group] = [...new Map(geo[group].map(x => [x.key, x])).values()];
  }
  if (data.countries !== undefined) {
    if (!Array.isArray(data.countries) || data.countries.some(c => typeof c !== 'string' || !/^[A-Za-z]{2}$/.test(c))) throw new Error('Invalid country code');
    if (data.countries.length) geo.countries = [...new Set(data.countries.map(c => c.toUpperCase()))];
  }
  if (data.coordinates && data.custom_locations) throw new Error('Use one pin location format');
  const pins = data.coordinates ?? data.custom_locations;
  if (pins !== undefined) {
    if (!Array.isArray(pins)) throw new Error('Invalid pin locations');
    if (pins.length) geo.custom_locations = pins.map(pin => {
      const unit = pin.distance_unit || pin.radiusUnit || 'kilometer'; // old mobile builds already send km
      if (!['kilometer', 'km'].includes(unit)) throw new Error('Pin radius must be explicitly in kilometres');
      return {
        latitude: number(pin.latitude, 'Latitude', -90, 90),
        longitude: number(pin.longitude, 'Longitude', -180, 180),
        radius: number(pin.radius, 'Radius (km)', 17, 80),
        distance_unit: 'kilometer',
      };
    });
  }
  if (!Object.keys(geo).length) throw new Error('Select at least one target location');
  if (geo.countries && Object.keys(geo).length > 1) throw new Error('Whole-country targeting cannot be combined with local areas');
  return geo;
}
function hasUsableGeoTarget(geo) {
  return ['custom_locations', 'countries', ...KEY_GROUPS].some(k => Array.isArray(geo?.[k]) && geo[k].length > 0);
}
// Compare delivery semantics, ignoring Meta-added names/region metadata and harmless rounding.
function assertGeoMatches(expected, actual) {
  if (!actual) throw new Error('Meta did not return saved location targeting');
  for (const group of ['countries', ...KEY_GROUPS]) {
    const keys = rows => (rows || []).map(x => group === 'countries' ? String(x).toUpperCase() : String(x.key)).sort();
    if (JSON.stringify(keys(expected[group])) !== JSON.stringify(keys(actual[group]))) throw new Error(`Meta location mismatch: ${group}`);
  }
  for (const city of actual.cities || []) {
    if (city.radius !== undefined && Number(city.radius) !== 0) throw new Error('Meta expanded the selected city radius');
  }
  const expectedPins = expected.custom_locations || [];
  const remaining = [...(actual.custom_locations || [])];
  if (expectedPins.length !== remaining.length) throw new Error('Meta location mismatch: pins');
  for (const pin of expectedPins) {
    const i = remaining.findIndex(p => ['kilometer', 'mile'].includes(p.distance_unit) && Math.abs(Number(p.latitude) - pin.latitude) <= 0.00001 && Math.abs(Number(p.longitude) - pin.longitude) <= 0.00001 && Math.abs(Number(p.radius) * (p.distance_unit === 'mile' ? 1.609344 : 1) - pin.radius) <= 0.001);
    if (i < 0) throw new Error('Meta changed the selected pin or radius');
    remaining.splice(i, 1);
  }
  const extraGroups = Object.entries(actual).filter(([k, v]) => !['countries', ...KEY_GROUPS, 'custom_locations', 'location_types', 'location_expansion'].includes(k) && Array.isArray(v) && v.length);
  if (extraGroups.length || actual.location_expansion === true || actual.location_expansion?.enabled === true) throw new Error('Meta returned additional location targeting');
}
module.exports = { normalizeGeo, hasUsableGeoTarget, assertGeoMatches };
