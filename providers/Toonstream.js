/**
 * ToonStream - v26.0
 * Complete rewrite. Uses WordPress REST API (JSON, no HTML scraping) for search,
 * then constructs episode URLs directly. Structurally identical to NetMirror.
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

console.log("[ToonStream] v26.0 init");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad";

// Identical to working NetMirror headers
const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive"
};

// Identical pattern to working NetMirror makeRequest
function makeRequest(url, options = {}) {
  return fetch(url, __spreadProps(__spreadValues({}, options), {
    headers: __spreadValues(__spreadValues({}, BASE_HEADERS), options.headers || {}),
    timeout: 10000
  })).then(function(response) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  });
}

function getUnixTime() {
  return Math.floor(Date.now() / 1e3);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Get title from TMDB
// ─────────────────────────────────────────────────────────────────────────────
function getTmdbTitle(tmdbId, mediaType) {
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  return makeRequest(url).then(r => r.json()).then(function(data) {
    const title = mediaType === "movie" ? data.title : data.name;
    if (!title) throw new Error("No title in TMDB response");
    console.log(`[ToonStream] Title: "${title}"`);
    return title;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Find series slug via WordPress REST API (returns clean JSON)
//
// toonstream.dad is WordPress. /wp-json/wp/v2/posts?search=query returns JSON:
// [{ id, title: {rendered}, link: "https://toonstream.dad/series/ben-10/" }, ...]
//
// The link field gives us the slug directly — no HTML parsing needed.
// ─────────────────────────────────────────────────────────────────────────────
function findSeriesSlug(title) {
  const query = title.replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim();
  const apiUrl = `${MAIN_URL}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=10&_fields=id,title,link,type`;

  console.log(`[ToonStream] WP API search: ${apiUrl}`);

  return makeRequest(apiUrl, {
    headers: { "Accept": "application/json", "Referer": MAIN_URL + "/" }
  }).then(r => r.json()).then(function(posts) {
    console.log(`[ToonStream] WP API returned ${posts.length} posts`);

    if (!posts.length) return null;

    // Filter to series pages only (link contains /series/)
    // Also skip /episode/ pages
    const seriesPosts = posts.filter(p =>
      p.link && p.link.indexOf("/series/") !== -1 && p.link.indexOf("/episode/") === -1
    );

    console.log(`[ToonStream] Series posts: ${seriesPosts.length}`);
    seriesPosts.forEach(p => console.log(`  ${p.title.rendered} => ${p.link}`));

    const candidates = seriesPosts.length ? seriesPosts : posts;

    // Pick best match by title similarity
    function norm(s) { return s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]/g, ""); }
    const target = norm(title);

    // Exact match
    for (const p of candidates) {
      if (norm(p.title.rendered) === target) {
        return slugFromUrl(p.link);
      }
    }

    // Starts with target (base title before spinoffs), shortest slug wins
    const startsWith = candidates.filter(p => norm(p.title.rendered).startsWith(target));
    if (startsWith.length) {
      startsWith.sort((a, b) => slugFromUrl(a.link).length - slugFromUrl(b.link).length);
      return slugFromUrl(startsWith[0].link);
    }

    // First series result
    return slugFromUrl(candidates[0].link);
  });
}

function slugFromUrl(url) {
  // "https://toonstream.dad/series/ben-10/" => "ben-10"
  // "https://toonstream.dad/episode/ben-10-1x1/" => "ben-10-1x1"
  const parts = url.replace(/\/$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Construct episode page URL directly from slug
//
// toonstream.dad episode URLs follow this pattern:
//   /episode/{series-slug}-{season}x{episode}/
// e.g. /episode/ben-10-1x1/
//      /episode/courage-the-cowardly-dog-1x1/
//
// This avoids all AJAX season tab fetching entirely.
// ─────────────────────────────────────────────────────────────────────────────
function buildEpisodeUrl(seriesSlug, season, episode) {
  return `${MAIN_URL}/episode/${seriesSlug}-${season}x${episode}/`;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Fetch episode page and extract server iframe links
// ─────────────────────────────────────────────────────────────────────────────
function getServerLinks(pageUrl) {
  return makeRequest(pageUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Referer": MAIN_URL + "/"
    }
  }).then(r => r.text()).then(function(html) {
    console.log(`[ToonStream] Episode page HTML length: ${html.length}`);

    const links = [];

    // Find the #aa-options player block
    const startIdx = html.search(/id=["']aa-options["']/i);
    const block = startIdx >= 0 ? html.slice(startIdx) : html;

    // Collect data-src iframes (lazy-loaded)
    let m;
    const rx1 = /<iframe[^>]+data-src=["']([^"']+)["']/gi;
    while ((m = rx1.exec(block)) !== null) {
      let link = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
      if (link.startsWith("//")) link = "https:" + link;
      if (link.startsWith("http") && links.indexOf(link) === -1) links.push(link);
    }

    // Fallback: plain src iframes
    if (!links.length) {
      const rx2 = /<iframe[^>]+\ssrc=["']([^"']+)["']/gi;
      while ((m = rx2.exec(block)) !== null) {
        let link = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
        if (link.startsWith("//")) link = "https:" + link;
        if (!link.startsWith("http")) continue;
        if (link.indexOf(MAIN_URL) !== -1 || link === "about:blank") continue;
        if (links.indexOf(link) === -1) links.push(link);
      }
    }

    console.log(`[ToonStream] Server links: ${links.length} — ${links.join(", ")}`);
    return links;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Extract streams from each server
// ─────────────────────────────────────────────────────────────────────────────
function extractAll(serverLinks, pageUrl) {
  const allStreams = [];
  const seen = {};
  let chain = Promise.resolve();

  serverLinks.forEach(function(link) {
    chain = chain.then(function() {
      return resolveAndExtract(link, pageUrl).then(function(streams) {
        streams.forEach(function(s) {
          if (s && s.url && !seen[s.url]) {
            seen[s.url] = true;
            allStreams.push(s);
          }
        });
      }).catch(function(e) {
        console.log(`[ToonStream] Error on ${link}: ${e.message}`);
      });
    });
  });

  return chain.then(() => allStreams);
}

function resolveAndExtract(serverLink, pageReferer) {
  // Fetch the server wrapper page to find the real embed iframe
  return makeRequest(serverLink, {
    headers: {
      "Referer": pageReferer,
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Sec-Fetch-Dest": "iframe"
    }
  }).then(r => r.text()).then(function(html) {
    const m = html.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    let target = serverLink;
    if (m) {
      let resolved = m[1].replace(/&#038;/g, "&");
      if (resolved.startsWith("//")) resolved = "https:" + resolved;
      if (resolved.startsWith("http") && resolved.indexOf(MAIN_URL) === -1) {
        target = resolved;
      }
    }
    console.log(`[ToonStream] ${serverLink} => ${target}`);
    return extractFrom(target, serverLink);
  }).catch(function(e) {
    console.log(`[ToonStream] Wrapper fetch failed for ${serverLink}: ${e.message}`);
    return extractFrom(serverLink, pageReferer);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTOR ROUTER
// ─────────────────────────────────────────────────────────────────────────────
function extractFrom(url, referer) {
  const u = url.toLowerCase();
  const name = hostLabel(url);
  console.log(`[ToonStream] Extracting: ${url}`);

  if (hasAny(u, ["awstream", "zephyrflick", "zephyr"]))      return extractAWS(url, name);
  if (hasAny(u, ["emturbovid", "embturbovid"]))               return extractEmturbo(url, name);
  if (hasAny(u, ["vidmoly"]))                                  return extractVidmoly(url, name);
  if (hasAny(u, ["streamsb","watchsb","sbplay","sbspeed","sbfast","sbthe"])) return extractStreamSB(url, name);
  if (hasAny(u, ["streamruby", "rubystm"]))                   return extractGeneric(url, name);
  if (hasAny(u, ["dood", "d000d"]))                           return extractDood(url, name);
  if (hasAny(u, ["vidhide","filelions","vidhidepro","vidhidevip","cdnwish"])) return extractVidHide(url, name);
  if (hasAny(u, ["filemoon","premilkyway","filesim"]))        return extractFileMoon(url, name);
  if (hasAny(u, ["streamwish","wishembed","strwish","sfastwish","awish","jodwish","swhoi","hlswish","playerwish","nekowish"])) return extractStreamWish(url, name);
  if (hasAny(u, ["cloudy","rpmshare","upnshare"]))            return extractVidStack(url, name);
  return extractGeneric(url, name);
}

const hasAny = (str, arr) => arr.some(k => str.includes(k));
const hostLabel = (url) => {
  try { const h = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0]; return `ToonStream [${h[0].toUpperCase()}${h.slice(1)}]`; }
  catch(e) { return "ToonStream"; }
};

// Stream builder — type:"hls" matching NetMirror
const mkStream = (url, headers, name, quality = "Auto") => ({
  name: name || "ToonStream",
  title: quality,
  url,
  quality,
  type: "hls",
  headers: headers || {}
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTORS — each returns Promise<stream[]>
// ─────────────────────────────────────────────────────────────────────────────
function extractAWS(url, name) {
  const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  const hash   = url.split("/").filter(Boolean).pop();
  return makeRequest(`${origin}/player/index.php?data=${hash}&do=getVideo`, {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded", "Referer": origin },
    body: `hash=${hash}&r=${origin}`
  }).then(r => r.json())
    .then(j => j && j.videoSource && j.videoSource !== "0" ? [mkStream(j.videoSource, {}, name)] : extractGeneric(url, name))
    .catch(() => extractGeneric(url, name));
}

function extractEmturbo(url, name) {
  return makeRequest(url, { headers: { "Referer": url } })
    .then(r => r.text())
    .then(function(html) {
      const m = html.match(/var\s+urlPlay\s*=\s*['"]([^'"]+)['"]/);
      return m ? [mkStream(m[1], { "Referer": url }, name)] : extractGeneric(url, name);
    }).catch(() => []);
}

function extractVidmoly(url, name) {
  const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  const idM    = url.match(/\/(?:embed-|w\/)([a-zA-Z0-9]+)/);
  const target = idM ? `${origin}/embed-${idM[1]}.html` : url;
  return makeRequest(target, { headers: { "Referer": `${origin}/` } })
    .then(r => r.text())
    .then(function(html) {
      const content = unpackAll(html);
      const m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/);
      return m ? [mkStream(m[1], { "Referer": `${origin}/` }, name)] : [];
    }).catch(() => []);
}

function extractStreamSB(url, name) {
  const origin  = url.match(/^(https?:\/\/[^\/]+)/)[1];
  const videoId = url.split("/").filter(Boolean).pop().replace(".html", "");
  const hexId   = videoId.split("").map(c => c.charCodeAt(0).toString(16)).join("");
  return makeRequest(`${origin}/sources48/${hexId}`, { headers: { "watchsb": "sbstream", "Referer": url } })
    .then(r => r.json())
    .then(j => j && j.stream_data && j.stream_data.file ? [mkStream(j.stream_data.file, { "Referer": `${origin}/` }, name)] : extractGeneric(url, name))
    .catch(() => extractGeneric(url, name));
}

function extractDood(url, name) {
  const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  return makeRequest(url, { headers: { "Referer": `${origin}/` } })
    .then(r => r.text())
    .then(function(html) {
      const md5M = html.match(/\/pass_md5\/[^\s"'<]+/);
      const tokM = html.match(/\?token=([^&"'\s]+)/);
      if (!md5M) return extractGeneric(url, name);
      return makeRequest(`${origin}${md5M[0]}`, { headers: { "Referer": url } })
        .then(r => r.text())
        .then(function(md5) {
          const rand = Math.random().toString(36).slice(2, 14);
          return [mkStream(`${md5.trim()}${rand}?token=${tokM ? tokM[1] : ""}&expiry=${Date.now()}`, { "Referer": `${origin}/` }, name)];
        });
    }).catch(() => []);
}

function extractVidHide(url, name) {
  const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  const embed  = url.replace(/\/(d|f|file|download)\//, "/v/");
  return makeRequest(embed, { headers: { "Referer": embed, "Origin": origin } })
    .then(r => r.text())
    .then(function(html) {
      const content = unpackAll(html);
      const m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) ||
                content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      return m ? [mkStream(m[1], { "Referer": `${origin}/` }, name)] : [];
    }).catch(() => []);
}

function extractFileMoon(url, name) {
  return makeRequest(url, { headers: { "Referer": url } })
    .then(r => r.text())
    .then(function(html) {
      const content = unpackAll(html);
      const m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      return m ? [mkStream(m[1], { "Referer": url }, name)] : [];
    }).catch(() => []);
}

function extractStreamWish(url, name) {
  const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  return makeRequest(url, { headers: { "Referer": `${origin}/` } })
    .then(r => r.text())
    .then(function(html) {
      const content = unpackAll(html);
      const m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) ||
                content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      return m ? [mkStream(m[1], { "Referer": `${origin}/` }, name)] : [];
    }).catch(() => []);
}

function extractVidStack(url, name) {
  const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  const id     = url.split("/").filter(Boolean).pop();
  return makeRequest(`${origin}/api/source/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": url },
    body: `r=${encodeURIComponent(url)}`
  }).then(r => r.json())
    .then(function(j) {
      if (!j || !j.data) return [];
      return j.data.filter(i => i.file && i.file.includes(".m3u8"))
                   .map(i => mkStream(i.file, { "Referer": url }, name));
    }).catch(() => []);
}

function extractGeneric(url, name) {
  return makeRequest(url, { headers: { "Referer": url } })
    .then(r => r.text())
    .then(function(html) {
      const content = unpackAll(html);
      const seen = {}, results = [];
      let m;
      const rx = /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/gi;
      while ((m = rx.exec(content)) !== null) {
        const link = m[1].replace(/\\/g, "");
        if (!seen[link] && !link.includes("error")) {
          seen[link] = true;
          results.push(mkStream(link, { "Referer": url }, name));
        }
      }
      return results;
    }).catch(() => []);
}

// ─────────────────────────────────────────────────────────────────────────────
// PACKER UNPACKER
// ─────────────────────────────────────────────────────────────────────────────
function unpackAll(content) {
  let result = content;
  for (let i = 0; i < 5; i++) {
    const m = result.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]*?\.split\('\|'\)\)/);
    if (!m) break;
    const up = unpackOne(m[0]);
    if (!up || up === result) break;
    result = up;
  }
  return result;
}
function unpackOne(p) {
  try {
    const args = p.match(/\}\s*\(\s*'([\s\S]*)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!args) return null;
    const [, payload, radixStr,, dictStr] = args;
    const radix = parseInt(radixStr);
    const dict  = dictStr.split("|");
    return payload.replace(/\b\w+\b/g, w => {
      const n = parseInt(w, radix);
      return (Number.isFinite(n) && dict[n]) ? dict[n] : w;
    });
  } catch(e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType = "movie", season = null, episode = null) {
  console.log(`[ToonStream] getStreams: tmdbId=${tmdbId} type=${mediaType} S${season}E${episode}`);

  return getTmdbTitle(tmdbId, mediaType).then(function(title) {

    if (mediaType === "movie") {
      // Movie: find series page URL, fetch it directly
      return findSeriesSlug(title).then(function(slug) {
        if (!slug) throw new Error(`No slug found for "${title}"`);
        const pageUrl = `${MAIN_URL}/series/${slug}/`;
        console.log(`[ToonStream] Movie page: ${pageUrl}`);
        return getServerLinks(pageUrl);
      }).then(links => extractAll(links, `${MAIN_URL}/`));
    }

    // TV: find slug, construct episode URL directly
    return findSeriesSlug(title).then(function(slug) {
      if (!slug) throw new Error(`No slug found for "${title}"`);

      const epUrl = buildEpisodeUrl(slug, season, episode);
      console.log(`[ToonStream] Episode URL: ${epUrl}`);

      return getServerLinks(epUrl).then(function(links) {
        if (links.length === 0) {
          // Episode URL might have slightly different format — try fetching series
          // page and finding the real episode URL via the fallback AJAX method
          console.log(`[ToonStream] No links at ${epUrl} — trying series page AJAX`);
          return getEpisodeUrlViaAjax(slug, title, season, episode);
        }
        return extractAll(links, epUrl);
      });
    });

  }).catch(function(err) {
    console.error(`[ToonStream] Fatal: ${err.message}`);
    return [];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK: Get episode URL via series page + AJAX (when direct URL doesn't work)
// ─────────────────────────────────────────────────────────────────────────────
function getEpisodeUrlViaAjax(slug, title, season, episode) {
  const seriesUrl = `${MAIN_URL}/series/${slug}/`;

  return makeRequest(seriesUrl, {
    headers: { "Accept": "text/html,*/*", "Referer": `${MAIN_URL}/` }
  }).then(r => r.text()).then(function(html) {
    // Find the season tab matching the requested season number
    let postId = null, seasonId = null;
    const tabRx = /data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)(?=data-post=|$)/gi;
    let m;
    while ((m = tabRx.exec(html)) !== null) {
      const inner = m[3].replace(/<[^>]+>/g, "").trim();
      const numM  = inner.match(/(\d+)/);
      if (numM && parseInt(numM[1]) === parseInt(season)) {
        postId = m[1]; seasonId = m[2]; break;
      }
    }
    if (!postId) {
      const fb = html.match(/data-post="(\d+)"[^>]*data-season="(\d+)"/);
      if (fb) { postId = fb[1]; seasonId = fb[2]; }
    }

    console.log(`[ToonStream] AJAX: postId=${postId} seasonId=${seasonId}`);
    if (!postId || !seasonId) return [];

    return makeRequest(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": seriesUrl
      },
      body: `action=action_select_season&season=${seasonId}&post=${postId}`
    }).then(r => r.text()).then(function(ajaxHtml) {
      // Match SxE span
      const epRx = /<span[^>]*class="num-epi"[^>]*>\s*(\d+)x(\d+)\s*<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi;
      let ep;
      while ((ep = epRx.exec(ajaxHtml)) !== null) {
        if (parseInt(ep[1]) === parseInt(season) && parseInt(ep[2]) === parseInt(episode)) {
          console.log(`[ToonStream] Found ep URL via AJAX: ${ep[3]}`);
          return getServerLinks(ep[3]).then(links => extractAll(links, ep[3]));
        }
      }
      // nth link fallback
      const allLinks = [...ajaxHtml.matchAll(/<a\s+href="(https?:\/\/toonstream[^"]+\/episode\/[^"]+)"/gi)];
      const idx = parseInt(episode) - 1;
      if (allLinks[idx]) {
        const epUrl = allLinks[idx][1];
        console.log(`[ToonStream] Found ep URL via nth link: ${epUrl}`);
        return getServerLinks(epUrl).then(links => extractAll(links, epUrl));
      }
      console.log(`[ToonStream] Episode not found in AJAX response`);
      return [];
    });
  }).catch(function(err) {
    console.log(`[ToonStream] AJAX fallback failed: ${err.message}`);
    return [];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — identical to working NetMirror
// ─────────────────────────────────────────────────────────────────────────────
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
