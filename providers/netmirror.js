var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;

var __defNormalProp = (obj, key, value) =>
  key in obj
    ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value })
    : (obj[key] = value);

var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);

  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b))
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);

  return a;
};

var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

console.log("[NetMirror] Provider loaded");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = "https://net51.cc/";

const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive"
};

let globalCookie = "";
let cookieTimestamp = 0;
const COOKIE_EXPIRY = 54e6;

/* -------------------- UTIL -------------------- */

function makeRequest(url, options = {}) {
  return fetch(
    url,
    __spreadProps(__spreadValues({}, options), {
      headers: __spreadValues(__spreadValues({}, BASE_HEADERS), options.headers),
      timeout: 10000
    })
  ).then(response => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  });
}

function getUnixTime() {
  return Math.floor(Date.now() / 1000);
}

/* -------------------- BYPASS -------------------- */

function bypass() {
  const now = Date.now();
  if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
    return Promise.resolve(globalCookie);
  }

  function attempt(attempts) {
    if (attempts >= 5) throw new Error("Bypass failed");

    return makeRequest(`${NETMIRROR_BASE}tv/p.php`, {
      method: "POST",
      headers: { Referer: `${NETMIRROR_BASE}tv/home` }
    }).then(r => {
      const cookieHeader = r.headers.get("set-cookie");
      let cookie = null;

      if (cookieHeader) {
        const m = cookieHeader.match(/t_hash_t=([^;]+)/);
        if (m) cookie = m[1];
      }

      return r.text().then(t => {
        if (!t.includes('"r":"n"')) return attempt(attempts + 1);
        if (!cookie) throw new Error("Cookie missing");

        globalCookie = cookie;
        cookieTimestamp = Date.now();
        return cookie;
      });
    });
  }

  return attempt(0);
}

/* -------------------- SEARCH -------------------- */

function searchContent(query, platform) {
  const ottMap = { netflix: "nf", primevideo: "pv", disney: "hs" };
  const ott = ottMap[platform] || "nf";

  return bypass().then(cookie => {
    const cookieString =
      `t_hash_t=${cookie}; user_token=a0a5f663894ade410614071fe46baca6; ott=${ott}; hd=on`;

    const endpoints = {
      netflix: `${NETMIRROR_BASE}search.php`,
      primevideo: `${NETMIRROR_BASE}pv/search.php`,
      disney: `${NETMIRROR_BASE}mobile/hs/search.php`
    };

    return makeRequest(
      `${endpoints[platform] || endpoints.netflix}?s=${encodeURIComponent(query)}&t=${getUnixTime()}`,
      { headers: { Cookie: cookieString, Referer: `${NETMIRROR_BASE}tv/home` } }
    );
  })
  .then(r => r.json())
  .then(d => (d.searchResult || []).map(i => ({
    id: i.id,
    title: i.t,
    posterUrl: `https://imgcdn.media/poster/v/${i.id}.jpg`
  })));
}

/* -------------------- SIMILARITY (Cloudstream aligned) -------------------- */

function calculateSimilarity(a, b) {
  const w1 = a.toLowerCase().split(/\W+/);
  const w2 = b.toLowerCase().split(/\W+/);
  const matches = w2.filter(w => w1.includes(w)).length;
  return matches / Math.max(w1.length, w2.length);
}

function filterRelevantResults(results, title, platform) {
  const q = title.toLowerCase().trim();

  // Exact title match first (Cloudstream behavior)
  const exact = results.filter(r => r.title.toLowerCase().trim() === q);
  if (exact.length) return exact;

  const threshold =
    platform === "primevideo" ? 0.75 :
    platform === "disney" ? 0.6 :
    0.4;

  return results
    .map(r => ({ r, s: calculateSimilarity(r.title, q) }))
    .filter(x => x.s >= threshold)
    .sort((a, b) => b.s - a.s)
    .map(x => x.r);
}

/* -------------------- EPISODES -------------------- */

