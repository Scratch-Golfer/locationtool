// Shared macro scoring — used by index.html (pipeline), triage.html (site triage), and
// quick-search.html. Calls the shared `score-macro` Supabase Edge Function rather than
// keeping a local copy of the benchmarks/weights/formula, so every page and the automated
// Rightmove ingestion pipeline (parse-rightmove-email) always score against the exact same
// formula — no risk of the two silently drifting apart after a future benchmark tweak.
//
// Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` to already be defined as globals in the
// page before this script runs (both already are, in every page that includes this file).
//
// Homedata API calls are NOT increased by this change: score-macro checks the same
// `postcode_data` table cache before ever calling Homedata, so repeat lookups for a
// postcode already seen (by this page, another page, or the automated pipeline) cost
// nothing beyond a fast Supabase round trip.

var _pcCache = {}; // session-level cache — avoids even that round trip twice in one page load

async function scoreMacroRemote(pc) {
  var key = pc.trim().toUpperCase().replace(/\s+/g, '');
  if (_pcCache[key]) return _pcCache[key];

  try {
    var res = await fetch(SUPABASE_URL + '/functions/v1/score-macro', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY},
      body: JSON.stringify({postcode: pc})
    });
    var result = await res.json();
    if (result.error) return null; // e.g. postcode not found in Homedata
    _pcCache[key] = result; // {score, reasoning, data}
    return result;
  } catch (e) {
    console.warn('score-macro call failed:', e);
    return null;
  }
}
