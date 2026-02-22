/**
 * ToonStream Provider for Nuvio - v25.0
 * Built to be structurally identical to the working NetMirror plugin.
 * Includes diagnostic streams so failure point is visible in the UI.
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = function(obj, key, value) {
  return key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value: value }) : obj[key] = value;
};
var __spreadValues = function(a, b) {
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
var __spreadProps = function(a, b) { return __defProps(a, __getOwnPropDescs(b)); };

console.log("[ToonStream] v25.0 loading...");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad";

// Exact same BASE_HEADERS as working NetMirror plugin
const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none"
};

// Exact same makeRequest pattern as working NetMirror plugin
// Returns the response object (not text) so caller can chain .text() or .json()
function makeRequest(url, options) {
  options = options || {};
  return fetch(url, __spreadProps(__spreadValues({}, options), {
    headers: __spreadValues(__spreadValues({}, BASE_HEADERS), options.headers || {}),
    timeout: 10000
  })).then(function(response) {
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " " + response.statusText + " for " + url);
    }
    return response;
  });
}

// Diagnostic stream - always visible in Nuvio stream picker
// Tells us exactly WHERE the plugin failed without needing log access
function diagStream(message) {
  console.log("[ToonStream] DIAG: " + message);
  return {
    name: "ToonStream [DEBUG]",
    title: message,
    url: "https://example.com/debug.m3u8",
    quality: "DEBUG",
    type: "hls",
    headers: {}
  };
}

// ─────────────────────────────────────────────────────────────
//  MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[ToonStream] getStreams: tmdbId=" + tmdbId + " type=" + mediaType + " S" + season + "E" + episode);
  
  var tmdbUrl = "https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  
  return makeRequest(tmdbUrl, {
    headers: { "Accept": "application/json" }
  }).then(function(r) {
    return r.json();
  }).then(function(tmdbData) {
    var title = mediaType === "movie" ? tmdbData.title : tmdbData.name;
    if (!title) throw new Error("No title from TMDB");
    
    var year = ((mediaType === "movie" ? tmdbData.release_date : tmdbData.first_air_date) || "").slice(0, 4);
    console.log("[ToonStream] Title: " + title + " (" + year + ")");
    
    // Try both search URLs - some WP sites need /?s= not /page/1/?s=
    var searchQuery = title.replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim();
    var searchUrl = MAIN_URL + "/?s=" + encodeURIComponent(searchQuery);
    console.log("[ToonStream] Searching: " + searchUrl);
    
    return makeRequest(searchUrl, {
      headers: { "Referer": MAIN_URL + "/" }
    }).then(function(r) {
      return r.text();
    }).then(function(html) {
      console.log("[ToonStream] Search HTML length: " + html.length);
      
      // Detect Cloudflare challenge
      if (html.length < 5000 && (html.indexOf("cloudflare") !== -1 || html.indexOf("challenge") !== -1 || html.indexOf("Just a moment") !== -1)) {
        return [diagStream("Cloudflare blocked - length " + html.length)];
      }
      
      // Parse articles - extract URL from inside <h2> to avoid category hrefs
      var results = parseSearchResults(html);
      console.log("[ToonStream] Results: " + results.length);
      
      if (results.length === 0) {
        return [diagStream("No search results. HTML[0:200]=" + html.slice(0, 200).replace(/\n/g, " "))];
      }
      
      var bestUrl = pickBest(results, title);
      console.log("[ToonStream] Best: " + bestUrl);
      
      if (mediaType !== "tv") {
        return scrapeStreams(bestUrl, title, mediaType, season, episode);
      }
      
      return getEpisodeUrl(bestUrl, title, season, episode).then(function(epUrl) {
        if (!epUrl) {
          return [diagStream("No episode URL for S" + season + "E" + episode + " at " + bestUrl)];
        }
        return scrapeStreams(epUrl, title, mediaType, season, episode);
      });
      
    });
  }).catch(function(err) {
    console.error("[ToonStream] Error: " + err.message);
    return [diagStream("Error: " + err.message)];
  });
}

// ─────────────────────────────────────────────────────────────
//  PARSE SEARCH RESULTS
// ─────────────────────────────────────────────────────────────
function parseSearchResults(html) {
  var results = [];
  var chunks = html.split(/<article[\s\S]*?>/i);
  
  for (var i = 1; i < chunks.length; i++) {
    var chunk = chunks[i];
    
    // Get URL+title from inside <h2> — avoids category/tag links that appear first
    var h2Match = chunk.match(/<h2[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!h2Match) continue;
    
    var url   = h2Match[1];
    var title = h2Match[2].replace(/<[^>]+>/g, "").replace(/Watch Online/gi, "").replace(/\s+/g, " ").trim();
    
    if (!url || !title) continue;
    if (!url.startsWith("http")) url = MAIN_URL + url;
    if (url.indexOf("/episode/") !== -1) continue; // skip individual episode pages
    if (url.indexOf("/category/") !== -1 || url.indexOf("/tag/") !== -1) continue;
    
    results.push({ url: url, title: title });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
//  PICK BEST MATCH
// ─────────────────────────────────────────────────────────────
function pickBest(results, title) {
  function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
  
  var target = norm(title);
  var slug   = title.toLowerCase().replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim().replace(/\s/g, "-");
  
  // Exact normalized title match
  for (var i = 0; i < results.length; i++) {
    if (norm(results[i].title) === target) return results[i].url;
  }
  // URL slug is exact path segment (not a longer spinoff slug)
  for (var i = 0; i < results.length; i++) {
    var segs = results[i].url.replace(/\/$/, "").split("/");
    if (segs.indexOf(slug) !== -1) return results[i].url;
  }
  // Starts with target, pick shortest slug (base title before spinoffs)
  var cands = results.filter(function(r) { return norm(r.title).indexOf(target) === 0; });
  if (cands.length > 0) {
    cands.sort(function(a, b) {
      return (a.url.replace(/\/$/, "").split("/").pop() || "").length
           - (b.url.replace(/\/$/, "").split("/").pop() || "").length;
    });
    return cands[0].url;
  }
  return results[0].url;
}

// ─────────────────────────────────────────────────────────────
//  GET EPISODE URL
// ─────────────────────────────────────────────────────────────
function getEpisodeUrl(seriesUrl, title, season, episode) {
  return makeRequest(seriesUrl, {
    headers: { "Referer": MAIN_URL + "/" }
  }).then(function(r) {
    return r.text();
  }).then(function(html) {
    // Find season tab with matching season number
    var postId = null, seasonId = null;
    var tabRx = /data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)(?=data-post=|$)/gi;
    var m;
    while ((m = tabRx.exec(html)) !== null) {
      var inner = m[3].replace(/<[^>]+>/g, "").trim();
      var numM  = inner.match(/(\d+)/);
      if (numM && parseInt(numM[1]) === parseInt(season)) {
        postId = m[1]; seasonId = m[2]; break;
      }
    }
    if (!postId) {
      var fb = html.match(/data-post="(\d+)"[^>]*data-season="(\d+)"/);
      if (fb) { postId = fb[1]; seasonId = fb[2]; }
    }
    
    console.log("[ToonStream] Season tab: postId=" + postId + " seasonId=" + seasonId);
    if (!postId || !seasonId) return null;
    
    return makeRequest(MAIN_URL + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": seriesUrl
      },
      body: "action=action_select_season&season=" + seasonId + "&post=" + postId
    }).then(function(r) {
      return r.text();
    }).then(function(ajaxHtml) {
      // Match SxE span first
      var epRx = /<span[^>]*class="num-epi"[^>]*>\s*(\d+)x(\d+)\s*<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi;
      var ep;
      while ((ep = epRx.exec(ajaxHtml)) !== null) {
        if (parseInt(ep[1]) === parseInt(season) && parseInt(ep[2]) === parseInt(episode)) {
          return ep[3];
        }
      }
      // Fallback: nth <a href> in episode list
      var links = ajaxHtml.match(/<a\s+href="(https?:\/\/toonstream[^"]+\/episode\/[^"]+)"/gi) || [];
      var idx   = parseInt(episode) - 1;
      if (links[idx]) {
        var hm = links[idx].match(/href="([^"]+)"/);
        if (hm) return hm[1];
      }
      return null;
    });
  }).catch(function(err) {
    console.log("[ToonStream] getEpisodeUrl error: " + err.message);
    return null;
  });
}

// ─────────────────────────────────────────────────────────────
//  SCRAPE STREAMS FROM EPISODE / MOVIE PAGE
// ─────────────────────────────────────────────────────────────
function scrapeStreams(pageUrl, title, mediaType, season, episode) {
  return makeRequest(pageUrl, {
    headers: { "Referer": MAIN_URL + "/" }
  }).then(function(r) {
    return r.text();
  }).then(function(html) {
    console.log("[ToonStream] Page HTML length: " + html.length);
    
    var serverLinks = extractServerLinks(html);
    console.log("[ToonStream] Server links: " + serverLinks.length + " — " + serverLinks.join(", "));
    
    if (serverLinks.length === 0) {
      return [diagStream("No server links in page. URL=" + pageUrl + " htmlLen=" + html.length)];
    }
    
    var allStreams = [];
    var chain = Promise.resolve();
    
    serverLinks.forEach(function(serverLink) {
      chain = chain.then(function() {
        return resolveAndExtract(serverLink, pageUrl).then(function(streams) {
          allStreams = allStreams.concat(streams);
        }).catch(function(e) {
          console.log("[ToonStream] Extractor error for " + serverLink + ": " + e.message);
        });
      });
    });
    
    return chain.then(function() {
      // Deduplicate by URL
      var seen = {}, deduped = [];
      allStreams.forEach(function(s) {
        if (s && s.url && !seen[s.url]) { seen[s.url] = true; deduped.push(s); }
      });
      
      console.log("[ToonStream] Total real streams: " + deduped.length);
      
      if (deduped.length === 0) {
        return [diagStream("Servers found(" + serverLinks.length + ") but 0 streams extracted. First=" + serverLinks[0])];
      }
      return deduped;
    });
  }).catch(function(err) {
    console.log("[ToonStream] scrapeStreams error: " + err.message);
    return [diagStream("scrapeStreams error: " + err.message)];
  });
}

// ─────────────────────────────────────────────────────────────
//  EXTRACT SERVER LINKS FROM PAGE HTML
// ─────────────────────────────────────────────────────────────
function extractServerLinks(html) {
  var links = [];
  // Find #aa-options block
  var startIdx = html.search(/id=["']aa-options["']/i);
  var block    = startIdx >= 0 ? html.slice(startIdx) : html;
  
  var m;
  // data-src iframes (lazy-loaded)
  var rx1 = /<iframe[^>]+data-src=["']([^"']+)["']/gi;
  while ((m = rx1.exec(block)) !== null) {
    var link = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
    if (link.startsWith("//")) link = "https:" + link;
    if (!link.startsWith("http")) continue;
    if (links.indexOf(link) === -1) links.push(link);
  }
  
  // Fallback: plain src iframes
  if (links.length === 0) {
    var rx2 = /<iframe[^>]+\ssrc=["']([^"']+)["']/gi;
    while ((m = rx2.exec(block)) !== null) {
      var link = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
      if (link.startsWith("//")) link = "https:" + link;
      if (!link.startsWith("http")) continue;
      if (link.indexOf(MAIN_URL) !== -1) continue;
      if (link === "about:blank" || link.indexOf("javascript:") === 0) continue;
      if (links.indexOf(link) === -1) links.push(link);
    }
  }
  return links;
}

// ─────────────────────────────────────────────────────────────
//  RESOLVE WRAPPER PAGE → REAL EMBED URL, THEN EXTRACT
// ─────────────────────────────────────────────────────────────
function resolveAndExtract(serverLink, pageReferer) {
  // Fetch the server link page to find the real embed iframe inside it
  return makeRequest(serverLink, {
    headers: { "Referer": pageReferer, "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate" }
  }).then(function(r) {
    return r.text();
  }).then(function(wrapperHtml) {
    // Look for iframe[src] or iframe[data-src] pointing to an external embed
    var embedMatch = wrapperHtml.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    var embedUrl   = null;
    if (embedMatch) {
      embedUrl = embedMatch[1].replace(/&#038;/g, "&");
      if (embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl;
      if (!embedUrl.startsWith("http") || embedUrl.indexOf(MAIN_URL) !== -1) embedUrl = null;
    }
    
    var target = embedUrl || serverLink;
    console.log("[ToonStream] Resolved: " + serverLink + " → " + target);
    return extractFrom(target, serverLink);
    
  }).catch(function(err) {
    console.log("[ToonStream] resolveAndExtract fallback for " + serverLink + ": " + err.message);
    // If wrapper fetch failed, try extracting directly
    return extractFrom(serverLink, pageReferer);
  });
}

// ─────────────────────────────────────────────────────────────
//  EXTRACTOR DISPATCH
// ─────────────────────────────────────────────────────────────
function extractFrom(url, referer) {
  var u    = url.toLowerCase();
  var name = hostLabel(url);
  console.log("[ToonStream] Extracting: " + url);
  
  if (hasAny(u, ["awstream", "zephyrflick", "zephyr"]))
    return extractAWS(url, name);
  if (hasAny(u, ["emturbovid", "embturbovid"]))
    return extractEmturbovid(url, name);
  if (hasAny(u, ["vidmoly"]))
    return extractVidmoly(url, name);
  if (hasAny(u, ["streamsb", "watchsb", "sbplay", "sbspeed", "sbfast", "sbthe"]))
    return extractStreamSB(url, name);
  if (hasAny(u, ["streamruby", "rubystm"]))
    return extractStreamRuby(url, name);
  if (hasAny(u, ["dood", "d000d"]))
    return extractDood(url, name);
  if (hasAny(u, ["vidhide", "filelions", "vidhidepro", "vidhidevip", "cdnwish"]))
    return extractVidHide(url, name);
  if (hasAny(u, ["filemoon", "premilkyway", "filesim"]))
    return extractFileMoon(url, name);
  if (hasAny(u, ["streamwish", "wishembed", "strwish", "sfastwish", "awish",
                  "jodwish", "swhoi", "hlswish", "playerwish", "nekowish"]))
    return extractStreamWish(url, name);
  if (hasAny(u, ["cloudy", "rpmshare", "upnshare"]))
    return extractVidStack(url, name);
  return extractGeneric(url, name);
}

function hasAny(str, arr) {
  for (var i = 0; i < arr.length; i++) if (str.indexOf(arr[i]) !== -1) return true;
  return false;
}
function hostLabel(url) {
  try { var h = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0]; return "ToonStream [" + h.charAt(0).toUpperCase() + h.slice(1) + "]"; }
  catch(e) { return "ToonStream"; }
}

// ─────────────────────────────────────────────────────────────
//  STREAM BUILDER — type:"hls" matching working NetMirror plugin
// ─────────────────────────────────────────────────────────────
function mkStream(url, headers, name, quality) {
  return { name: name || "ToonStream", title: quality || "Auto", url: url, quality: quality || "Auto", type: "hls", headers: headers || {} };
}

// ─────────────────────────────────────────────────────────────
//  EXTRACTORS
// ─────────────────────────────────────────────────────────────
function extractAWS(url, name) {
  var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  var hash   = url.split("/").filter(Boolean).pop();
  return makeRequest(origin + "/player/index.php?data=" + hash + "&do=getVideo", {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded", "Referer": origin },
    body: "hash=" + hash + "&r=" + origin
  }).then(function(r) { return r.json(); })
  .then(function(j) {
    if (j && j.videoSource && j.videoSource !== "0") return [mkStream(j.videoSource, {}, name, "Auto")];
    return extractGeneric(url, name);
  }).catch(function() { return extractGeneric(url, name); });
}

function extractEmturbovid(url, name) {
  return makeRequest(url, { headers: { "Referer": url } })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var m = html.match(/var\s+urlPlay\s*=\s*['"]([^'"]+)['"]/);
    if (!m) return extractGeneric(url, name);
    return [mkStream(m[1], { "Referer": url }, name, "Auto")];
  }).catch(function() { return []; });
}

function extractVidmoly(url, name) {
  var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  var idM = url.match(/\/(?:embed-|w\/)([a-zA-Z0-9]+)/);
  var target = idM ? origin + "/embed-" + idM[1] + ".html" : url;
  return makeRequest(target, { headers: { "Referer": origin + "/" } })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var content = unpackAll(html);
    var m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*?)["']/);
    if (!m) return [];
    return [mkStream(m[1], { "Referer": origin + "/" }, name, "Auto")];
  }).catch(function() { return []; });
}

function extractStreamSB(url, name) {
  var origin  = url.match(/^(https?:\/\/[^\/]+)/)[1];
  var videoId = url.split("/").filter(Boolean).pop().replace(".html", "");
  var hexId   = videoId.split("").map(function(c) { return c.charCodeAt(0).toString(16); }).join("");
  return makeRequest(origin + "/sources48/" + hexId, {
    headers: { "watchsb": "sbstream", "Referer": url }
  }).then(function(r) { return r.json(); })
  .then(function(j) {
    if (j && j.stream_data && j.stream_data.file) return [mkStream(j.stream_data.file, { "Referer": origin + "/" }, name, "Auto")];
    return extractGeneric(url, name);
  }).catch(function() { return extractGeneric(url, name); });
}

function extractStreamRuby(url, name) {
  return makeRequest(url.replace(/\/e\//, "/"), { headers: { "Referer": url } })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var content = unpackAll(html);
    var m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (!m) return [];
    return [mkStream(m[1], { "Referer": url }, name, "Auto")];
  }).catch(function() { return []; });
}

function extractDood(url, name) {
  var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  return makeRequest(url, { headers: { "Referer": origin + "/" } })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var md5M   = html.match(/\/pass_md5\/[^\s"'<]+/);
    var tokM   = html.match(/\?token=([^&"'\s]+)/);
    if (!md5M) return extractGeneric(url, name);
    return makeRequest(origin + md5M[0], { headers: { "Referer": url } })
    .then(function(r) { return r.text(); })
    .then(function(md5) {
      var rand = Math.random().toString(36).slice(2, 14);
      return [mkStream(md5.trim() + rand + "?token=" + (tokM ? tokM[1] : "") + "&expiry=" + Date.now(), { "Referer": origin + "/" }, name, "Auto")];
    });
  }).catch(function() { return []; });
}

function extractVidHide(url, name) {
  var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  var embed  = url.replace(/\/(d|f|file|download)\//, "/v/");
  return makeRequest(embed, { headers: { "Referer": embed, "Origin": origin } })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var content = unpackAll(html);
    var m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (!m) m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (!m) return [];
    return [mkStream(m[1], { "Referer": origin + "/" }, name, "Auto")];
  }).catch(function() { return []; });
}

function extractFileMoon(url, name) {
  return makeRequest(url, { headers: { "Referer": url } })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var content = unpackAll(html);
    var m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (!m) return [];
    return [mkStream(m[1], { "Referer": url }, name, "Auto")];
  }).catch(function() { return []; });
}

function extractStreamWish(url, name) {
  var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  return makeRequest(url, { headers: { "Referer": origin + "/" } })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var content = unpackAll(html);
    var m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (!m) m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (!m) return [];
    return [mkStream(m[1], { "Referer": origin + "/" }, name, "Auto")];
  }).catch(function() { return []; });
}

function extractVidStack(url, name) {
  var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
  var id = url.split("/").filter(Boolean).pop();
  return makeRequest(origin + "/api/source/" + id, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": url },
    body: "r=" + encodeURIComponent(url)
  }).then(function(r) { return r.json(); })
  .then(function(j) {
    if (!j || !j.data) return [];
    return j.data.filter(function(i) { return i.file && i.file.indexOf(".m3u8") !== -1; })
              .map(function(i) { return mkStream(i.file, { "Referer": url }, name, "Auto"); });
  }).catch(function() { return []; });
}

function extractGeneric(url, name) {
  return makeRequest(url, { headers: { "Referer": url } })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var content = unpackAll(html);
    var results = [], seen = {};
    var rx = /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/gi;
    var m;
    while ((m = rx.exec(content)) !== null) {
      var link = m[1].replace(/\\/g, "");
      if (!seen[link] && link.indexOf("error") === -1) {
        seen[link] = true;
        results.push(mkStream(link, { "Referer": url }, name, "Auto"));
      }
    }
    return results;
  }).catch(function() { return []; });
}

// ─────────────────────────────────────────────────────────────
//  PACKER UNPACKER
// ─────────────────────────────────────────────────────────────
function unpackAll(content) {
  var result = content;
  for (var i = 0; i < 5; i++) {
    var m = result.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]*?\.split\('\|'\)\)/);
    if (!m) break;
    var up = unpackOne(m[0]);
    if (!up || up === result) break;
    result = up;
  }
  return result;
}
function unpackOne(p) {
  try {
    var args = p.match(/\}\s*\(\s*'([\s\S]*)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!args) return null;
    var payload = args[1], radix = parseInt(args[2]), dict = args[4].split("|");
    return payload.replace(/\b\w+\b/g, function(w) {
      var n = parseInt(w, radix);
      return (Number.isFinite(n) && dict[n]) ? dict[n] : w;
    });
  } catch(e) { return null; }
}

// ─────────────────────────────────────────────────────────────
//  EXPORT — same guard pattern as working NetMirror plugin
// ─────────────────────────────────────────────────────────────
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
