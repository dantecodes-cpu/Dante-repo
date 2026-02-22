// AnimeX Provider for Nuvio
// Logic: Ported encryption + AniList metadata
// Architecture: v31.0 Stable Fetch Engine

var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b2) => {
  for (var prop in b2 || (b2 = {}))
    if (__hasOwnProp.call(b2, prop))
      __defNormalProp(a, prop, b2[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b2)) {
      if (__propIsEnum.call(b2, prop))
        __defNormalProp(a, prop, b2[prop]);
    }
  return a;
};
var __spreadProps = (a, b2) => __defProps(a, __getOwnPropDescs(b2));
var __async = (e, n, t) => new Promise((r, o) => {
  var c = u => { try { l(t.next(u)) } catch (a) { o(a) } };
  var s = u => { try { l(t.throw(u)) } catch (a) { o(a) } };
  var l = u => u.done ? r(u.value) : Promise.resolve(u.value).then(c, s);
  l((t = t.apply(e, n)).next());
});

console.log("[AnimeX] Initializing v2.0");

const TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
const BASE_URL = "https://animex.one";
const ANILIST_API = "https://graphql.anilist.co/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── HTTP WRAPPER ───────────────────────────────────────────────────────────
function request(url, opts = {}) {
  return __async(this, null, function*() {
    const headers = __spreadValues({
      "User-Agent": UA,
      "Referer": BASE_URL + "/",
      "X-Requested-With": "XMLHttpRequest"
    }, opts.headers || {});
    
    try {
      const res = yield fetch(url, __spreadProps(__spreadValues({}, opts), { headers }));
      return res;
    } catch (e) {
      console.log(`[AnimeX] Connection Error: ${e.message}`);
      throw e;
    }
  });
}

// ─── ENCRYPTION UTILS (AnimeX Proprietary) ──────────────────────────────────
var KEY = new Uint8Array([1, 83, 160, 158, 58, 198, 82, 210, 133, 247, 202, 33, 80, 94, 227, 179, 162, 130, 9, 101, 19, 111, 180, 220, 156, 145, 144, 6, 150, 65, 25, 14]);
var AT = new Uint8Array([166, 215, 77, 130, 106, 46, 255, 237, 4, 39, 65, 214, 6, 17, 101, 113, 101, 252, 253, 240, 204, 202, 234, 19, 69, 132, 45, 76, 82, 15, 17, 205, 14, 190, 42, 67, 116, 216, 73, 243, 79, 171, 41, 4, 233, 158, 71, 45, 3, 227, 49, 8, 130, 167, 70, 179, 211, 169, 152, 21, 255, 230, 7, 100]);
var AU = new Uint8Array([38, 87, 230, 128, 78, 56, 110, 153, 220, 39, 166, 236, 176, 8, 95, 103, 21, 153, 47, 238, 168, 225, 185, 232, 198, 117, 74, 158, 160, 219, 128, 105, 70, 224, 21, 162, 220, 23, 217, 99, 14, 142, 214, 41, 71, 216, 230, 252]);

function encrypt(data) {
  return __async(this, null, function*() {
    // Note: AnimeX requires SubtleCrypto for AES-GCM. 
    // This part remains as a bridge between the site's security and Nuvio.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = yield crypto.subtle.importKey("raw", KEY, { name: "AES-GCM" }, false, ["encrypt"]);
    const encoded = new TextEncoder().encode(data);
    const result = yield crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
    
    const combined = new Uint8Array(iv.length + result.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(result), iv.length);
    
    return btoa(String.fromCharCode.apply(null, combined))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  });
}

// ─── ANILIST SEARCH ─────────────────────────────────────────────────────────
function animeSearch(query) {
  return __async(this, null, function*() {
    const gql = `query($search:String){Page(page:1,perPage:10){media(search:$search,type:ANIME){id title{english romaji} format seasonYear}}}`;
    const res = yield request(ANILIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: gql, variables: { search: query } })
    });
    const json = yield res.json();
    return (json.data.Page.media || []).map(m => ({
      id: m.id,
      title: m.title.english || m.title.romaji,
      year: m.seasonYear
    }));
  });
}

// ─── MAIN STREAMS LOGIC ─────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function*() {
    try {
      // 1. Get TMDB Title
      const tmdbRes = yield request(`https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`);
      const tmdb = yield tmdbRes.json();
      const title = mediaType === "movie" ? tmdb.title : tmdb.name;

      // 2. Map to AniList
      const results = yield animeSearch(title);
      const match = results[0]; // AnimeX usually relies on AniList ID
      if (!match) return [];

      // 3. Get Episode List from AnimeX API
      const epRes = yield request(`${BASE_URL}/api/anime/episodes/${match.id}?refresh=false`);
      const epData = yield epRes.json();
      const targetEpNum = episode || 1;
      const targetEp = epData.find(e => e.number === targetEpNum);
      if (!targetEp) return [];

      const streams = [];
      const watchUrl = `${BASE_URL}/watch/${match.title.toLowerCase().replace(/ /g, "-")}-${match.id}-episode-${targetEpNum}`;

      // 4. Fetch Providers (Sub/Dub)
      const categories = [
        { type: "sub", providers: targetEp.subProviders || [], label: "Sub" },
        { type: "dub", providers: targetEp.dubProviders || [], label: "Dub" }
      ];

      for (const cat of categories) {
        for (const provider of cat.providers) {
          try {
            // Generate the mandatory encrypted payload for AnimeX
            const payload = JSON.stringify({ id: match.id, host: provider, epNum: targetEpNum, type: cat.type, timestamp: Date.now() });
            const encryptedId = yield encrypt(payload);

            const sourceRes = yield request(`${BASE_URL}/api/anime/sources/${encryptedId}`, {
              headers: { "Referer": watchUrl, "Origin": BASE_URL }
            });
            const sourceData = yield sourceRes.json();

            if (sourceData.sources) {
              sourceData.sources.forEach(s => {
                streams.push({
                  name: `AnimeX [${provider.toUpperCase()}]`,
                  title: `${cat.label} - ${s.quality || "Auto"}`,
                  url: s.url,
                  quality: s.quality || "auto",
                  type: "hls",
                  headers: { "Referer": watchUrl, "User-Agent": UA }
                });
              });
            }
          } catch (e) { console.log(`[AnimeX] Provider ${provider} failed`); }
        }
      }

      return streams;
    } catch (e) {
      console.error(`[AnimeX] Fatal: ${e.message}`);
      return [];
    }
  });
}

module.exports = { getStreams };
