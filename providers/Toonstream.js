// ToonStream Provider for Nuvio
// Version: 23.0 â€” Built per official nuvio-providers documentation
// Stream format: { name, title, url, quality, headers }
// Export: module.exports = { getStreams }
// Engine: Hermes-compatible (Promise chains, no async/await)

console.log("[ToonStream] Loaded v24.0");

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var MAIN_URL     = "https://toonstream.dad";
var USER_AGENT   = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36";

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  ENTRY POINT
//  Called by Nuvio: getStreams(tmdbId, mediaType, season, episode)
//  Must return a Promise that resolves to array of stream objects
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[ToonStream] getStreams called â€” tmdbId=" + tmdbId + " type=" + mediaType + " S" + season + "E" + episode);

    return get("https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY)
        .then(function(tmdbText) {
            var tmdbData   = JSON.parse(tmdbText);
            var title      = mediaType === "movie" ? tmdbData.title : tmdbData.name;
            var cleanTitle = title.replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim();
            console.log("[ToonStream] Title: " + title);

            return search(cleanTitle, title).then(function(contentUrl) {
                if (!contentUrl) {
                    console.log("[ToonStream] No match found in search");
                    return [];
                }
                console.log("[ToonStream] Content URL: " + contentUrl);

                if (mediaType !== "tv") {
                    return scrapeStreams(contentUrl);
                }

                // TV: resolve episode URL first
                return getEpisodeUrl(contentUrl, season, episode).then(function(epUrl) {
                    if (!epUrl) {
                        console.log("[ToonStream] Episode URL not found");
                        return [];
                    }
                    console.log("[ToonStream] Episode URL: " + epUrl);
                    return scrapeStreams(epUrl);
                });
            });
        })
        .catch(function(err) {
            console.error("[ToonStream] Top-level error: " + err);
            return [];
        });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  SEARCH â€” find the best matching series/movie page
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function search(cleanTitle, originalTitle) {
    var searchUrl = MAIN_URL + "/page/1/?s=" + encodeURIComponent(cleanTitle);
    console.log("[ToonStream] Searching: " + searchUrl);

    return get(searchUrl).then(function(html) {
        // Parse results: each article's href and title come from inside <h2>
        // to avoid picking up category/tag hrefs that appear first in the chunk.
        var results = [];
        var chunks  = html.split(/<article[\s\S]*?>/i);

        for (var i = 1; i < chunks.length; i++) {
            var chunk = chunks[i];

            // Primary: <h2 ...><a href="URL">Title</a></h2>
            var h2a = chunk.match(/<h2[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            var url, rawTitle;

            if (h2a) {
                url      = h2a[1];
                rawTitle = h2a[2].replace(/<[^>]+>/g, "").replace(/Watch Online/gi, "").trim();
            } else {
                // Fallback: plain h2 text + first non-category <a> href in chunk
                var h2t = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
                if (!h2t) continue;
                rawTitle = h2t[1].replace(/<[^>]+>/g, "").replace(/Watch Online/gi, "").trim();
                var hrefs = (chunk.match(/<a\s+href="([^"]+)"/gi) || []);
                url = "";
                for (var j = 0; j < hrefs.length; j++) {
                    var hv = hrefs[j].match(/href="([^"]+)"/)[1];
                    if (hv.indexOf("/category/") === -1 && hv.indexOf("/tag/") === -1 &&
                        hv.indexOf("/page/") === -1 && hv.indexOf("/?") === -1) {
                        url = hv; break;
                    }
                }
            }

            if (!url || !rawTitle) continue;
            if (!url.startsWith("http")) url = MAIN_URL + url;
            // Skip episode pages and pagination
            if (url.indexOf("/episode/") !== -1) continue;
            if (url === MAIN_URL || url === MAIN_URL + "/") continue;

            results.push({ url: url, title: rawTitle });
        }

        console.log("[ToonStream] Search results (" + results.length + "):");
        results.forEach(function(r) { console.log("  " + r.title + " => " + r.url); });

        return pickBest(results, originalTitle);
    }).catch(function(err) {
        console.log("[ToonStream] Search error: " + err);
        return null;
    });
}

function pickBest(results, title) {
    if (!results.length) return null;

    function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

    var target     = norm(title);
    var cleanTitle = title.replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim();
    var slugTarget = cleanTitle.toLowerCase().replace(/\s+/g, "-");

    // Step 1: exact normalized title match ("ben10" === "ben10")
    for (var i = 0; i < results.length; i++) {
        if (norm(results[i].title) === target) {
            console.log("[ToonStream] Matched step1 (exact): " + results[i].title);
            return results[i].url;
        }
    }

    // Step 2: URL slug is an exact path segment
    // /series/ben-10/ matches "ben-10" but NOT /series/ben-10-alien-force/
    for (var i = 0; i < results.length; i++) {
        var segs = results[i].url.replace(/\/$/, "").split("/");
        if (segs.indexOf(slugTarget) !== -1) {
            console.log("[ToonStream] Matched step2 (slug segment): " + results[i].title);
            return results[i].url;
        }
    }

    // Step 3: shortest slug among titles that start with target
    // (base title is shorter than spinoffs: "ben-10" < "ben-10-alien-force")
    var candidates = results.filter(function(r) {
        return norm(r.title).indexOf(target) === 0;
    });
    if (candidates.length > 0) {
        candidates.sort(function(a, b) {
            var aSlug = a.url.replace(/\/$/, "").split("/").pop() || "";
            var bSlug = b.url.replace(/\/$/, "").split("/").pop() || "";
            return aSlug.length - bSlug.length;
        });
        console.log("[ToonStream] Matched step3 (shortest slug): " + candidates[0].title);
        return candidates[0].url;
    }

    // Step 4: first result
    console.log("[ToonStream] Matched step4 (first result): " + results[0].title);
    return results[0].url;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EPISODE URL â€” AJAX-based episode list
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getEpisodeUrl(seriesUrl, season, episode) {
    return get(seriesUrl).then(function(html) {
        // Find season tab with matching season number
        var postId = null, seasonId = null;
        var tabPattern = /data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)(?=data-post=|<\/ul>|$)/gi;
        var m;
        while ((m = tabPattern.exec(html)) !== null) {
            var inner = m[3].replace(/<[^>]+>/g, "").trim();
            var num   = inner.match(/(\d+)/);
            if (num && parseInt(num[1]) === parseInt(season)) {
                postId = m[1]; seasonId = m[2]; break;
            }
        }
        // Fallback: only one season exists
        if (!postId) {
            var fb = html.match(/data-post="(\d+)"[^>]*data-season="(\d+)"/);
            if (fb) { postId = fb[1]; seasonId = fb[2]; }
        }
        console.log("[ToonStream] Season tab: postId=" + postId + " seasonId=" + seasonId);
        if (!postId || !seasonId) return null;

        return post(
            MAIN_URL + "/wp-admin/admin-ajax.php",
            "action=action_select_season&season=" + seasonId + "&post=" + postId,
            { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              "Referer": seriesUrl }
        ).then(function(ajaxHtml) {
            // Match by NxNN span
            var epPattern = /<span[^>]*class="num-epi"[^>]*>\s*(\d+)x(\d+)\s*<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi;
            var ep;
            while ((ep = epPattern.exec(ajaxHtml)) !== null) {
                if (parseInt(ep[1]) === parseInt(season) && parseInt(ep[2]) === parseInt(episode)) {
                    return ep[3];
                }
            }
            // Fallback: nth article
            var allLinks = ajaxHtml.match(/<article[\s\S]*?<a\s+href="([^"]+)"/gi) || [];
            var idx = parseInt(episode) - 1;
            if (allLinks[idx]) {
                var hm = allLinks[idx].match(/href="([^"]+)"/);
                if (hm) return hm[1];
            }
            return null;
        });
    }).catch(function(err) {
        console.log("[ToonStream] getEpisodeUrl error: " + err);
        return null;
    });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  SCRAPE STREAMS â€” get server iframes, resolve, extract
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function scrapeStreams(pageUrl) {
    return get(pageUrl).then(function(html) {
        var serverLinks = getServerLinks(html);
        console.log("[ToonStream] Server links (" + serverLinks.length + "): " + serverLinks.join(", "));

        if (!serverLinks.length) return [];

        // Process servers one by one, collecting all streams
        var allStreams  = [];
        var seenUrls   = {};
        var chain       = Promise.resolve();

        serverLinks.forEach(function(serverLink) {
            chain = chain.then(function() {
                // Always resolve the wrapper page to get the real embed URL
                return resolveEmbed(serverLink, pageUrl).then(function(embedUrl) {
                    var target = embedUrl || serverLink;
                    console.log("[ToonStream] " + serverLink + " â†’ " + target);
                    return extractFrom(target, pageUrl);
                }).then(function(streams) {
                    streams.forEach(function(s) {
                        if (s && s.url && !seenUrls[s.url]) {
                            seenUrls[s.url] = true;
                            allStreams.push(s);
                        }
                    });
                }).catch(function(e) {
                    console.log("[ToonStream] Server error: " + e);
                });
            });
        });

        return chain.then(function() {
            console.log("[ToonStream] Total streams: " + allStreams.length);
            return allStreams;
        });
    }).catch(function(err) {
        console.log("[ToonStream] scrapeStreams error: " + err);
        return [];
    });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  SERVER LINK EXTRACTION
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getServerLinks(html) {
    var links    = [];
    var startIdx = html.search(/id=["']aa-options["']/i);
    var block    = startIdx >= 0 ? html.slice(startIdx) : html;

    // Prefer lazy-loaded data-src iframes
    var m;
    var dsRx = /<iframe[^>]+data-src=["']([^"']+)["']/gi;
    while ((m = dsRx.exec(block)) !== null) {
        var link = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
        if (!link.startsWith("http")) link = "https:" + link;
        if (links.indexOf(link) === -1) links.push(link);
    }

    // Fallback: plain src iframes (some episode pages)
    if (!links.length) {
        var srcRx = /<iframe[^>]+src=["']([^"']+)["']/gi;
        while ((m = srcRx.exec(block)) !== null) {
            var link = m[1].replace(/&#038;/g, "&").replace(/&amp;/g, "&");
            if (!link.startsWith("http")) link = "https:" + link;
            if (link.indexOf(MAIN_URL) !== -1 || link === "about:blank" || link.indexOf("javascript") === 0) continue;
            if (links.indexOf(link) === -1) links.push(link);
        }
    }

    return links;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EMBED RESOLVER â€” fetch wrapper page, find inner iframe src
//  Mirrors Kotlin: app.get(serverLink).selectFirst("iframe")?.attr("src")
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function resolveEmbed(url, referer) {
    return get(url, { "Referer": referer, "Sec-Fetch-Dest": "iframe" }).then(function(html) {
        var m = html.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i);
        if (!m) return null;
        var resolved = m[1].replace(/&#038;/g, "&");
        if (resolved.startsWith("//")) resolved = "https:" + resolved;
        if (!resolved.startsWith("http")) return null;
        if (resolved.indexOf(MAIN_URL) !== -1) return null;
        return resolved;
    }).catch(function() { return null; });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXTRACTOR ROUTER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function extractFrom(url, referer) {
    var u = url.toLowerCase();
    var name = providerName(url);
    console.log("[ToonStream] Extracting from: " + url);

    if (has(u, ["awstream", "zephyrflick", "zephyr"]))
        return extractAWS(url, name);

    if (has(u, ["gdmirrorbot", "techinmind"]))
        return extractGDMirror(url);

    if (has(u, ["cloudy.", "upns.one", "rpmshare", "upnshare", "streamp2p"]))
        return extractVidStack(url, name);

    if (has(u, ["emturbovid", "embturbovid"]))
        return extractEmturbovid(url, name);

    if (has(u, ["vidmoly"]))
        return extractVidmoly(url, name);

    if (has(u, ["streamsb", "watchsb", "sbplay", "sbspeed", "sbfast", "sbthe",
                "streamruby", "rubystm"]))
        return extractStreamSB(url, name);

    if (has(u, ["dood", "d000d", "do0d"]))
        return extractDood(url, name);

    if (has(u, ["vidhide", "filelions", "vidhidepro", "vidhidevip", "cdnwish"]))
        return extractVidHide(url, name);

    if (has(u, ["filemoon", "premilkyway", "filesim"]))
        return extractFileMoon(url, name);

    if (has(u, ["streamwish", "wishembed", "strwish", "sfastwish", "flaswish",
                "awish", "jodwish", "swhoi", "hlswish", "playerwish", "wishfast",
                "nekowish", "nekostream"]))
        return extractStreamWish(url, name);

    return extractGeneric(url, name);
}

function has(str, keywords) {
    for (var i = 0; i < keywords.length; i++) {
        if (str.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
}

function providerName(url) {
    try {
        var host = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0];
        return "ToonStream [" + host.charAt(0).toUpperCase() + host.slice(1) + "]";
    } catch(e) { return "ToonStream"; }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  STREAM OBJECT â€” official Nuvio format per docs
//  { name, title, url, quality, headers }
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function mkStream(streamUrl, streamHeaders, name, quality) {
    return {
        name:    name    || "ToonStream",
        title:   quality || "Auto",
        url:     streamUrl,
        quality: quality || "Auto",
        headers: streamHeaders || {}
    };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXTRACTORS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function extractAWS(url, name) {
    var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    var hash   = url.split("/").pop();
    var apiUrl = origin + "/player/index.php?data=" + hash + "&do=getVideo";

    return post(apiUrl, "hash=" + hash + "&r=" + origin,
        { "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": origin }
    ).then(function(text) {
        var json = JSON.parse(text);
        if (json && json.videoSource && json.videoSource !== "0") {
            console.log("[ToonStream] AWS URL: " + json.videoSource);
            return [mkStream(json.videoSource, {}, name, "Auto")];
        }
        return [];
    }).catch(function() { return []; });
}

function extractVidStack(url, name) {
    var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    var id     = url.split("/").filter(Boolean).pop();
    return post(origin + "/api/source/" + id,
        "r=" + encodeURIComponent(url) + "&d=" + origin.replace(/^https?:\/\//, ""),
        { "Content-Type": "application/x-www-form-urlencoded",
          "Referer": url, "Origin": origin }
    ).then(function(text) {
        var json = JSON.parse(text);
        if (!json || !json.data) return [];
        return json.data
            .filter(function(i) { return i.file && i.file.indexOf(".m3u8") !== -1; })
            .map(function(i) { return mkStream(i.file, { "Referer": url }, name, "Auto"); });
    }).catch(function() { return []; });
}

function extractEmturbovid(url, name) {
    return get(url, { "Referer": url }).then(function(html) {
        var m = html.match(/var\s+urlPlay\s*=\s*['"]([^'"]+)['"]/);
        if (!m) return [];
        return [mkStream(m[1], { "Referer": url }, name, "Auto")];
    }).catch(function() { return []; });
}

function extractVidmoly(url, name) {
    var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    var idM    = url.match(/\/(?:embed-|w\/)([a-zA-Z0-9]+)/);
    var target = idM ? (origin + "/embed-" + idM[1] + ".html") : url;

    return get(target, { "Referer": origin + "/", "Sec-Fetch-Dest": "iframe" }).then(function(html) {
        var content = unpackAll(html);
        var m = content.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*?)["'`]/);
        if (!m) return [];
        return [mkStream(m[1], { "Referer": origin + "/" }, name, "Auto")];
    }).catch(function() { return []; });
}

function extractStreamSB(url, name) {
    if (url.indexOf("streamruby") !== -1 || url.indexOf("rubystm") !== -1) {
        return get(url.replace(/\/e\//, "/"), { "Referer": url }).then(function(html) {
            var content = unpackAll(html);
            var m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
            if (!m) return [];
            return [mkStream(m[1], { "Referer": url }, name, "Auto")];
        }).catch(function() { return []; });
    }
    var origin  = url.match(/^(https?:\/\/[^\/]+)/)[1];
    var videoId = url.split("/").filter(Boolean).pop().replace(".html", "");
    var hexId   = videoId.split("").map(function(c) { return c.charCodeAt(0).toString(16); }).join("");
    return get(origin + "/sources48/" + hexId, { "watchsb": "sbstream", "Referer": url })
        .then(function(text) {
            var json = JSON.parse(text);
            if (json && json.stream_data && json.stream_data.file) {
                return [mkStream(json.stream_data.file, { "Referer": origin + "/" }, name, "Auto")];
            }
            return extractGeneric(url, name);
        }).catch(function() { return extractGeneric(url, name); });
}

function extractDood(url, name) {
    var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    return get(url, { "Referer": origin + "/" }).then(function(html) {
        var md5M   = html.match(/\/pass_md5\/[^\s"'<]+/);
        var tokenM = html.match(/\?token=([^&"'\s]+)/);
        if (!md5M) return extractGeneric(url, name);
        return get(origin + md5M[0], { "Referer": url }).then(function(md5Resp) {
            var rand     = Math.random().toString(36).substring(2, 14);
            var finalUrl = md5Resp.trim() + rand + "?token=" + (tokenM ? tokenM[1] : "") + "&expiry=" + Date.now();
            return [mkStream(finalUrl, { "Referer": origin + "/" }, name, "Auto")];
        });
    }).catch(function() { return []; });
}

function extractVidHide(url, name) {
    var embedUrl = url.replace(/\/(d|download|file|f)\//, "/v/");
    var origin   = url.match(/^(https?:\/\/[^\/]+)/)[1];
    return get(embedUrl, { "Referer": embedUrl, "Origin": origin }).then(function(html) {
        var content = unpackAll(html);
        if (content.indexOf("var links") !== -1)
            content = content.split("var links").slice(1).join("");
        var results = [], seen = {};
        var rx = /:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        var m;
        while ((m = rx.exec(content)) !== null) {
            if (!seen[m[1]]) { seen[m[1]] = true; results.push(mkStream(m[1], { "Referer": origin + "/" }, name, "Auto")); }
        }
        return results;
    }).catch(function() { return []; });
}

function extractFileMoon(url, name) {
    return get(url, { "Referer": url }).then(function(html) {
        var content = unpackAll(html);
        var m = content.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/);
        if (!m) return [];
        return [mkStream(m[1], { "Referer": url }, name, "Auto")];
    }).catch(function() { return []; });
}

function extractStreamWish(url, name) {
    var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    var vidM   = url.match(/\/(?:f|e)\/([a-zA-Z0-9]+)/);
    var target = vidM ? (origin + "/" + vidM[1]) : url;
    return get(target, { "Referer": origin + "/", "Origin": origin }).then(function(html) {
        var content = unpackAll(html);
        var m = content.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (!m) m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (!m) return [];
        return [mkStream(m[1], { "Referer": origin + "/" }, name, "Auto")];
    }).catch(function() { return []; });
}

function extractGDMirror(url) {
    var origin = url.match(/^(https?:\/\/[^\/]+)/)[1];
    var parts  = url.split("/").filter(Boolean);
    var sid    = parts[parts.length - 1];

    return post(origin + "/embedhelper.php", "sid=" + sid,
        { "Content-Type": "application/x-www-form-urlencoded" }
    ).then(function(text) {
        var data = JSON.parse(text);
        if (!data.siteUrls || !data.mresult) return [];
        var mresult = {};
        if (typeof data.mresult === "object") mresult = data.mresult;
        else try { mresult = JSON.parse(atob(data.mresult)); } catch(e) {}

        var subUrls = [];
        Object.keys(data.siteUrls).forEach(function(key) {
            if (!mresult[key]) return;
            subUrls.push(data.siteUrls[key].replace(/\/$/, "") + "/" + mresult[key].replace(/^\//, ""));
        });

        var all = [], chain = Promise.resolve();
        subUrls.forEach(function(su) {
            chain = chain.then(function() {
                return extractFrom(su, url).then(function(res) { all = all.concat(res); });
            });
        });
        return chain.then(function() { return all; });
    }).catch(function() { return []; });
}

function extractGeneric(url, name) {
    return get(url, { "Referer": url }).then(function(html) {
        var content = unpackAll(html);
        var results = [], seen = {};
        var rx = /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/gi;
        var m;
        while ((m = rx.exec(content)) !== null) {
            var link = m[1].replace(/\\/g, "");
            if (link.indexOf("error") !== -1 || seen[link]) continue;
            seen[link] = true;
            console.log("[ToonStream] Generic found: " + link);
            results.push(mkStream(link, { "Referer": url }, name, "Auto"));
        }
        return results;
    }).catch(function() { return []; });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  HTTP HELPERS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function get(url, extraHeaders) {
    var headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": MAIN_URL
    };
    if (extraHeaders) {
        Object.keys(extraHeaders).forEach(function(k) { headers[k] = extraHeaders[k]; });
    }
    return fetch(url, { method: "GET", headers: headers }).then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
        return r.text();
    });
}

function post(url, body, extraHeaders) {
    var headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Referer": MAIN_URL
    };
    if (extraHeaders) {
        Object.keys(extraHeaders).forEach(function(k) { headers[k] = extraHeaders[k]; });
    }
    return fetch(url, { method: "POST", headers: headers, body: body }).then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
        return r.text();
    });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  PACKER UNPACKER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function unpackAll(content) {
    var result = content;
    for (var i = 0; i < 5; i++) {
        var m = result.match(/(eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]*?\.split\('\|'\)\)(?:\))?)/);
        if (!m) break;
        var up = unpackOne(m[1]);
        if (!up || up === result) break;
        result = up;
    }
    return result;
}

function unpackOne(p) {
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
//  EXPORT â€” official format per nuvio-providers docs
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Export â€” matches NetMirror's exact guard pattern so Nuvio can find getStreams
// regardless of whether it uses new Function('module','exports',...) or plain eval()
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.getStreams = getStreams;
}
