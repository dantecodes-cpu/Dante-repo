// ToonStream Provider for Nuvio
// Cartoon-focused, stable scraping approach

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const BASE_URL = "https://toonstream.day";

const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL
};

// ------------------ HELPERS ------------------

function fetchText(url, options = {}) {
  return fetch(url, {
    method: "GET",
    headers: { ...HEADERS, ...(options.headers || {}) }
  }).then(r => r.ok ? r.text() : null);
}

function fetchJSON(url) {
  return fetch(url, { headers: HEADERS })
    .then(r => r.ok ? r.json() : null);
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[:']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ------------------ TMDB ------------------

function getTMDB(tmdbId, type) {
  const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  return fetchJSON(url).then(d => {
    if (!d) return null;
    return {
      title: d.title || d.name,
      year: (d.release_date || d.first_air_date || "").split("-")[0]
    };
  });
}

// ------------------ SEARCH ------------------

function searchToonStream(title) {
  const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(title)}`;
  return fetchText(searchUrl).then(html => {
    if (!html) return [];

    const results = [];
    const re = /<article[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
    let m;

    while ((m = re.exec(html)) !== null) {
      results.push({
        url: m[1],
        title: m[2].replace(/Watch Online/i, "").trim()
      });
    }
    return results;
  });
}

// ------------------ EPISODES ------------------

function extractEpisodeUrl(html, season, episode) {
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  const epRe = new RegExp(`href="([^"]+)"[^>]*>\\s*Episode\\s+${episode}\\b`, "i");
  const m = html.match(epRe);
  return m ? m[1] : null;
}

// ------------------ EMBEDS ------------------

function extractEmbeds(html) {
  const embeds = [];
  const re = /<iframe[^>]+(?:src|data-src)="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    embeds.push(m[1].startsWith("//") ? "https:" + m[1] : m[1]);
  }
  return embeds;
}

// ------------------ AWS / ZEHPYR ------------------

function extractAWS(embedUrl) {
  const hash = embedUrl.split("/").pop();
  const host = embedUrl.includes("zephyr")
    ? "https://play.zephyrflick.top"
    : "https://z.awstream.net";

  const api = `${host}/player/index.php?data=${hash}&do=getVideo`;

  return fetch(api, {
    method: "POST",
    headers: {
      ...HEADERS,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": embedUrl
    },
    body: `hash=${hash}&r=${host}`
  })
    .then(r => r.ok ? r.json() : null)
    .then(j => j?.videoSource ? [{
      url: j.videoSource,
      quality: "1080p",
      headers: { Referer: host }
    }] : []);
}

// ------------------ MAIN ------------------

function getStreams(tmdbId, mediaType, season, episode) {
  let info;

  return getTMDB(tmdbId, mediaType)
    .then(d => {
      if (!d) return [];
      info = d;
      return searchToonStream(d.title);
    })
    .then(results => {
      if (!results.length) return [];

      const match = results[0];
      return fetchText(match.url);
    })
    .then(html => {
      if (!html) return [];

      if (mediaType === "tv" && season && episode) {
        const epUrl = extractEpisodeUrl(html, season, episode);
        if (!epUrl) return [];
        return fetchText(epUrl);
      }
      return html;
    })
    .then(html => {
      if (!html) return [];

      const embeds = extractEmbeds(html);
      const tasks = embeds.map(e =>
        e.includes("awstream") || e.includes("zephyr")
          ? extractAWS(e)
          : []
      );

      return Promise.all(tasks).then(r => r.flat());
    })
    .then(streams => streams.map(s => ({
      name: "ToonStream",
      title: info.title,
      url: s.url,
      quality: s.quality,
      provider: "toonstream",
      headers: s.headers || HEADERS
    })))
    .catch(() => []);
}

// ------------------ EXPORT ------------------

if (typeof module !== "undefined") {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
