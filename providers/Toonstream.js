/**
 * toonstream - v28.0
 * Fixed based on real Termux test results:
 *
 * FINDINGS:
 * 1. WP REST API returns 0 posts — broken on this site. Use slug from title directly.
 * 2. Episode URLs: /home/episode/{slug}-{S}x{E}/  (has /home/ prefix)
 * 3. The 8 data-src iframes are INTERNAL toonstream trembed URLs:
 *      https://toonstream.dad/home/?trembed=0&trid=41756&trtyp=...
 *    Each must be fetched to find the REAL external embed inside.
 *    We were skipping them because they pointed back to MAIN_URL — now we handle them.
 * 4. Series page at /series/{slug}/ works fine for AJAX season tab lookup.
 * 5. AJAX episode links return /home/episode/ URLs.
 */
var b=Object.defineProperty,q=Object.defineProperties;
var I=Object.getOwnPropertyDescriptors;
var E=Object.getOwnPropertySymbols;
var R=Object.prototype.hasOwnProperty,D=Object.prototype.propertyIsEnumerable;
var x=(e,n,t)=>n in e?b(e,n,{enumerable:!0,configurable:!0,writable:!0,value:t}):e[n]=t,
    M=(e,n)=>{for(var t in n||(n={}))R.call(n,t)&&x(e,t,n[t]);if(E)for(var t of E(n))D.call(n,t)&&x(e,t,n[t]);return e},
    W=(e,n)=>q(e,I(n));
var __async=(e,n,t)=>new Promise((r,o)=>{
  var c=u=>{try{l(t.next(u))}catch(a){o(a)}};
  var s=u=>{try{l(t.throw(u))}catch(a){o(a)}};
  var l=u=>u.done?r(u.value):Promise.resolve(u.value).then(c,s);
  l((t=t.apply(e,n)).next());
});

console.log("[ToonStream] v29.0 init");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL  = "https://toonstream.dad";
const HOME_URL  = "https://toonstream.dad/home"; // episode/series pages live here
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36";

// ─── HTTP ────────────────────────────────────────────────────────────────────
function req(url, opts, timeout) {
  return __async(this, null, function*() {
    timeout = timeout || 12000;
    opts = opts || {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = M({
        "User-Agent": UA,
        "Accept": "text/html,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive"
      }, opts.headers || {});
      const res = yield fetch(url, W(M({}, opts), { signal: controller.signal, headers }));
      clearTimeout(timer);
      return res;
    } catch(e) {
      clearTimeout(timer);
      throw e;
    }
  });
}