function getEpisodesFromSeason(seriesId, seasonId, platform, page = 1) {
  const ottMap = { netflix: "nf", primevideo: "pv", disney: "hs" };
  const ott = ottMap[platform] || "nf";

  return bypass().then(cookie => {
    const cookieString =
      `t_hash_t=${cookie}; user_token=a0a5f663894ade410614071fe46baca6; ott=${ott}; hd=on`;

    const endpoints = {
      netflix: `${NETMIRROR_BASE}episodes.php`,
      primevideo: `${NETMIRROR_BASE}pv/episodes.php`,
      disney: `${NETMIRROR_BASE}mobile/hs/episodes.php`
    };

    const episodes = [];

    function fetchPage(p) {
      return makeRequest(
        `${endpoints[platform] || endpoints.netflix}?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${p}`,
        { headers: { Cookie: cookieString, Referer: `${NETMIRROR_BASE}tv/home` } }
      )
      .then(r => r.json())
      .then(d => {
        if (d.episodes) episodes.push(...d.episodes);
        return d.nextPageShow === 1 ? fetchPage(p + 1) : episodes;
      })
      .catch(() => episodes);
    }

    return fetchPage(page);
  });
}

/* -------------------- LOAD CONTENT -------------------- */

function loadContent(contentId, platform) {
  const ottMap = { netflix: "nf", primevideo: "pv", disney: "hs" };
  const ott = ottMap[platform] || "nf";

  return bypass().then(cookie => {
    const cookieString =
      `t_hash_t=${cookie}; user_token=a0a5f663894ade410614071fe46baca6; ott=${ott}; hd=on`;

    const endpoints = {
      netflix: `${NETMIRROR_BASE}post.php`,
      primevideo: `${NETMIRROR_BASE}pv/post.php`,
      disney: `${NETMIRROR_BASE}mobile/hs/post.php`
    };

    return makeRequest(
      `${endpoints[platform] || endpoints.netflix}?id=${contentId}&t=${getUnixTime()}`,
      { headers: { Cookie: cookieString, Referer: `${NETMIRROR_BASE}tv/home` } }
    );
  })
  .then(r => r.json())
  .then(d => ({
    id: contentId,
    title: d.title,
    description: d.desc,
    year: d.year,
    episodes: d.episodes || [],
    seasons: d.season || [],
    isMovie: !d.episodes || d.episodes[0] === null
  }));
}

/* -------------------- STREAM LINKS -------------------- */

function getStreamingLinks(contentId, title, platform) {
  return bypass().then(cookie => {
    const ottMap = { netflix: "nf", primevideo: "pv", disney: "hs" };
    const ott = ottMap[platform] || "nf";

    const playlist =
      platform === "primevideo"
        ? "tv/pv/playlist.php"
        : platform === "disney"
        ? "mobile/hs/playlist.php"
        : "tv/playlist.php";

    const cookieString = `t_hash_t=${cookie}; ott=${ott}; hd=on`;

    return makeRequest(
      `${NETMIRROR_BASE}${playlist}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`,
      { headers: { Cookie: cookieString, Referer: `${NETMIRROR_BASE}tv/home` } }
    );
  })
  .then(r => r.json())
  .then(list => {
    const sources = [];
    const subtitles = [];

    (list || []).forEach(item => {
      (item.sources || []).forEach(src => {
        let url = src.file;

        if (platform === "netflix") {
          url = url.replace("://net51.cc/tv/", "://net51.cc/");
        }

        if (!url.startsWith("http")) {
          url = url.startsWith("//") ? `https:${url}` : `https://net51.cc${url}`;
        }

        sources.push({
          url,
          quality: src.label || "HD",
          type: "hls",
          headers: { Referer: "https://net51.cc/" }
        });
      });
    });

    return { sources, subtitles };
  });
}

/* -------------------- MAIN -------------------- */

function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  const tmdbUrl =
    `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;

  return makeRequest(tmdbUrl)
    .then(r => r.json())
    .then(tmdb => {
      const title = mediaType === "tv" ? tmdb.name : tmdb.title;

      let platforms = ["netflix", "primevideo", "disney"];
      if (title.toLowerCase().includes("boys"))
        platforms = ["primevideo", "netflix", "disney"];

      function tryPlatform(p) {
        if (p >= platforms.length) return [];

        const platform = platforms[p];
        return searchContent(title, platform)
          .then(results => {
            const filtered = filterRelevantResults(results, title, platform);
            if (!filtered.length) return tryPlatform(p + 1);
            return getStreamingLinks(filtered[0].id, title, platform);
          })
          .catch(() => tryPlatform(p + 1));
      }

      return tryPlatform(0);
    })
    .catch(() => []);
}

/* -------------------- EXPORT -------------------- */

if (typeof module !== "undefined") {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
