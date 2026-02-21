// ToonStream Provider for Nuvio
// Version: 22.0 â€” Rebuilt using NetMirror as structural reference
// Stream object format, export pattern, and fetch style all match working NetMirror plugin

console.log("[ToonStream] Initializing ToonStream provider");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL     = "https://toonstream.dad";
const USER_AGENT   = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36";

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  HTTP helper â€” same pattern as NetMirror's makeRequest
//  Returns response.text() directly (not the response object)
//  Returns null on any failure instead of throwing
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fetchText(url, options) {
    options = options || {};
    var headers = Object.assign({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": MAIN_URL
    }, options.headers || {});

    return fetch(url, Object.assign({}, options, { headers: headers }))
        .then(function(r) {
            if (!r.ok) {
                console.log("[ToonStream] HTTP " + r.status + " for: " + url);
                return null;
            }
            return r.text();
        })
        .catch(function(e) {
            console.log("[ToonStream] Fetch error for " + url + ": " + e.message);
            return null;
        });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  MAIN ENTRY POINT
//  Nuvio calls getStreams(tmdbId, mediaType, season, episode)
//  Must return a Promise that resolves to an array of stream objects
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[ToonStream] getStreams called: tmdbId=" + tmdbId + " type=" + mediaType + " S" + season + "E" + episode);

    var tmdbUrl = "https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;

    return fetchText(tmdbUrl)
        .then(function(tmdbText) {
            if (!tmdbText) throw new Error("TMDB fetch failed");
            var tmdbData = JSON.parse(tmdbText);
            var title = mediaType === "movie" ? tmdbData.title : tmdbData.name;
            var year  = ((mediaType === "movie" ? tmdbData.release_date : tmdbData.first_air_date) || "").slice(0, 4);
            if (!title) throw new Error("No title from TMDB");

            var cleanTitle = title.replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim();
            console.log("[ToonStream] Title: \"" + title + "\" Year: " + year);

            // â”€â”€ 1. Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            var searchUrl = MAIN_URL + "/page/1/?s=" + encodeURIComponent(cleanTitle);
            console.log("[ToonStream] Searching: " + searchUrl);

            return fetchText(searchUrl).then(function(searchHtml) {
                if (!searchHtml) throw new Error("Search fetch failed");

                // Parse search results â€” extract href + title from inside <h2> of each article.
                // The <h2><a href="URL">Title</a></h2> is always the correct article link.
                // This avoids picking up category/tag links that appear before the article link.
                var results = [];
                var chunks = searchHtml.split(/<article[\s\S]*?>/i);
                for (var i = 1; i < chunks.length; i++) {
                    var chunk = chunks[i];
                    // Primary: href from inside h2 anchor
                    var h2LinkMatch = chunk.match(/<h2[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
                    var rawUrl, rawTitle;
                    if (h2LinkMatch) {
                        rawUrl   = h2LinkMatch[1];
                        rawTitle = h2LinkMatch[2].replace(/<[^>]+>/g, "").replace(/Watch Online/gi, "").trim();
                    } else {
                        // Fallback: plain h2 text + first non-category <a> in chunk
                        var h2TextMatch = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
                        if (!h2TextMatch) continue;
                        rawTitle = h2TextMatch[1].replace(/<[^>]+>/g, "").replace(/Watch Online/gi, "").trim();
                        var allHrefs = chunk.match(/<a\s+href="([^"]+)"/gi) || [];
                        rawUrl = "";
                        for (var j = 0; j < allHrefs.length; j++) {
                            var hrefVal = allHrefs[j].match(/href="([^"]+)"/)[1];
                            if (hrefVal.indexOf("/category/") === -1 &&
                                hrefVal.indexOf("/tag/")      === -1 &&
                                hrefVal.indexOf("/page/")     === -1 &&
                                hrefVal.indexOf("/?")         === -1 &&
                                hrefVal !== MAIN_URL && hrefVal !== MAIN_URL + "/") {
                                rawUrl = hrefVal; break;
                            }
                        }
                    }
                    if (!rawUrl || !rawTitle) continue;
                    if (!rawUrl.startsWith("http")) rawUrl = MAIN_URL + rawUrl;
                    // Skip episode pages â€” we need series/movie landing pages only
                    if (rawUrl.indexOf("/episode/") !== -1) continue;
                    if (rawUrl === MAIN_URL || rawUrl === MAIN_URL + "/") continue;
                    results.push({ url: rawUrl, title: rawTitle });
                }

                console.log("[ToonStream] Search results: " + results.length);
                results.forEach(function(r) { console.log("[ToonStream]   " + r.title + " => " + r.url); });

                if (results.length === 0) throw new Error("No search results");

                // â”€â”€ 2. Select best match â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
                var target     = norm(title);
                var slugTarget = cleanTitle.toLowerCase().replace(/\s+/g, "-");

                // Step 1: exact normalized title ("ben10" === "ben10")
                var selected = null;
                for (var k = 0; k < results.length; k++) {
                    if (norm(results[k].title) === target) { selected = results[k]; break; }
                }

                // Step 2: slug is an exact path segment (/series/ben-10/ NOT /series/ben-10-alien-force/)
                if (!selected) {
                    for (var k = 0; k < results.length; k++) {
                        try {
                            var segs = results[k].url.split("/").filter(function(s) { return s !== ""; });
                            if (segs.indexOf(slugTarget) !== -1) { selected = results[k]; break; }
                        } catch(e) {}
                    }
                }

                // Step 3: shortest slug wins (base title < spinoff)
                if (!selected) {
                    var candidates = results.filter(function(r) { return norm(r.title).indexOf(target) === 0; });
                    if (candidates.length > 0) {
                        candidates.sort(function(a, b) {
                            var aSlug = a.url.split("/").filter(function(s){return s;}).pop() || "";
                            var bSlug = b.url.split("/").filter(function(s){return s;}).pop() || "";
                            return aSlug.length - bSlug.length;
                        });
                        selected = candidates[0];
                    }
                }

                // Step 4: first result fallback
                if (!selected) selected = results[0];

                console.log("[ToonStream] Selected: " + selected.title + " => " + selected.url);

                // â”€â”€ 3. TV: find episode URL via AJAX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                if (mediaType === "tv") {
                    return fetchText(selected.url).then(function(pageHtml) {
                        if (!pageHtml) throw new Error("Series page fetch failed");

                        // Find season tab: data-post + data-season attributes
                        var postId = null, seasonId = null;
                        var tabPattern = /data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)(?=data-post=|<\/ul>|$)/gi;
                        var tabMatch;
                        while ((tabMatch = tabPattern.exec(pageHtml)) !== null) {
                            var innerText = tabMatch[3].replace(/<[^>]+>/g, "").trim();
                            var numM = innerText.match(/(\d+)/);
                            if (numM && parseInt(numM[1]) === parseInt(season)) {
                                postId = tabMatch[1]; seasonId = tabMatch[2]; break;
                            }
                        }
                        // Fallback: single season
                        if (!postId) {
                            var fb = pageHtml.match(/data-post="(\d+)"[^>]*data-season="(\d+)"/);
                            if (fb) { postId = fb[1]; seasonId = fb[2]; }
                        }

                        console.log("[ToonStream] Season tab: postId=" + postId + " seasonId=" + seasonId);
                        if (!postId || !seasonId) throw new Error("Season tab not found");

                        // AJAX fetch episode list
                        return fetchText(MAIN_URL + "/wp-admin/admin-ajax.php", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                                "X-Requested-With": "XMLHttpRequest",
                                "Referer": selected.url
                            },
                            body: "action=action_select_season&season=" + seasonId + "&post=" + postId
                        }).then(function(ajaxHtml) {
                            if (!ajaxHtml) throw new Error("AJAX fetch failed");

                            // Match episode by NxNN span
                            var foundEpUrl = null;
                            var epPattern = /<span[^>]*class="num-epi"[^>]*>\s*(\d+)x(\d+)\s*<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi;
                            var epMatch;
                            while ((epMatch = epPattern.exec(ajaxHtml)) !== null) {
                                if (parseInt(epMatch[1]) === parseInt(season) && parseInt(epMatch[2]) === parseInt(episode)) {
                                    foundEpUrl = epMatch[3]; break;
                                }
                            }
                            // Fallback: nth article link
                            if (!foundEpUrl) {
                                var epLinks = ajaxHtml.match(/<article[\s\S]*?<a\s+href="([^"]+)"/gi) || [];
                                var idx = parseInt(episode) - 1;
                                if (epLinks[idx]) {
                                    var epHrefM = epLinks[idx].match(/href="([^"]+)"/);
                                    if (epHrefM) foundEpUrl = epHrefM[1];
                                }
                            }

                            console.log("[ToonStream] Episode URL: " + foundEpUrl);
                            if (!foundEpUrl) throw new Error("Episode URL not found");
                            return foundEpUrl;
                        });
                    }).then(function(episodeUrl) {
                        return extractStreamsFromPage(episodeUrl);
                    });
                }

                // â”€â”€ 4. Movie: extract directly â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                return extractStreamsFromPage(selected.url);
            });
        })
        .catch(function(e) {
            console.error("[ToonStream] Fatal error: " + e.message);
            return [];
        });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXTRACT STREAMS FROM A PAGE (episode or movie)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function extractStreamsFromPage(pageUrl) {
    console.log("[ToonStream] Extracting streams from: " + pageUrl);

    return fetchText(pageUrl).then(function(html) {
        if (!html) {
            console.log("[ToonStream] Page fetch failed: " + pageUrl);
            return [];
        }

        var serverLinks = extractServerLinks(html, pageUrl);
        console.log("[ToonStream] Server links found: " + serverLinks.length);
        serverLinks.forEach(function(s) { console.log("[ToonStream]   server: " + s); });

        if (serverLinks.length === 0) return [];

        // Process each server link sequentially, collecting all streams
        var allStreams = [];
        var chain = Promise.resolve();

        serverLinks.forEach(function(serverLink) {
            chain = chain.then(function() {
                // Kotlin: val truelink = app.get(serverLink).selectFirst("iframe")?.attr("src")
                // Always resolve to the real embed URL first
                return resolveEmbed(serverLink, pageUrl).then(function(embedUrl) {
                    var target = embedUrl || serverLink;
                    console.log("[ToonStream] Embed resolved: " + serverLink + " â†’ " + target);
                    return dispatchExtractor(target, pageUrl);
                }).then(function(streams) {
                    allStreams = allStreams.concat(streams);
                }).catch(function(e) {
                    console.log("[ToonStream] Extractor error for " + serverLink + ": " + e.message);
                });
            });
        });

        return chain.then(function() {
            // Deduplicate by URL
            var seen = {};
            var deduped = allStreams.filter(function(s) {
                if (!s.url || seen[s.url]) return false;
                seen[s.url] = true;
                return true;
            });
            console.log("[ToonStream] Total streams: " + deduped.length);
            return deduped;
        });
    });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  SERVER LINK EXTRACTION
//  Finds all iframe[data-src] inside #aa-options block.
//  Falls back to all external iframe[src] if none found.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function extractServerLinks(html, pageUrl) {
    var links = [];

    // Locate #aa-options block and scan forward from there
    var startIdx = html.search(/id=["']aa-options["']/i);
    var block = startIdx >= 0 ? html.slice(startIdx) : html;

    // Collect data-src iframes (lazy-loaded servers)
    var dSrcRx = /<iframe[^>]+data-src=["']([^"']+)["']/gi;
    var m;
    while ((m = dSrcRx.exec(block)) !== null) {
        var link = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
        if (!link.startsWith("http")) link = "https:" + link;
        if (links.indexOf(link) === -1) links.push(link);
    }

    // Fallback: plain src iframes (some pages don't use data-src)
    if (links.length === 0) {
        var srcRx = /<iframe[^>]+src=["']([^"']+)["']/gi;
        while ((m = srcRx.exec(block)) !== null) {
            var link = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
            if (!link.startsWith("http")) link = "https:" + link;
            if (link.indexOf(MAIN_URL) !== -1) continue;
            if (link.startsWith("javascript") || link === "about:blank") continue;
            if (links.indexOf(link) === -1) links.push(link);
        }
    }

    return links;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EMBED RESOLVER
//  Kotlin: app.get(serverLink).selectFirst("iframe")?.attr("src")
//  Fetches the server redirect page and extracts the real embed URL
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function resolveEmbed(url, referer) {
    return fetchText(url, {
        headers: { "Referer": referer, "Sec-Fetch-Dest": "iframe" }
    }).then(function(html) {
        if (!html) return null;
        var m = html.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i);
        if (!m) return null;
        var resolved = m[1].replace(/&#038;/g, "&");
        if (resolved.startsWith("//")) resolved = "https:" + resolved;
        if (!resolved.startsWith("http")) return null;
        if (resolved.indexOf(MAIN_URL) !== -1) return null; // avoid internal loops
        return resolved;
    }).catch(function() { return null; });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXTRACTOR DISPATCHER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function dispatchExtractor(url, referer) {
    var u = url.toLowerCase();

    if (has(u, ["awstream", "zephyrflick", "zephyr.top", "zephyr.cc"]))
        return extractAWSStream(url);

    if (has(u, ["gdmirrorbot", "techinmind"]))
        return extractGDMirrorBot(url);

    if (has(u, ["cloudy.", "upns.one", "rpmshare", "upnshare", "streamp2p"]))
        return extractVidStack(url, labelFor(url));

    if (has(u, ["emturbovid", "embturbovid"]))
        return extractEmturbovid(url, labelFor(url));

    if (has(u, ["vidmoly"]))
        return extractVidmoly(url, labelFor(url));

    if (has(u, ["streamsb", "watchsb", "sbplay", "sbspeed", "sbfast", "sblive", "sbthe",
                "streamruby", "rubystm"]))
        return extractStreamSB(url, labelFor(url));

    if (has(u, ["dood", "d000d", "do0d", "doo.to"]))
        return extractDoodStream(url, labelFor(url));

    if (has(u, ["vidhide", "filelions", "vidhidepro", "vidhidevip", "vidhidehub",
                "cdnwish", "ryderjet", "kinoger", "smoothpre", "dhtpre", "peytonepre"]))
        return extractVidHide(url, labelFor(url));

    if (has(u, ["filemoon", "premilkyway", "file-moon", "filesim", "moonfiles"]))
        return extractFileMoon(url, labelFor(url));

    if (has(u, ["streamwish", "wishembed", "strwish", "sfastwish", "flaswish",
                "awish", "jodwish", "swhoi", "hlswish", "playerwish", "wishfast",
                "wishonly", "swdyu", "mwish", "dwish", "obeywish", "uqloads",
                "nekowish", "nekostream", "streamhls"]))
        return extractStreamWish(url, labelFor(url));

    // Universal fallback
    return extractUniversal(url, labelFor(url));
}

function has(url, keywords) {
    for (var i = 0; i < keywords.length; i++) {
        if (url.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
}

function labelFor(url) {
    try {
        var host = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0];
        return "ToonStream [" + host.charAt(0).toUpperCase() + host.slice(1) + "]";
    } catch(e) { return "ToonStream"; }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  STREAM OBJECT BUILDER
//  Matches NetMirror's stream object format exactly:
//  { name, title, url, quality, type: "hls", headers }
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function mkStream(url, headers, name, quality) {
    return {
        name:    name    || "ToonStream",
        title:   quality || "Auto",
        url:     url,
        quality: quality || "Auto",
        type:    "hls",
        headers: headers || {}
    };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXTRACTORS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// AWSStream / Zephyrflick
function extractAWSStream(url) {
    try {
        var parts  = url.split("/");
        var hash   = parts[parts.length - 1] || parts[parts.length - 2];
        var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
        var apiUrl = origin + "/player/index.php?data=" + hash + "&do=getVideo";

        return fetchText(apiUrl, {
            method: "POST",
            headers: {
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": origin
            },
            body: "hash=" + hash + "&r=" + origin
        }).then(function(text) {
            if (!text) return [];
            var json = JSON.parse(text);
            if (json && json.videoSource && json.videoSource !== "0") {
                var name = url.indexOf("zephyr") !== -1 ? "ToonStream [Zephyr]" : "ToonStream [AWS]";
                console.log("[ToonStream] AWSStream URL: " + json.videoSource);
                return [mkStream(json.videoSource, {}, name, "Auto")];
            }
            return [];
        }).catch(function() { return []; });
    } catch(e) { return Promise.resolve([]); }
}

// VidStack (Cloudy, RpmShare, UpnShare)
function extractVidStack(url, name) {
    try {
        var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
        var id = url.split("/").filter(function(s){return s;}).pop();
        return fetchText(origin + "/api/source/" + id, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": url, "Origin": origin },
            body: "r=" + encodeURIComponent(url) + "&d=" + url.replace(/^https?:\/\//, "").split("/")[0]
        }).then(function(text) {
            if (!text) return [];
            var json = JSON.parse(text);
            if (!json || !json.data) return [];
            return json.data
                .filter(function(i) { return i.file && (i.file.indexOf(".m3u8") !== -1 || i.type === "hls"); })
                .map(function(i) { return mkStream(i.file, { "Referer": url }, name, "Auto"); });
        }).catch(function() { return []; });
    } catch(e) { return Promise.resolve([]); }
}

// Emturbovid
function extractEmturbovid(url, name) {
    return fetchText(url, { headers: { "Referer": url } }).then(function(html) {
        if (!html) return [];
        var m = html.match(/var\s+urlPlay\s*=\s*['"]([^'"]+)['"]/);
        if (!m) return [];
        console.log("[ToonStream] Emturbovid URL: " + m[1]);
        return [mkStream(m[1], { "Referer": url }, name, "Auto")];
    }).catch(function() { return []; });
}

// Vidmoly
function extractVidmoly(url, name) {
    var origin;
    try { origin = url.match(/^(https?:\/\/[^\/]+)/)[1]; } catch(e) { return Promise.resolve([]); }
    var idM = url.match(/\/(?:embed-|w\/)([a-zA-Z0-9]+)/);
    var embedUrl = idM ? (origin + "/embed-" + idM[1] + ".html") : url;

    return fetchText(embedUrl, {
        headers: { "Referer": origin + "/", "Sec-Fetch-Dest": "iframe" }
    }).then(function(html) {
        if (!html) return [];
        var content = unpackAll(html);
        var m = content.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*?)["'`]/);
        if (!m) return [];
        console.log("[ToonStream] Vidmoly URL: " + m[1]);
        return [mkStream(m[1], { "Referer": origin + "/" }, name, "Auto")];
    }).catch(function() { return []; });
}

// StreamSB / StreamRuby
function extractStreamSB(url, name) {
    // StreamRuby: scrape m3u8 from page
    if (url.indexOf("streamruby") !== -1 || url.indexOf("rubystm") !== -1) {
        var fetchUrl = url.replace(/\/e\//, "/");
        return fetchText(fetchUrl, { headers: { "Referer": url } }).then(function(html) {
            if (!html) return [];
            var content = unpackAll(html);
            var m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
            if (!m) return [];
            return [mkStream(m[1], { "Referer": url }, name, "Auto")];
        }).catch(function() { return []; });
    }

    // StreamSB: hex-encoded API
    try {
        var origin  = url.match(/^(https?:\/\/[^\/]+)/)[1];
        var pathParts = url.split("/").filter(function(s){return s && s !== "e" && s !== "embed";});
        var videoId = pathParts[pathParts.length - 1].replace(".html","");
        var hexId   = videoId.split("").map(function(c){return c.charCodeAt(0).toString(16);}).join("");

        return fetchText(origin + "/sources48/" + hexId, {
            headers: { "watchsb": "sbstream", "Referer": url }
        }).then(function(text) {
            if (!text) return extractUniversal(url, name);
            var json = JSON.parse(text);
            if (json && json.stream_data && json.stream_data.file) {
                return [mkStream(json.stream_data.file, { "Referer": origin + "/" }, name, "Auto")];
            }
            return extractUniversal(url, name);
        }).catch(function() { return extractUniversal(url, name); });
    } catch(e) { return extractUniversal(url, name); }
}

// DoodStream
function extractDoodStream(url, name) {
    var origin;
    try { origin = url.match(/^(https?:\/\/[^\/]+)/)[1]; } catch(e) { return Promise.resolve([]); }

    return fetchText(url, { headers: { "Referer": origin + "/" } }).then(function(html) {
        if (!html) return [];
        var md5M   = html.match(/\/pass_md5\/[^\s"'<]+/);
        var tokenM = html.match(/\?token=([^&"'\s]+)/);
        if (!md5M) return extractUniversal(url, name);

        return fetchText(origin + md5M[0], { headers: { "Referer": url } }).then(function(md5Resp) {
            if (!md5Resp) return [];
            var rand     = Math.random().toString(36).substring(2, 14);
            var ts       = Date.now();
            var token    = tokenM ? tokenM[1] : "";
            var finalUrl = md5Resp.trim() + rand + "?token=" + token + "&expiry=" + ts;
            return [mkStream(finalUrl, { "Referer": origin + "/" }, name, "Auto")];
        });
    }).catch(function() { return []; });
}

// VidHide / FileLions / VidHidePro family
function extractVidHide(url, name) {
    var embedUrl = url.replace(/\/(d|download|file|f)\//, "/v/");
    var origin;
    try { origin = url.match(/^(https?:\/\/[^\/]+)/)[1]; } catch(e) { return Promise.resolve([]); }

    return fetchText(embedUrl, {
        headers: { "Referer": embedUrl, "Origin": origin }
    }).then(function(html) {
        if (!html) return [];
        var content = unpackAll(html);
        if (content.indexOf("var links") !== -1) {
            content = content.split("var links").slice(1).join("");
        }
        var results = [];
        var seen = {};
        var rx = /:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        var m;
        while ((m = rx.exec(content)) !== null) {
            if (!seen[m[1]]) {
                seen[m[1]] = true;
                results.push(mkStream(m[1], { "Referer": origin + "/", "Origin": origin }, name, "Auto"));
            }
        }
        return results;
    }).catch(function() { return []; });
}

// FileMoon / Filesim family
function extractFileMoon(url, name) {
    return fetchText(url, { headers: { "Referer": url } }).then(function(html) {
        if (!html) return [];
        var content = unpackAll(html);
        var m = content.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/);
        if (!m) return [];
        return [mkStream(m[1], { "Referer": url }, name, "Auto")];
    }).catch(function() { return []; });
}

// StreamWish family
function extractStreamWish(url, name) {
    var origin;
    try { origin = url.match(/^(https?:\/\/[^\/]+)/)[1]; } catch(e) { return Promise.resolve([]); }
    var vidM = url.match(/\/(?:f|e)\/([a-zA-Z0-9]+)/);
    var embedUrl = vidM ? (origin + "/" + vidM[1]) : url;

    return fetchText(embedUrl, { headers: { "Referer": origin + "/", "Origin": origin } }).then(function(html) {
        if (!html) return [];
        var content = unpackAll(html);
        // Try file: "url" pattern first
        var m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (!m) m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (!m) return [];
        return [mkStream(m[1], { "Referer": origin + "/" }, name, "Auto")];
    }).catch(function() { return []; });
}

// GDMirrorbot / Techinmind
function extractGDMirrorBot(url) {
    var origin;
    try { origin = url.match(/^(https?:\/\/[^\/]+)/)[1]; } catch(e) { return Promise.resolve([]); }
    var sid = "";
    var host = origin;

    var basePromise;

    if (url.indexOf("key=") !== -1) {
        basePromise = fetchText(url).then(function(pageText) {
            if (!pageText) return { sid: "", host: host };
            var finalId  = (pageText.match(/FinalID\s*=\s*"([^"]+)"/)  || [])[1];
            var myKey    = (pageText.match(/myKey\s*=\s*"([^"]+)"/)    || [])[1];
            var idType   = (pageText.match(/idType\s*=\s*"([^"]+)"/)   || [])[1] || "imdbid";
            var baseUrlM = pageText.match(/let\s+baseUrl\s*=\s*"([^"]+)"/);
            var newHost  = host;
            if (baseUrlM) try { newHost = baseUrlM[1].match(/^(https?:\/\/[^\/]+)/)[1]; } catch(e) {}

            if (!finalId || !myKey) return { sid: "", host: newHost };

            var apiUrl;
            if (url.indexOf("/tv/") !== -1) {
                var s = (url.match(/\/tv\/\d+\/(\d+)\//) || [])[1] || "1";
                var e = (url.match(/\/tv\/\d+\/\d+\/(\d+)/) || [])[1] || "1";
                apiUrl = newHost + "/myseriesapi?tmdbid=" + finalId + "&season=" + s + "&epname=" + e + "&key=" + myKey;
            } else {
                apiUrl = newHost + "/mymovieapi?" + idType + "=" + finalId + "&key=" + myKey;
            }
            return fetchText(apiUrl).then(function(apiText) {
                if (!apiText) return { sid: "", host: newHost };
                var apiJ = JSON.parse(apiText);
                var newSid = (apiJ && apiJ.data && apiJ.data[0] && apiJ.data[0].fileslug) ? apiJ.data[0].fileslug : "";
                return { sid: newSid, host: newHost };
            });
        });
    } else {
        var parts = url.split("/").filter(function(s){return s;});
        sid = parts[parts.length - 1];
        basePromise = Promise.resolve({ sid: sid, host: host });
    }

    return basePromise.then(function(state) {
        var useSid  = state.sid || url.split("/").filter(function(s){return s;}).pop();
        var useHost = state.host;
        if (!useSid) return [];

        return fetchText(useHost + "/embedhelper.php", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "sid=" + useSid
        }).then(function(text) {
            if (!text) return [];
            var data = JSON.parse(text);
            if (!data.siteUrls || !data.mresult) return [];

            var siteUrls      = data.siteUrls;
            var friendlyNames = data.siteFriendlyNames || {};
            var mresult = {};
            if (typeof data.mresult === "object") mresult = data.mresult;
            else try { mresult = JSON.parse(atob(data.mresult)); } catch(e) {}

            var subUrls = [];
            Object.keys(siteUrls).forEach(function(key) {
                if (!mresult[key]) return;
                var full = siteUrls[key].replace(/\/$/, "") + "/" + mresult[key].replace(/^\//, "");
                subUrls.push(full);
            });

            var subStreams = [];
            var chain = Promise.resolve();
            subUrls.forEach(function(subUrl) {
                chain = chain.then(function() {
                    return dispatchExtractor(subUrl, url).then(function(res) {
                        subStreams = subStreams.concat(res);
                    });
                });
            });
            return chain.then(function() { return subStreams; });
        });
    }).catch(function(e) {
        console.log("[ToonStream] GDMirror error: " + e.message);
        return [];
    });
}

// Universal fallback â€” unpack + scrape any m3u8
function extractUniversal(url, name) {
    return fetchText(url, { headers: { "Referer": url } }).then(function(html) {
        if (!html) return [];
        var content = unpackAll(html);
        var results = [];
        var seen = {};
        var rx = /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/gi;
        var m;
        while ((m = rx.exec(content)) !== null) {
            var link = m[1].replace(/\\/g, "");
            if (link.indexOf("error") !== -1 || link.indexOf("red/pixel") !== -1) continue;
            if (!seen[link]) {
                seen[link] = true;
                console.log("[ToonStream] Universal found: " + link);
                results.push(mkStream(link, { "Referer": url }, name || "ToonStream [HLS]", "Auto"));
            }
        }
        return results;
    }).catch(function() { return []; });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  P.A.C.K.E.R UNPACKER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function unpackAll(content) {
    var result = content;
    for (var i = 0; i < 5; i++) {
        var packed = result.match(/(eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]*?\.split\('\|'\)\)(?:\))?)/);
        if (!packed) break;
        var up = unpack(packed[1]);
        if (!up || up === result) break;
        result = up;
    }
    return result;
}

function unpack(p) {
    try {
        var params = p.match(/\}\s*\(\s*'([\s\S]*)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!params) return null;
        var payload = params[1], radix = parseInt(params[2]), dict = params[4].split("|");
        return payload.replace(/\b\w+\b/g, function(w) {
            var idx = parseInt(w, radix);
            return (Number.isFinite(idx) && dict[idx]) ? dict[idx] : w;
        });
    } catch(e) { return null; }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXPORT â€” match NetMirror's exact export pattern
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.getStreams = getStreams;
}
