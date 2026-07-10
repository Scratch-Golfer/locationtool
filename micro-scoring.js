// Shared micro scoring logic — used by both index.html (pipeline) and quick-search.html
//
// Micro score blends two Google Places radii around a site:
//  - 100m: a tight "on the street" sample
//  - 400m: a wider neighbourhood sample
// weighted 70% / 30% respectively. This exists as one shared, named constant so the
// weighting only ever needs to change in one place. (Previously the per-site button
// scored off 400m only and the bulk recalc scored off 100m only — this file replaces both.)
var MICRO_RADIUS_WEIGHTS = {r100: 0.70, r400: 0.30};

// premium: strong affluence signal
var PREMIUM = new Set(['yoga','pilates','spa','wine_bar','golf_course','golf','fitness_center','boxing','martial_arts','rock_climbing','art_gallery','book_store','florist','bicycle_store','jewelry_store']);
// positive: moderate leisure signal
var POSITIVE = new Set(['gym','beauty_salon','cafe','coffee_shop','bar','restaurant','bakery','clothing_store','shoe_store','grocery_or_supermarket','pharmacy','movie_theater','sports_club','sporting_goods_store','juice_bar','pet_store','hair_care','night_club','cocktail_bar','wine_shop','delicatessen','organic_grocery']);
// negative: strong negative signal
var NEGATIVE = new Set(['car_repair','car_wash','car_dealer','gas_station','parking','storage','moving_company','general_contractor','laundry','funeral_home','liquor_store','casino','betting','pawn_shop','check_cashing_service','money_transfer','payday_loan','fast_food_restaurant','meal_delivery']);
// fast food chains are neg even if typed as restaurant
var FAST_FOOD_NAMES = ['mcdonald','kfc','chicken','burger king','subway','greggs','pret','costa','starbucks','nando','domino','pizza hut','papa john','five guys','shake shack','leon','wasabi','itsu'];

function cv2(types, name) {
  var t = new Set(types);
  var n = (name || '').toLowerCase();
  if (FAST_FOOD_NAMES.some(function(f) { return n.includes(f); })) return 'neg';
  if ([...t].some(function(x) { return NEGATIVE.has(x); })) return 'neg';
  if ([...t].some(function(x) { return PREMIUM.has(x); })) return 'premium';
  if ([...t].some(function(x) { return POSITIVE.has(x); })) return 'pos';
  return 'neu';
}

function vs5(pl) {
  var t = pl.reduce(function(s, p) { return s + (p.user_ratings_total || 0); }, 0);
  return t >= 15000 ? 5 : t >= 8000 ? 4 : t >= 3000 ? 3 : t >= 1000 ? 2 : 1;
}

// Intent score weights premium venues higher and uses name-based fast-food disambiguation
function intentScore(places) {
  var scored = places.filter(function(p) { return (p.user_ratings_total || 0) > 0; });
  if (!scored.length) return 1;
  var tot = scored.reduce(function(s, p) { return s + (p.user_ratings_total || 0); }, 0);
  // Weighted: premium=1.5x, pos=1.0x, neg=-0.5x, neu=0
  var wtd = scored.reduce(function(s, p) {
    var cls = cv2(p.types, p.name);
    var rev = p.user_ratings_total || 0;
    var w = cls === 'premium' ? 1.5 : cls === 'pos' ? 1.0 : cls === 'neg' ? -0.5 : 0;
    return s + rev * w;
  }, 0);
  var ratio = wtd / Math.max(tot, 1);
  return ratio >= 0.7 ? 5 : ratio >= 0.45 ? 4 : ratio >= 0.25 ? 3 : ratio >= 0.05 ? 2 : 1;
}

// Blend a scoring function's output across the 100m and 400m place lists per MICRO_RADIUS_WEIGHTS
function weightedComponent(scoreFn, pl100, pl400) {
  var s100 = scoreFn(pl100), s400 = scoreFn(pl400);
  return Math.min(5, Math.max(1, Math.round(s100 * MICRO_RADIUS_WEIGHTS.r100 + s400 * MICRO_RADIUS_WEIGHTS.r400)));
}
function weightedVol(pl100, pl400) { return weightedComponent(vs5, pl100, pl400); }
function weightedIntent(pl100, pl400) { return weightedComponent(intentScore, pl100, pl400); }