// ─── TMDB ────────────────────────────────────────────────────────────────────
function getTmdbTitle(tmdbId, mediaType) {
  return __async(this, null, function*() {
    const r = yield req(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`,
      { headers: { Accept: "application/json" } }
    );
    const d = yield r.json();
    const title = mediaType === "movie" ? d.title : d.name;
    if (!title) throw new Error("No TMDB title");
    console.log(`[ToonStream] Title: "${title}"`);
    return title;
  });
}

// ─── SLUG ────────────────────────────────────────────────────────────────────
// Convert title to URL slug. "Ben 10" → "ben-10", "Courage the Cowardly Dog" → "courage-the-cowardly-dog"
function titleToSlug(title) {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── FIND EPISODE URL ────────────────────────────────────────────────────────
// Strategy:
//   1. Try direct URL: /home/episode/{slug}-{S}x{E}/
//   2. If empty, fall back to series page AJAX
function findEpisodeUrl(slug, season, episode) {
  return __async(this, null, function*() {
    const direct = `${HOME_URL}/episode/${slug}-${season}x${episode}/`;
    console.log(`[ToonStream] Trying direct: ${direct}`);
    try {
      const links = yield getTrembedLinks(direct);
      if (links.length > 0) return { url: direct, links };
    } catch(e) {
      console.log(`[ToonStream] Direct URL failed: ${e.message}`);
    }

    // Fallback: AJAX via series page
    console.log(`[ToonStream] Falling back to AJAX`);
    return getEpisodeViaAjax(slug, season, episode);
  });
}

// ─── GET TREMBED LINKS ───────────────────────────────────────────────────────
// Fetches a page and returns all data-src iframe URLs.
// On toonstream, these are the internal trembed URLs like:
//   https://toonstream.dad/home/?trembed=0&trid=41756&trtyp=1
// Each needs a second fetch to get the real external embed URL inside.
function getTrembedLinks(pageUrl) {
  return __async(this, null, function*() {
    const r = yield req(pageUrl, {
      headers: { Accept: "text/html,*/*", Referer: MAIN_URL + "/" }
    });
    const html = yield r.text();
    console.log(`[ToonStream] Page ${pageUrl} length: ${html.length}`);

    const links = [];
    const start = html.search(/id=["']aa-options["']/i);
    const block = start >= 0 ? html.slice(start) : html;

    // Collect ALL data-src iframes — including internal toonstream ones
    for (const m of block.matchAll(/<iframe[^>]+data-src=["']([^"']+)["']/gi)) {
      let u = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
      if (u.startsWith("//")) u = "https:" + u;
      if (u.startsWith("http") && !links.includes(u)) links.push(u);
    }
    // Fallback: plain src
    if (!links.length) {
      for (const m of block.matchAll(/<iframe[^>]+\ssrc=["']([^"']+)["']/gi)) {
        let u = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
        if (u.startsWith("//")) u = "https:" + u;
        if (!u.startsWith("http") || u === "about:blank") continue;
        if (!links.includes(u)) links.push(u);
      }
    }

    console.log(`[ToonStream] Trembed links (${links.length}):`, links.map(u => u.slice(0, 80)));
    return links;
  });
}

// ─── AJAX EPISODE LOOKUP ─────────────────────────────────────────────────────
function getEpisodeViaAjax(slug, season, episode) {
  return __async(this, null, function*() {
    const seriesUrl = `${MAIN_URL}/series/${slug}/`;
    const r = yield req(seriesUrl, { headers: { Accept: "text/html,*/*", Referer: MAIN_URL + "/" } });
    const html = yield r.text();
    console.log(`[ToonStream] Series page length: ${html.length}`);

    // Find matching season tab
    let postId = null, seasonId = null;
    for (const m of html.matchAll(/data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)(?=data-post=|$)/gi)) {
      const inner = m[3].replace(/<[^>]+>/g, "").trim();
      const numM  = inner.match(/(\d+)/);
      if (numM && parseInt(numM[1]) === parseInt(season)) {
        postId = m[1]; seasonId = m[2]; break;
      }
    }
    // Fallback: first tab
    if (!postId) {
      const fb = html.match(/data-post="(\d+)"[^>]*data-season="(\d+)"/);
      if (fb) { postId = fb[1]; seasonId = fb[2]; }
    }

    console.log(`[ToonStream] AJAX: postId=${postId} seasonId=${seasonId}`);
    if (!postId || !seasonId) return null;

    const ar = yield req(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": seriesUrl
      },
      body: `action=action_select_season&season=${seasonId}&post=${postId}`
    });
    const ajaxHtml = yield ar.text();
    console.log(`[ToonStream] AJAX response length: ${ajaxHtml.length}`);

    // SxE span match
    for (const m of ajaxHtml.matchAll(/<span[^>]*class="num-epi"[^>]*>\s*(\d+)x(\d+)\s*<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi)) {
      if (parseInt(m[1]) === parseInt(season) && parseInt(m[2]) === parseInt(episode)) {
        const epUrl = m[3];
        console.log(`[ToonStream] AJAX found ep: ${epUrl}`);
        const links = yield getTrembedLinks(epUrl);
        return { url: epUrl, links };
      }
    }
    // nth link fallback
    const allLinks = [...ajaxHtml.matchAll(/href="(https?:\/\/toonstream[^"]+\/episode\/[^"]+)"/gi)];
    const idx = parseInt(episode) - 1;
    if (allLinks[idx]) {
      const epUrl = allLinks[idx][1];
      console.log(`[ToonStream] AJAX nth link: ${epUrl}`);
      const links = yield getTrembedLinks(epUrl);
      return { url: epUrl, links };
    }

    return null;
  });
}

// ─── RESOLVE TREMBED → REAL EMBED ────────────────────────────────────────────
// Each trembed URL (https://toonstream.dad/home/?trembed=N&trid=...) is a
// toonstream wrapper page. Fetch it and look for the real external embed iframe.
function resolveTrembed(trembedUrl, pageReferer) {
  return __async(this, null, function*() {
    console.log(`[ToonStream] Resolving trembed: ${trembedUrl}`);
    try {
      const r = yield req(trembedUrl, {
        headers: { Referer: pageReferer, Accept: "text/html,*/*", "Sec-Fetch-Dest": "iframe" }
      });
      const html = yield r.text();
      console.log(`[ToonStream] Trembed page length: ${html.length}`);

      // Look for external iframe (the real embed host)
      for (const m of html.matchAll(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/gi)) {
        let u = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
        if (u.startsWith("//")) u = "https:" + u;
        if (!u.startsWith("http")) continue;
        // Must be external (not toonstream itself)
        if (!u.includes("toonstream.dad")) {
          console.log(`[ToonStream] Real embed: ${u}`);
          return u;
        }
      }

      // Also check for direct m3u8 in page (some players inline it)
      const m3u8 = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/);
      if (m3u8) {
        console.log(`[ToonStream] Inline m3u8: ${m3u8[1]}`);
        return m3u8[1];
      }

      // Check for JavaScript redirect / window.location
      const jsRedir = html.match(/(?:window\.location|src)\s*=\s*["'](https?:\/\/[^"']+)["']/);
      if (jsRedir && !jsRedir[1].includes("toonstream.dad")) {
        console.log(`[ToonStream] JS redirect: ${jsRedir[1]}`);
        return jsRedir[1];
      }

    } catch(e) {
      console.log(`[ToonStream] Trembed resolve failed: ${e.message}`);
    }
    return null;
  });
}

// ─── EXTRACT FROM REAL EMBED ─────────────────────────────────────────────────
function extractFrom(url, referer) {
  const u = url.toLowerCase();
  const name = label(url);
  console.log(`[ToonStream] Extracting: ${url}`);

  if (anyOf(u, ["awstream","zephyrflick","zephyr","as-cdn"])) return extractAWS(url, name);
  if (anyOf(u, ["emturbovid","embturbovid"]))                 return extractEmturbo(url, name);
  if (anyOf(u, ["vidmoly"]))                                   return extractVidmoly(url, name);
  if (anyOf(u, ["streamsb","watchsb","sbplay","sbspeed"]))    return extractStreamSB(url, name);
  if (anyOf(u, ["dood","d000d"]))                              return extractDood(url, name);
  if (anyOf(u, ["vidhide","filelions","vidhidepro","vidhidevip","cdnwish"])) return extractVidHide(url, name);
  if (anyOf(u, ["filemoon","premilkyway","filesim"]))          return extractFileMoon(url, name);
  if (anyOf(u, ["streamwish","wishembed","strwish","sfastwish","awish","jodwish","hlswish","nekowish","strmup","turbovidhls"])) return extractStreamWish(url, name);
  if (anyOf(u, ["rubystm","streamruby"]))                     return extractRuby(url, name);
  if (anyOf(u, ["cloudy","upns","rpmshare"]))                 return extractCloudy(url, name);
  if (anyOf(u, ["gdmirrorbot"]))                              return extractGDMirror(url, name);
  if (anyOf(u, ["short.icu","shrinkme","shrinkearn"]))        return extractShortUrl(url, referer, name);
  if (url.includes(".m3u8")) return Promise.resolve([mk(url, { Referer: referer }, name)]);
  return extractGeneric(url, name);
}

const anyOf = (s, arr) => arr.some(k => s.includes(k));
const label = url => {
  try {
    const h = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0];
    return `ToonStream [${h[0].toUpperCase()}${h.slice(1)}]`;
  } catch(e) { return "ToonStream"; }
};
const mk = (url, headers, name, quality="Auto") => ({
  name: name || "ToonStream",
  title: quality,
  url,
  quality,
  type: "hls",
  headers: headers || {}
});

// ─── EXTRACTORS ──────────────────────────────────────────────────────────────
function extractAWS(url, name) {
  return __async(this, null, function*() {
    const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    const hash   = url.split("/").filter(Boolean).pop();
    try {
      const r = yield req(`${origin}/player/index.php?data=${hash}&do=getVideo`, {
        method: "POST",
        headers: { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded", Referer: origin },
        body: `hash=${hash}&r=${origin}`
      });
      const j = yield r.json();
      if (j && j.videoSource && j.videoSource !== "0") {
        console.log(`[ToonStream] AWS URL: ${j.videoSource}`);
        return [mk(j.videoSource, {}, name)];
      }
    } catch(e) { console.log(`[ToonStream] AWS error: ${e.message}`); }
    return extractGeneric(url, name);
  });
}

function extractEmturbo(url, name) {
  return __async(this, null, function*() {
    try {
      const r = yield req(url, { headers: { Referer: url } });
      const html = yield r.text();
      const m = html.match(/var\s+urlPlay\s*=\s*['"]([^'"]+)['"]/);
      if (m) return [mk(m[1], { Referer: url }, name)];
    } catch(e) {}
    return extractGeneric(url, name);
  });
}

function extractVidmoly(url, name) {
  return __async(this, null, function*() {
    const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    const idM = url.match(/\/(?:embed-|w\/)([a-zA-Z0-9]+)/);
    const target = idM ? `${origin}/embed-${idM[1]}.html` : url;
    try {
      const r = yield req(target, { headers: { Referer: `${origin}/` } });
      const content = unpackAll(yield r.text());
      const m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/);
      if (m) return [mk(m[1], { Referer: `${origin}/` }, name)];
    } catch(e) {}
    return [];
  });
}

function extractStreamSB(url, name) {
  return __async(this, null, function*() {
    const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    const vid = url.split("/").filter(Boolean).pop().replace(".html", "");
    const hex = vid.split("").map(c => c.charCodeAt(0).toString(16)).join("");
    try {
      const r = yield req(`${origin}/sources48/${hex}`, { headers: { watchsb: "sbstream", Referer: url } });
      const j = yield r.json();
      if (j && j.stream_data && j.stream_data.file) return [mk(j.stream_data.file, { Referer: `${origin}/` }, name)];
    } catch(e) {}
    return extractGeneric(url, name);
  });
}

function extractDood(url, name) {
  return __async(this, null, function*() {
    const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    try {
      const r = yield req(url, { headers: { Referer: `${origin}/` } });
      const html = yield r.text();
      const md5M = html.match(/\/pass_md5\/[^\s"'<]+/);
      const tokM = html.match(/\?token=([^&"'\s]+)/);
      if (!md5M) return extractGeneric(url, name);
      const r2 = yield req(`${origin}${md5M[0]}`, { headers: { Referer: url } });
      const md5 = yield r2.text();
      const rand = Math.random().toString(36).slice(2, 14);
      return [mk(`${md5.trim()}${rand}?token=${tokM ? tokM[1] : ""}&expiry=${Date.now()}`, { Referer: `${origin}/` }, name)];
    } catch(e) {}
    return [];
  });
}

function extractVidHide(url, name) {
  return __async(this, null, function*() {
    const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    const embed  = url.replace(/\/(d|f|file|download)\//, "/v/");
    try {
      const r = yield req(embed, { headers: { Referer: embed, Origin: origin } });
      const content = unpackAll(yield r.text());
      const m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/)
             || content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      if (m) return [mk(m[1], { Referer: `${origin}/` }, name)];
    } catch(e) {}
    return [];
  });
}

function extractFileMoon(url, name) {
  return __async(this, null, function*() {
    try {
      const r = yield req(url, { headers: { Referer: url } });
      const content = unpackAll(yield r.text());
      const m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      if (m) return [mk(m[1], { Referer: url }, name)];
    } catch(e) {}
    return [];
  });
}

function extractStreamWish(url, name) {
  return __async(this, null, function*() {
    const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    try {
      const r = yield req(url, { headers: { Referer: `${origin}/` } });
      const content = unpackAll(yield r.text());
      const m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/)
             || content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      if (m) return [mk(m[1], { Referer: `${origin}/` }, name)];
    } catch(e) {}
    return [];
  });
}

function extractVidStack(url, name) {
  return __async(this, null, function*() {
    const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    const id = url.split("/").filter(Boolean).pop();
    try {
      const r = yield req(`${origin}/api/source/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: url },
        body: `r=${encodeURIComponent(url)}`
      });
      const j = yield r.json();
      if (j && j.data) return j.data.filter(i => i.file && i.file.includes(".m3u8")).map(i => mk(i.file, { Referer: url }, name));
    } catch(e) {}
    return [];
  });
}

