// ToonStream Provider for Nuvio
// Version: 30.0 (Final Port of Phisher's CloudStream Logic)
// Optimized for: toonstream.dad
// Compatibility: Hermes / Nuvio Native

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var MAIN_URL     = "https://toonstream.dad";
var USER_AGENT   = "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36";

/**
 * ENTRY POINT
 */
function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[ToonStream] Starting... ID: " + tmdbId + " S" + season + "E" + episode);

    return get("https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY)
        .then(function(tmdbText) {
            var tmdbData = JSON.parse(tmdbText);
            var title = (mediaType === "movie") ? tmdbData.title : tmdbData.name;
            console.log("[ToonStream] TMDB Title: " + title);

            return search(title).then(function(contentUrl) {
                if (!contentUrl) return [];
                console.log("[ToonStream] Found Content URL: " + contentUrl);

                if (mediaType !== "tv") return scrapeStreams(contentUrl);

                return getEpisodeUrl(contentUrl, season, episode).then(function(epUrl) {
                    if (!epUrl) return [];
                    return scrapeStreams(epUrl);
                });
            });
        })
        .catch(function(err) {
            console.error("[ToonStream] Error: " + err);
            return [];
        });
}

/**
 * SEARCH LOGIC (Matches Toonstream.kt -> search())
 */
function search(title) {
    var searchUrl = MAIN_URL + "/home/page/1/?s=" + encodeURIComponent(title);
    return get(searchUrl).then(function(html) {
        var results = [];
        // Regex matches the Kotlin selector: #movies-a > ul > li
        var regex = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
        var m;
        while ((m = regex.exec(html)) !== null) {
            var url = m[1];
            var rTitle = m[2].replace(/Watch Online/gi, "").trim();
            if (url.indexOf("/series/") !== -1 || url.indexOf("/movies/") !== -1) {
                results.push({ url: url, title: rTitle });
            }
        }

        // Logic: Exact match or first result
        var target = title.toLowerCase().replace(/[^a-z0-9]/g, "");
        var match = results.find(function(r) {
            return r.title.toLowerCase().replace(/[^a-z0-9]/g, "") === target;
        }) || results[0];

        return match ? match.url : null;
    });
}

/**
 * EPISODE LOGIC (Matches Toonstream.kt -> load() TV logic)
 */
function getEpisodeUrl(seriesUrl, season, episode) {
    return get(seriesUrl).then(function(html) {
        // Kotlin logic: Extract data-post and data-season from season tabs
        var nonce = (html.match(/"nonce":"([^"]+)"/) || [])[1];
        var postId = (html.match(/data-post="(\d+)"/) || html.match(/postid-(\d+)/) || [])[1];
        
        // Find the correct season tab
        var seasonRegex = new RegExp('data-season="(\\d+)"[^>]*>.*?Season\\s*' + season + '\\b', 'i');
        var seasonMatch = html.match(seasonRegex);
        var seasonId = seasonMatch ? seasonMatch[1] : "";

        if (!postId || !seasonId) return null;

        // AJAX POST: Matches Kotlin app.post("$mainUrl/wp-admin/admin-ajax.php")
        var body = "action=action_select_season&season=" + seasonId + "&post=" + postId + (nonce ? "&nonce=" + nonce : "");
        
        return post(MAIN_URL + "/home/wp-admin/admin-ajax.php", body, {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest"
        }).then(function(ajaxHtml) {
            // Find episode in the AJAX response
            var epPattern = /<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
            var ep;
            while ((ep = epPattern.exec(ajaxHtml)) !== null) {
                if (parseInt(ep[1]) == season && parseInt(ep[2]) == episode) return ep[3];
            }
            return null;
        });
    });
}

/**
 * EXTRACTION (Matches Toonstream.kt -> loadLinks())
 */
function scrapeStreams(pageUrl) {
    return get(pageUrl).then(function(html) {
        // Kotlin: document.select("#aa-options > div > iframe")
        var iframeRegex = /<iframe[^>]*data-src=["']([^"']+)["']/gi;
        var m, servers = [];
        while ((m = iframeRegex.exec(html)) !== null) {
            servers.push(m[1].replace(/&#038;/g, "&"));
        }

        var streams = [];
        var chain = Promise.resolve();

        servers.forEach(function(serverUrl) {
            chain = chain.then(function() {
                // Visit trembed redirector
                return get(serverUrl, { "Referer": pageUrl }).then(function(sHtml) {
                    // Extract inner host iframe
                    var innerMatch = sHtml.match(/<iframe[^>]*src=["']([^"']+)["']/i);
                    if (!innerMatch) return;
                    
                    var realUrl = innerMatch[1].replace(/^\/\//, "https://");
                    if (realUrl.indexOf("google") !== -1 || realUrl.indexOf("ads") !== -1) return;

                    // Extract from host
                    return extractFromHost(realUrl, serverUrl).then(function(found) {
                        if (found) streams = streams.concat(found);
                    });
                });
            }).catch(function() {});
        });

        return chain.then(function() { return streams; });
    });
}

/**
 * HOST EXTRACTOR (Packed logic + M3U8 hunt)
 */
function extractFromHost(url, referer) {
    return get(url, { "Referer": referer }).then(function(html) {
        var content = unpackAll(html);
        var results = [];
        // Regex: file: "URL" (used in RubyStream/Vidmoly)
        var m3u8Regex = /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        var m;
        var domain = url.split('/')[2].replace("www.","").split('.')[0].toUpperCase();

        while ((m = m3u8Regex.exec(content)) !== null) {
            var streamUrl = m[1].replace(/\\/g, "");
            results.push({
                name: "ToonStream [" + domain + "]",
                title: "Auto",
                url: streamUrl,
                quality: "Auto",
                type: "hls",
                headers: { "Referer": url, "User-Agent": USER_AGENT }
            });
        }
        return results;
    });
}

// --- NETWORK HELPERS ---
function get(url, extra) {
    var headers = { "User-Agent": USER_AGENT, "Referer": MAIN_URL };
    if (extra) Object.keys(extra).forEach(function(k) { headers[k] = extra[k]; });
    return fetch(url, { method: "GET", headers: headers }).then(function(r) { return r.text(); });
}

function post(url, body, extra) {
    var headers = { "User-Agent": USER_AGENT, "Referer": MAIN_URL };
    if (extra) Object.keys(extra).forEach(function(k) { headers[k] = extra[k]; });
    return fetch(url, { method: "POST", headers: headers, body: body }).then(function(r) { return r.text(); });
}

// --- PACKER HELPER ---
function unpackAll(c) {
    var res = c, i = 0;
    while (i < 5 && res.indexOf("eval(function") !== -1) {
        var m = res.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
        if (!m) break;
        res = unpackOne(m[0]); i++;
    }
    return res;
}

function unpackOne(p) {
    try {
        var params = p.match(/\}\s*\(\s*'([\s\S]*)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        var payload = params[1], radix = parseInt(params[2]), dict = params[4].split("|");
        return payload.replace(/\b\w+\b/g, function(w) {
            var idx = parseInt(w, radix);
            return (dict[idx] || w);
        });
    } catch(e) { return p; }
}

if (typeof module !== "undefined") module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
