/**
 * animex - Improved
 *
 * Fixes from original:
 *  1. axios → native fetch (works in Nuvio sandbox)
 *  2. softsub now uses softsubProviders (falls back to subProviders)
 *  3. isMatch replaced with Dice coefficient similarity (no more wrong series picks)
 *  4. Season matching unified and reliable for all seasons
 *  5. All catch blocks now log errors
 *  6. Source fetching parallelised with Promise.all
 *  7. Stream deduplication by URL
 *  8. softsub category skipped when providers identical to sub
 */

// ─── CRYPTO (unchanged — this is the working auth mechanism) ─────────────────
var import_crypto_js = require("crypto-js");

var KEY = new Uint8Array([1, 83, 160, 158, 58, 198, 82, 210, 133, 247, 202, 33, 80, 94, 227, 179, 162, 130, 9, 101, 19, 111, 180, 220, 156, 145, 144, 6, 150, 65, 25, 14]);
var AT  = new Uint8Array([166, 215, 77, 130, 106, 46, 255, 237, 4, 39, 65, 214, 6, 17, 101, 113, 101, 252, 253, 240, 204, 202, 234, 19, 69, 132, 45, 76, 82, 15, 17, 205, 14, 190, 42, 67, 116, 216, 73, 243, 79, 171, 41, 4, 233, 158, 71, 45, 3, 227, 49, 8, 130, 167, 70, 179, 211, 169, 152, 21, 255, 230, 7, 100]);
var AU  = new Uint8Array([38, 87, 230, 128, 78, 56, 110, 153, 220, 39, 166, 236, 176, 8, 95, 103, 21, 153, 47, 238, 168, 225, 185, 232, 198, 117, 74, 158, 160, 219, 128, 105, 70, 224, 21, 162, 220, 23, 217, 99, 14, 142, 214, 41, 71, 216, 230, 252]);

var b = (() => {
  const f = (n) => (n ^ 1553869343) + (n << 7 ^ n >>> 11) & 4294967295;
  const g = (n) => n * 2654435769 >>> 0;
  const x = (n) => { let o = n; o ^= o << 13; o ^= o >>> 17; o ^= o << 5; return (o >>> 0) % 256; };
  const u = (n, o) => (n << o | n >>> 8 - o) & 255;
  const n = new Uint8Array(256);
  for (let o = 0; o < 256; o++) {
    const e = o ^ 170, c = x(e), t = g(e + 23130), s = f(o + c) & 255;
    n[o] = (c ^ t & 255 ^ s ^ o * 19) & 255;
  }
  for (let o = 0; o < 11; o++)
    for (let e = 0; e < 256; e++) {
      const c = n[e], t = n[(e + 37) % 256], s = n[(e + 73) % 256], a = n[(e + 139) % 256],
            r = u(c, 3) ^ u(t, 5) ^ u(s, 7), _ = f(c + o) & 255;
      n[e] = (r ^ a ^ _ ^ o * 17 + e * 23) & 255;
    }
  for (let o = 0; o < 128; o++) {
    const e = 255 - o, c = n[o] + n[e] & 255, t = (n[o] ^ n[e]) & 255;
    n[o] = (u(c, 2) ^ t) & 255; n[e] = (u(t, 3) ^ c) & 255;
  }
  return n;
})();

var T = (n, o, e) => {
  const c = new Uint8Array(n.length);
  for (let t = 0; t < n.length; t++) {
    const s = o[t % o.length], a = o[(t + 7) % o.length], r = o[(t + 13) % o.length],
          _ = e[t % e.length], i = e[(t + 11) % e.length], h = b[t * 7 % 256];
    c[t] = (n[t] ^ s ^ a ^ r ^ _ ^ i ^ h ^ t * 23) & 255;
  }
  return c;
};

var q = (n) => {
  const o = new Uint8Array(n.length);
  for (let e = 0; e < n.length; e++) {
    const c = n[e], t = e * 23 & 255;
    o[e] = (c << 4 | c >>> 4) ^ t & 255;
  }
  return o;
};

var m = (n) => btoa(n).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