function extractGeneric(url, name) {
  return __async(this, null, function*() {
    try {
      const r = yield req(url, { headers: { Referer: url } });
      const content = unpackAll(yield r.text());
      const seen = {}, results = [];
      for (const m of content.matchAll(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/gi)) {
        const link = m[1].replace(/\\/g, "");
        if (!seen[link] && !link.includes("error")) {
          seen[link] = true;
          console.log(`[ToonStream] Generic found: ${link}`);
          results.push(mk(link, { Referer: url }, name));
        }
      }
      return results;
    } catch(e) { return []; }
  });
}


function extractRuby(url, name) {
  return __async(this, null, function*() {
    // StreamRuby: fetch embed page directly, unpack and find m3u8
    try {
      const r = yield req(url, { headers: { Referer: url } });
      const content = unpackAll(yield r.text());
      const m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/)
             || content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      if (m) return [mk(m[1], { Referer: url }, name)];
    } catch(e) { console.log("[ToonStream] Ruby error: " + e.message); }
    return [];
  });
}

function extractCloudy(url, name) {
  return __async(this, null, function*() {
    // cloudy.upns.one/#videoId — hash-based SPA
    // The video ID is after the # fragment. Fetch their embed API directly.
    try {
      const hashId = url.split("#")[1] || "";
      const origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
      // Try their known API endpoint pattern
      const apiUrl = `${origin}/api/video/${hashId}`;
      const r = yield req(apiUrl, { headers: { Referer: url, Accept: "application/json" } });
      if (r.ok) {
        const j = yield r.json();
        // Common response: { sources: [{file, label}] } or { url } or { stream }
        const streamUrl = (j.sources && j.sources[0] && j.sources[0].file)
                       || j.url || j.stream || j.file || j.hls;
        if (streamUrl) return [mk(streamUrl, { Referer: origin + "/" }, name)];
      }
    } catch(e) {}
    // Fallback: fetch base URL without hash, look for m3u8
    try {
      const baseUrl = url.split("#")[0];
      const r = yield req(baseUrl, { headers: { Referer: url } });
      const content = unpackAll(yield r.text());
      const m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      if (m) return [mk(m[1], { Referer: url }, name)];
    } catch(e) { console.log("[ToonStream] Cloudy error: " + e.message); }
    return [];
  });
}

