// ToonStream Provider for Nuvio
// Version: 27.0 (Strict Referer & cdn21 Fix)
// Optimized for: toonstream.dad

console.log("[ToonStream] Initializing v27.0");

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var MAIN_URL     = "https://toonstream.dad";
var USER_AGENT   = "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36";

function getStreams(tmdbId, mediaType, season, episode) {
    return get("https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY)
        .then(function(tmdbText) {
            var tmdbData = JSON.parse(tmdbText);
            var title = (mediaType === "movie") ? tmdbData.title : tmdbData.name;
            var cleanTitle = title.replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim();

            return search(cleanTitle, title).then(function(contentUrl) {
                if (!contentUrl) return [];
                if (mediaType !== "tv") return scrapeStreams(contentUrl);

                return getEpisodeUrl(contentUrl, season, episode).then(function(epUrl) {
                    return epUrl ? scrapeStreams(epUrl) : [];
                });
            });
        })
        .catch(function() { return []; });
}

// --- SEARCH: Word-Match Validation ---
function search(cleanTitle, originalTitle) {
    var searchUrl = MAIN_URL + "/home/?s=" + encodeURIComponent(cleanTitle);
    return get(searchUrl).then(function(html) {
        var results = [];
        var regex = /<a href="([^"]+(?:\/series\/|\/movies\/)[^"]+)"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]+)<\/a>/gi;
        var m;
        while ((m = regex.exec(html)) !== null) {
            results.push({ url: m[1], title: m[2].replace(/Watch Online/gi, "").trim() });
        }
        var target = originalTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
        var match = results.find(function(r) { 
            return r.title.toLowerCase().replace(/[^a-z0-9]/g, "").indexOf(target) !== -1; 
        }) || results[0];
        return match ? match.url : null;
    });
}

// --- EPISODE LOGIC: Nonce AJAX ---
function getEpisodeUrl(seriesUrl, season, episode) {
    return get(seriesUrl).then(function(html) {
        var nonce = (html.match(/"nonce":"([^"]+)"/) || [])[1];
        var postId = (html.match(/data-post="(\d+)"/) || html.match(/postid-(\d+)/) || [])[1];
        var seasonRegex = new RegExp('data-season="(\\d+)"[^>]*>.*?Season\\s*' + season + '\\b', 'i');
        var seasonId = (html.match(seasonRegex) || [])[1];

        if (!nonce || !postId || !seasonId) return null;

        var body = "action=action_select_season&season=" + seasonId + "&post=" + postId + "&nonce=" + nonce;
        return post(MAIN_URL + "/home/wp-admin/admin-ajax.php", body, {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        }).then(function(ajaxHtml) {
            var epPattern = /<span[^>]*class="num-epi"[^>]*>\s*(\d+)x(\d+)\s*<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi;
            var ep;
            while ((ep = epPattern.exec(ajaxHtml)) !== null) {
                if (parseInt(ep[1]) == season && parseInt(ep[2]) == episode) return ep[3];
            }
            return null;
        });
    });
}

// --- STREAM EXTRACTION: The "Double Jump" Chain ---
function scrapeStreams(pageUrl) {
    return get(pageUrl).then(function(html) {
        var iframeRegex = /<iframe[^>]*data-src=["']([^"']+)["']/gi;
        var m, serverLinks = [];
        while ((m = iframeRegex.exec(html)) !== null) {
            var link = m[1].replace(/&#038;/g, "&");
            if (link.startsWith("//")) link = "https:" + link;
            serverLinks.push(link);
        }

        var allStreams = [];
        var chain = Promise.resolve();

        serverLinks.forEach(function(server) {
            chain = chain.then(function() {
                // STEP 1: Get the 'trembed' page
                return get(server, { "Referer": pageUrl }).then(function(sHtml) {
                    // STEP 2: Find the real host (cdn21, vidmoly, etc)
                    var inner = sHtml.match(/<iframe[^>]*src=["']([^"']+)["']/i);
                    if (!inner) return;
                    
                    var realUrl = inner[1];
                    if (realUrl.startsWith("//")) realUrl = "https:" + realUrl;
                    if (realUrl.indexOf("ads") !== -1 || realUrl.indexOf("google") !== -1) return;

                    // STEP 3: Scrape the final .m3u8 link from the host
                    return extractLinks(realUrl, server);
                }).then(function(found) {
                    if (found) allStreams = allStreams.concat(found);
                });
            }).catch(function() {});
        });

        return chain.then(function() { return allStreams; });
    });
}

function extractLinks(url, referer) {
    // Crucial: The Referer must be the trembed URL, not toonstream.dad
    return get(url, { "Referer": referer }).then(function(html) {
        var content = unpackAll(html);
        var results = [];
        var m3u8Regex = /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        var m;
        var host = url.split('/')[2].replace("www.","").split('.')[0].toUpperCase();

        while ((m = m3u8Regex.exec(content)) !== null) {
            var streamUrl = m[1].replace(/\\/g, "");
            results.push({
                name: "ToonStream [" + host + "]",
                title: "Auto",
                url: streamUrl,
                quality: "Auto",
                type: "hls",
                headers: { 
                    "Referer": url, 
                    "User-Agent": USER_AGENT,
                    "Origin": "https://" + url.split('/')[2] 
                }
            });
        }
        return results;
    }).catch(function() { return []; });
}

// --- HELPERS ---
function get(url, extraHeaders) {
    var headers = { "User-Agent": USER_AGENT, "Referer": MAIN_URL };
    if (extraHeaders) Object.keys(extraHeaders).forEach(function(k) { headers[k] = extraHeaders[k]; });
    return fetch(url, { method: "GET", headers: headers }).then(function(r) { return r.text(); });
}

function post(url, body, extraHeaders) {
    var headers = { "User-Agent": USER_AGENT, "Referer": MAIN_URL };
    if (extraHeaders) Object.keys(extraHeaders).forEach(function(k) { headers[k] = extraHeaders[k]; });
    return fetch(url, { method: "POST", headers: headers, body: body }).then(function(r) { return r.text(); });
}

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
        var params = p.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/);
        var dict = params[4].split('|');
        return params[1].replace(/\b\w+\b/g, function(w) { return dict[parseInt(w, params[2])] || w; });
    } catch(e) { return p; }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.getStreams = getStreams;
}
