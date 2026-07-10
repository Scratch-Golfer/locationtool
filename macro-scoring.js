// Shared macro scoring logic — used by both index.html (pipeline) and triage.html (site triage)
// Requires `db` (Supabase client) and `HK` (Homedata API key) to already be defined
// as globals in the page before this script is loaded.

var BENCH = {professionals:66, age_30_44:40, age_16_29:26, private_rent:39.8, social_rent:4.25, deprivation:4, abs_professionals:7100};
var WEIGHTS = {professionals:.30, age_30_44:.12, age_16_29:.08, deprivation:.22, private_rent:.08, social_rent:.05, abs_professionals:.15};
var THR = [[1.10,1.00],[0.90,0.80],[0.75,0.55],[0.55,0.30],[0.00,0.05]];

// Postcode cache — avoids duplicate Homedata calls within a session
var _pcCache = {};

async function fetchHomedata(pc) {
  var key = pc.trim().toUpperCase().replace(/\s+/g, '');
  // 1. Session cache
  if (_pcCache[key]) return _pcCache[key];
  // 2. Supabase postcode_data table
  try {
    var {data: stored} = await db.from('postcode_data').select('demographics').eq('postcode', key).single();
    if (stored && stored.demographics) {
      _pcCache[key] = stored.demographics;
      return stored.demographics;
    }
  } catch (e) {}
  // 3. Homedata API (last resort)
  var ep = encodeURIComponent(pc);
  var [dr, pr] = await Promise.all([
    fetch('https://api.homedata.co.uk/api/demographics/?postcode=' + ep, {headers: {'Authorization': 'Api-Key ' + HK}}),
    fetch('https://api.homedata.co.uk/api/deprivation/?postcode=' + ep, {headers: {'Authorization': 'Api-Key ' + HK}})
  ]);
  var dem = await dr.json(); var dep = await pr.json();
  if (dem.error) return null;
  var pop = parseFloat((dem.population || {}).total || 0);
  var _msoaCode = (dem.geography || {}).msoa_code || null;
  var d = {
    professionals: parseFloat((dem.occupation || {}).managerial_professional_pct || 0),
    age_30_44: parseFloat((dem.age || {}).age_30_44_pct || 0),
    age_16_29: parseFloat((dem.age || {}).age_16_29_pct || 0),
    private_rent: parseFloat((dem.tenure || {}).private_rented_pct || 0),
    social_rent: parseFloat((dem.tenure || {}).social_rented_pct || 0),
    deprivation: parseFloat(((dep.overall) || {}).score || 4),
    population: pop, // MSOA-level population
    abs_professionals: Math.round(pop * (parseFloat((dem.occupation || {}).managerial_professional_pct || 0) / 100)),
    msoa_code: _msoaCode
  };
  // Save to postcode_data table for future use
  try {
    await db.from('postcode_data').upsert({postcode: key, demographics: d, msoa_code: (_msoaCode || null), fetched_at: new Date().toISOString()});
  } catch (e) { console.warn('Failed to save postcode_data:', e); }
  _pcCache[key] = d;
  return d;
}

function gss(r) {
  for (var i = 0; i < THR.length; i++) if (r >= THR[i][0]) return THR[i][1];
  return 0.05;
}

function cmw(d) {
  var W = 0, usedWt = 0;
  Object.keys(WEIGHTS).forEach(function(k) {
    var v = d[k]; if (v == null) return;
    var b = BENCH[k];
    W += WEIGHTS[k] * gss(k !== 'social_rent' ? (v / b) : (b / Math.max(v, 0.1)));
    usedWt += WEIGHTS[k];
  });
  return usedWt > 0 ? W / usedWt : 0;
}

function calcMacroScore(d) {
  var W = cmw(d);
  var score = Math.min(5, Math.max(1, Math.round((1 + W * 4) * 10) / 10));
  var rsn = 'Professionals ' + d.professionals.toFixed(0) + '% (' + (d.professionals >= 59 ? 'above' : 'below') + ' 66% bench). Age 25-44: ' + (d.age_30_44 + d.age_16_29).toFixed(0) + '%. Social rent: ' + d.social_rent.toFixed(1) + '%.';
  return {score: score, reasoning: rsn, data: d};
}

function recalcFromStoredData(storedJson) {
  // Recalculate score from stored macro_score_data without any API call
  try {
    var d = JSON.parse(storedJson);
    if (!d || !d.professionals) return null;
    return calcMacroScore(d);
  } catch (e) { return null; }
}