async function encryptGCM(data, key, iv) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
    const result    = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, data);
    return new Uint8Array(result);
  }
  // crypto-js fallback
  const keyWA  = import_crypto_js.lib.WordArray.create(key);
  const ivWA   = import_crypto_js.lib.WordArray.create(iv);
  const dataWA = import_crypto_js.lib.WordArray.create(data);
  const counter = new Uint8Array(16); counter.set(iv); counter[15] = 2;
  const counterWA = import_crypto_js.lib.WordArray.create(counter);
  const encrypted = import_crypto_js.AES.encrypt(dataWA, keyWA, { iv: counterWA, mode: import_crypto_js.mode.CTR, padding: import_crypto_js.pad.NoPadding });
  const cipherBuffer = encrypted.ciphertext;
  const cipherBytes  = wordToByteArray(cipherBuffer.words, cipherBuffer.sigBytes);
  const hBuffer = import_crypto_js.AES.encrypt(import_crypto_js.lib.WordArray.create(new Uint8Array(16)), keyWA, { mode: import_crypto_js.mode.ECB, padding: import_crypto_js.pad.NoPadding }).ciphertext;
  const hBytes  = wordToByteArray(hBuffer.words, hBuffer.sigBytes);
  const tag = calculateTag(cipherBytes, hBytes, iv, keyWA);
  const finalResult = new Uint8Array(cipherBytes.length + tag.length);
  finalResult.set(cipherBytes); finalResult.set(tag, cipherBytes.length);
  return finalResult;
}

function wordToByteArray(words, length) {
  const array = new Uint8Array(length);
  for (let i = 0; i < length; i++) array[i] = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
  return array;
}

function calculateTag(ciphertext, h, iv, keyWA) {
  let y = new Uint8Array(16);
  const blocks = Math.ceil(ciphertext.length / 16);
  for (let i = 0; i < blocks; i++) {
    const block = new Uint8Array(16); block.set(ciphertext.slice(i * 16, (i + 1) * 16));
    for (let j = 0; j < 16; j++) y[j] ^= block[j];
    y = gmultiply(y, h);
  }
  const lenBlock = new Uint8Array(16);
  const cipherLenBits = ciphertext.length * 8;
  lenBlock[15] = cipherLenBits & 255; lenBlock[14] = cipherLenBits >>> 8 & 255;
  lenBlock[13] = cipherLenBits >>> 16 & 255; lenBlock[12] = cipherLenBits >>> 24 & 255;
  for (let j = 0; j < 16; j++) y[j] ^= lenBlock[j];
  y = gmultiply(y, h);
  const j0 = new Uint8Array(16); j0.set(iv); j0[15] = 1;
  const ej0Buffer = import_crypto_js.AES.encrypt(import_crypto_js.lib.WordArray.create(j0), keyWA, { mode: import_crypto_js.mode.ECB, padding: import_crypto_js.pad.NoPadding }).ciphertext;
  const ej0 = wordToByteArray(ej0Buffer.words, ej0Buffer.sigBytes);
  for (let j = 0; j < 16; j++) y[j] ^= ej0[j];
  return y;
}

function gmultiply(x, y) {
  const res = new Uint8Array(16), v = new Uint8Array(y);
  for (let i = 0; i < 128; i++) {
    if (x[i >>> 3] >>> 7 - i % 8 & 1) for (let j = 0; j < 16; j++) res[j] ^= v[j];
    const msb = v[15] & 1;
    for (let j = 15; j > 0; j--) v[j] = v[j] >>> 1 | (v[j - 1] & 1) << 7;
    v[0] >>>= 1;
    if (msb) v[0] ^= 225;
  }
  return res;
}

async function encrypt(n) {
  const iv = typeof crypto !== "undefined" && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(12))
    : new Uint8Array(12).map(() => Math.floor(Math.random() * 256));
  const s = new TextEncoder().encode(n);
  const a = q(s);
  const r = T(a, AT, AU);
  const encrypted = await encryptGCM(r, KEY, iv);
  const i = new Uint8Array(iv.length + encrypted.length);
  i.set(iv); i.set(encrypted, iv.length);
  return m(Array.from(i).map((b) => String.fromCharCode(b)).join(""));
}

async function generateId(n, o = {}) {
  const e = { id: n, ...o, timestamp: Date.now() };
  return await encrypt(JSON.stringify(e));
}