function extractGDMirror(url, name) {
  return __async(this, null, function*() {
    // GDMirrorBot: embed page usually has a JSON API or direct link
    try {
      const r = yield req(url, { headers: { Referer: url } });
      const html = yield r.text();
      // Look for their stream API call in page scripts
      const apiM = html.match(/fetch\s*\(\s*["']([^"']+)["']/);
      if (apiM && apiM[1].startsWith("http")) {
        const ar = yield req(apiM[1], { headers: { Referer: url, Accept: "application/json" } });
        if (ar.ok) {
          const j = yield ar.json();
          const streamUrl = j.url || j.stream || j.file || (j.sources && j.sources[0] && j.sources[0].file);
          if (streamUrl) return [mk(streamUrl, { Referer: url }, name)];
        }
      }
      // Generic fallback
      const content = unpackAll(html);
      const m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
      if (m) return [mk(m[1], { Referer: url }, name)];
    } catch(e) { console.log("[ToonStream] GDMirror error: " + e.message); }
    return [];
  });
}

function extractShortUrl(url, referer, name) {
  return __async(this, null, function*() {
    // URL shortener — follow redirect to final URL, then dispatch
    try {
      const r = yield req(url, {
        headers: { Referer: referer || url },
        redirect: "follow"
      });
      const finalUrl = r.url;
      console.log("[ToonStream] Short URL resolved: " + url + " => " + finalUrl);
      if (finalUrl && finalUrl !== url && !finalUrl.includes("short.icu")) {
        return extractFrom(finalUrl, url);
      }
      // If redirect didn't work, try parsing Location from HTML
      const html = yield r.text();
      const locM = html.match(/(?:window\.location|location\.href)\s*=\s*["']([^"']+)["']/);
      if (locM && !locM[1].includes("short.icu")) return extractFrom(locM[1], url);
    } catch(e) { console.log("[ToonStream] ShortURL error: " + e.message); }
    return [];
  });
}

// ─── PACKER UNPACKER ─────────────────────────────────────────────────────────
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
    const a = p.match(/\}\s*\(\s*'([\s\S]*)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!a) return null;
    const [, payload, rs,, ds] = a;
    const radix = parseInt(rs), dict = ds.split("|");
    return payload.replace(/\b\w+\b/g, w => {
      const n = parseInt(w, radix);
      return (Number.isFinite(n) && dict[n]) ? dict[n] : w;
    });
  } catch(e) { return null; }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType="movie", season=null, episode=null) {
  return __async(this, null, function*() {
    console.log(`[ToonStream] getStreams tmdbId=${tmdbId} type=${mediaType} S${season}E${episode}`);
    try {
      const title = yield getTmdbTitle(tmdbId, mediaType);
      const slug  = titleToSlug(title);
      console.log(`[ToonStream] Slug: "${slug}"`);

      let trembedLinks, epUrl;

      if (mediaType === "movie") {
        epUrl = `${HOME_URL}/series/${slug}/`;
        trembedLinks = yield getTrembedLinks(epUrl);
      } else {
        const result = yield findEpisodeUrl(slug, season, episode);
        if (!result || !result.links.length) {
          console.log("[ToonStream] No trembed links found");
          return [];
        }
        epUrl = result.url;
        trembedLinks = result.links;
      }

      console.log(`[ToonStream] Processing ${trembedLinks.length} trembed links`);

      // For each trembed URL: resolve to real embed, then extract streams
      const allStreams = [], seen = {};

      for (const trembedUrl of trembedLinks) {
        try {
          // Step 1: resolve trembed → real external embed URL
          const embedUrl = yield resolveTrembed(trembedUrl, epUrl);
          if (!embedUrl) {
            console.log(`[ToonStream] No embed found in: ${trembedUrl}`);
            continue;
          }

          // Step 2: extract streams from the real embed
          const streams = yield extractFrom(embedUrl, trembedUrl);
          for (const s of streams) {
            if (s && s.url && !seen[s.url]) {
              seen[s.url] = true;
              allStreams.push(s);
              console.log(`[ToonStream] ✅ Stream: ${s.url.slice(0, 80)}`);
            }
          }
        } catch(e) {
          console.log(`[ToonStream] Error on ${trembedUrl}: ${e.message}`);
        }
      }

      console.log(`[ToonStream] Total streams: ${allStreams.length}`);
      return allStreams;

    } catch(e) {
      console.error(`[ToonStream] Fatal: ${e.message}`);
      return [];
    }
  });
}

module.exports = { getStreams };