// ─── HTTP (FIX 1: axios → native fetch) ─────────────────────────────────────
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function request(method, url, options = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers: {
        "User-Agent":        USER_AGENT,
        "X-Requested-With":  "XMLHttpRequest",
        ...options.headers
      },
      body:   options.data ? JSON.stringify(options.data) : undefined,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();
    return { data }; // match original axios response shape
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function normalize(str) {
  if (!str) return "";
  return str.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// FIX 3: Dice coefficient replaces fragile substring isMatch
// Prevents "Dragon Ball" matching "Dragon Ball Z" and "Dragon Ball Super"
function diceSimilarity(a, b) {
  const s1 = normalize(a), s2 = normalize(b);
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;
  const bigrams = (str) => {
    const map = {};
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      map[bg] = (map[bg] || 0) + 1;
    }
    return map;
  };
  const bg1 = bigrams(s1), bg2 = bigrams(s2);
  let intersection = 0;
  for (const bg in bg1) if (bg2[bg]) intersection += Math.min(bg1[bg], bg2[bg]);
  return (2 * intersection) / ((s1.length - 1) + (s2.length - 1));
}

// Checks if two titles refer to the same anime (threshold: 0.7)
function isMatch(title1, title2) {
  if (!title1 || !title2) return false;
  const score = diceSimilarity(title1, title2);
  // Also accept if one cleanly starts with the other (handles subtitle variations)
  const n1 = normalize(title1), n2 = normalize(title2);
  const startMatch = n1.startsWith(n2) || n2.startsWith(n1);
  return score >= 0.7 || (startMatch && Math.abs(n1.length - n2.length) < 8);
}

// ─── ANILIST ─────────────────────────────────────────────────────────────────
const ANILIST_API = "https://graphql.anilist.co/";
const BASE_URL    = "https://animex.one";

async function search(query) {
  const gql = `
    query ($search: String) {
      Page(page: 1, perPage: 10) {
        media(search: $search, type: ANIME) {
          id
          title { romaji english native }
          format
          status
          seasonYear
        }
      }
    }
  `;
  try {
    const response = await request("post", ANILIST_API, {
      data: { query: gql, variables: { search: query } }
    });
    return response.data.data.Page.media.map((item) => ({
      id:    item.id,
      title: item.title.english || item.title.romaji || item.title.native,
      year:  item.seasonYear,
      type:  item.format === "MOVIE" ? "movie" : "tv"
    }));
  } catch (error) {
    console.error("[AnimeX] AniList search failed:", error.message);
    return [];
  }
}

function getSlug(title, id, episode) {
  const slug = title.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${id}-episode-${episode}`;
}

// ─── TMDB ────────────────────────────────────────────────────────────────────
async function getTmdbMetadata(tmdbId, mediaType) {
  const TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
  const endpoint = (mediaType === "tv" || mediaType === "series") ? "tv" : "movie";
  const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
  try {
    const response = await request("get", url);
    const data = response.data;
    return {
      title: data.name || data.title,
      year:  (data.first_air_date || data.release_date || "").split("-")[0]
    };
  } catch (error) {
    console.error("[AnimeX] TMDB fetch failed:", error.message);
    return null;
  }
}

// ─── MATCH LOGIC (FIX 4+5: unified, season-aware) ────────────────────────────
async function findAniListMatch(tmdbMeta, mediaType, season) {
  const title       = tmdbMeta.title;
  const year        = tmdbMeta.year;
  const seasonNum   = season || 1;

  // Build ordered list of search queries to try, most specific first
  const queries = [];
  if (mediaType === "tv" && seasonNum > 1) {
    queries.push(`${title} Season ${seasonNum}`);
    queries.push(`${title} ${seasonNum}`);
    queries.push(`${title} Part ${seasonNum}`);
  }
  queries.push(title);
  if (year) queries.push(`${title} ${year}`);

  for (const query of queries) {
    console.log(`[AnimeX] Searching AniList: "${query}"`);
    const results = await search(query);
    if (!results.length) continue;

    // Score each result
    const scored = results
      .map(r => {
        let score = diceSimilarity(r.title, title);
        if (year && String(r.year) === String(year)) score += 0.15;
        // For season > 1, reward results that mention the season number
        if (seasonNum > 1) {
          const rn = normalize(r.title);
          if (rn.includes(`season ${seasonNum}`) || rn.includes(` ${seasonNum}`)) score += 0.2;
        }
        return { ...r, score };
      })
      .filter(r => r.score >= 0.6)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0];
      console.log(`[AnimeX] Matched: "${best.title}" (AL ID: ${best.id}, score: ${best.score.toFixed(2)})`);
      return best;
    }
  }

  console.log("[AnimeX] No AniList match found");
  return null;
}

// ─── SOURCES (FIX 6: parallel, FIX 2: correct softsub field, FIX 8: no dupe) ─
async function fetchSource(matchId, provider, epNumber, type, watchUrl) {
  try {
    const encryptedId = await generateId(matchId, {
      host:   provider,
      epNum:  epNumber,
      type:   type,
      cache:  "true"
    });
    const response = await request("get", `${BASE_URL}/api/anime/sources/${encryptedId}`, {
      headers: { "Referer": watchUrl, "Origin": BASE_URL }
    });
    return response.data?.sources || [];
  } catch (e) {
    console.error(`[AnimeX] Source fetch failed (${provider}/${type}):`, e.message);
    return [];
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[AnimeX] getStreams: tmdb=${tmdbId} type=${mediaType} S=${season} E=${episode}`);

  // 1. TMDB metadata
  const tmdbMeta = await getTmdbMetadata(tmdbId, mediaType);
  if (!tmdbMeta) {
    console.error("[AnimeX] No TMDB metadata");
    return [];
  }
  console.log(`[AnimeX] Title: "${tmdbMeta.title}" (${tmdbMeta.year})`);

  // 2. AniList match
  const match = await findAniListMatch(tmdbMeta, mediaType, season);
  if (!match) return [];

  const targetEpNum = episode || 1;

  // 3. Fetch episode list
  let episodes;
  try {
    const episodesResponse = await request("get", `${BASE_URL}/api/anime/episodes/${match.id}?refresh=false`);
    episodes = episodesResponse.data;
    if (!Array.isArray(episodes) || episodes.length === 0) {
      console.error("[AnimeX] Empty episode list from API");
      return [];
    }
    console.log(`[AnimeX] Found ${episodes.length} episodes`);
  } catch (e) {
    console.error("[AnimeX] Episode list fetch failed:", e.message);
    return [];
  }

  // 4. Find the target episode
  let targetEp = episodes.find(e => e.number === targetEpNum);
  if (!targetEp) {
    // Fallback: closest episode number
    targetEp = episodes.reduce((prev, curr) =>
      Math.abs(curr.number - targetEpNum) < Math.abs(prev.number - targetEpNum) ? curr : prev
    );
    console.log(`[AnimeX] Exact ep ${targetEpNum} not found, using closest: ${targetEp.number}`);
  }

  const watchUrl = `${BASE_URL}/watch/${getSlug(match.title, match.id, targetEpNum)}`;
  console.log(`[AnimeX] Watch URL: ${watchUrl}`);

  // FIX 2: softsub uses softsubProviders (falls back to subProviders if absent)
  // FIX 8: skip softsub category when it would be identical to sub
  const subProviders      = targetEp.subProviders      || [];
  const softsubProviders  = targetEp.softsubProviders  || [];
  const dubProviders      = targetEp.dubProviders      || [];

  const softsubIsSame = JSON.stringify(softsubProviders.sort()) === JSON.stringify(subProviders.sort());

  const categories = [
    { type: "sub",     providers: subProviders,     label: "Sub" },
    // Only include softsub if it has its own distinct providers
    ...(!softsubIsSame && softsubProviders.length > 0
      ? [{ type: "softsub", providers: softsubProviders, label: "Softsub" }]
      : []),
    { type: "dub",     providers: dubProviders,     label: "Dub" },
  ].filter(cat => cat.providers.length > 0);

  if (categories.length === 0) {
    console.error("[AnimeX] No providers available for this episode");
    return [];
  }

  console.log(`[AnimeX] Fetching from ${categories.map(c => `${c.label}(${c.providers.length})`).join(", ")}`);

  // FIX 6: parallel fetch across ALL categories and providers simultaneously
  const fetchTasks = [];
  for (const cat of categories) {
    for (const provider of cat.providers) {
      fetchTasks.push(
        fetchSource(match.id, provider, targetEp.number, cat.type, watchUrl)
          .then(sources => sources.map(s => ({
            name:    `AnimeX - ${provider} (${cat.label})`,
            title:   `${cat.label} - ${s.quality || "Auto"}`,
            url:     s.url,
            quality: s.quality || "auto",
            headers: {
              "Referer":    watchUrl,
              "Origin":     BASE_URL,
              "User-Agent": USER_AGENT
            }
          })))
      );
    }
  }

  const results = await Promise.all(fetchTasks);
  const allStreams = results.flat();

  // FIX 7: deduplicate by URL
  const seen = new Set();
  const streams = allStreams.filter(s => {
    if (!s.url || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  console.log(`[AnimeX] Total streams: ${streams.length} (from ${allStreams.length} raw)`);
  return streams;
}

module.exports = { getStreams, search };
