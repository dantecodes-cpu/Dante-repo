// ToonStream Provider for Nuvio
// Version: 25.0 (Updated: Feb 2024 Nonce & Search Fix)
// Compatibility: Hermes (ES5) / Nuvio Native

console.log("[ToonStream] Initializing v25.0");

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var MAIN_URL     = "https://toonstream.dad";
var USER_AGENT   = "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";

function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[ToonStream] Calling getStreams for ID: " + tmdbId);

    return get("https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY)
        .then(function(tmdbText) {
            var tmdbData = JSON.parse(tmdbText);
            var title = mediaType === "movie" ? tmdbData.title : tmdbData.name;
            var cleanTitle = title.replace(/[:\-]/g, " ").replace(/\s+/g, " ").trim();

            return search(cleanTitle, title).then(function(contentUrl) {
                if (!contentUrl) return [];
                
                if (mediaType !== "tv") {
                    return scrapeStreams(contentUrl);
                }

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

// --- SEARCH LOGIC ---
function search(cleanTitle, originalTitle) {
    // Try /home/ first as it's more stable for searches
    var searchUrl = MAIN_URL + "/home/?s=" + encodeURIComponent(cleanTitle);
    
    return get(searchUrl).then(function(html) {
        var results = [];
        // Regex updated to handle the <span> tags found in search results
        // e.g. <a href="..."> <span class="type-series">series</span> Title </a>
        var searchRegex = /<li[^>]*>\s*<a href="([^"]+)"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]+)<\/a>/gi;
        var m;
        
        while ((m = searchRegex.exec(html)) !== null) {
            var url = m[1];
            var title = m[2].replace(/Watch Online/gi, "").trim();
            
            if (url.indexOf("/series/") !== -1 || url.indexOf("/movies/") !== -1) {
                results.push({ url: url, title: title });
            }
        }

        console.log("[ToonStream] Found " + results.length + " results");
        return pickBest(results, originalTitle);
    });
}

function pickBest(results, title) {
    if (!results.length) return null;
    function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
    var target = norm(title);
    
    for (var i = 0; i < results.length; i++) {
        if (norm(results[i].title) === target) return results[i].url;
    }
    return results[0].url; // Fallback to first
}

// --- EPISODE LOGIC (THE NONCE FIX) ---
function getEpisodeUrl(seriesUrl, season, episode) {
    return get(seriesUrl).then(function(html) {
        // 1. Extract the AJAX Nonce (Mandatory for toonstream.dad)
        var nonceMatch = html.match(/"nonce":"([^"]+)"/);
        var nonce = nonceMatch ? nonceMatch[1] : "";
        
        // 2. Extract PostID and SeasonID
        var postId = (html.match(/data-post="(\d+)"/) || [])[1];
        var seasonRegex = new RegExp('data-post="(\\d+)"[^>]*data-season="(\\d+)"[^>]*>.*?Season\\s*' + season + '\\b', 'i');
        var sMatch = html.match(seasonRegex);
        
        var seasonId = sMatch ? sMatch[2] : "";
        if (!postId) postId = sMatch ? sMatch[1] : "";

        console.log("[ToonStream] AJAX Data: Post=" + postId + " Season=" + seasonId + " Nonce=" + nonce);
        if (!postId || !seasonId) return null;

        // 3. Send AJAX Request with Nonce
        var body = "action=action_select_season&season=" + seasonId + "&post=" + postId + "&nonce=" + nonce;
        
        return post(MAIN_URL + "/home/wp-admin/admin-ajax.php", body, {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": seriesUrl
        }).then(function(ajaxHtml) {
            var epPattern = /<span[^>]*class="num-epi"[^>]*>\s*(\d+)x(\d+)\s*<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi;
            var ep;
            while ((ep = epPattern.exec(ajaxHtml)) !== null) {
                if (parseInt(ep[1]) == season && parseInt(ep[2]) == episode) {
                    return ep[3];
                }
            }
            return null;
        });
    });
}

// --- STREAM EXTRACTION ---
function scrapeStreams(pageUrl) {
    return get(pageUrl).then(function(html) {
        var dsRx = /<iframe[^>]+data-src=["']([^"']+)["']/gi;
        var m, serverLinks = [];
        while ((m = dsRx.exec(html)) !== null) {
            var link = m[1].replace(/&#038;/g, "&");
            if (!link.startsWith("http")) link = "https:" + link;
            serverLinks.push(link);
        }

        var allStreams = [];
        var chain = Promise.resolve();

        serverLinks.forEach(function(server) {
            chain = chain.then(function() {
                return get(server, { "Referer": pageUrl }).then(function(sHtml) {
                    var inner = sHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                    if (!inner) return;
                    
                    var realUrl = inner[1].replace(/&#038;/g, "&");
                    if (realUrl.startsWith("//")) realUrl = "https:" + realUrl;
                    
                    return extractLinks(realUrl).then(function(found) {
                        allStreams = allStreams.concat(found);
                    });
                });
            });
        });

        return chain.then(function() { return allStreams; });
    });
}

function extractLinks(url) {
    return get(url, { "Referer": MAIN_URL + "/" }).then(function(html) {
        var content = unpackAll(html);
        var results = [];
        var m3u8Regex = /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        var m;
        var host = url.split('/')[2].split('.')[0];

        while ((m = m3u8Regex.exec(content)) !== null) {
            var streamUrl = m[1].replace(/\\/g, "");
            results.push({
                name: "ToonStream [" + host.toUpperCase() + "]",
                title: "Auto",
                url: streamUrl,
                quality: "Auto",
                headers: { "Referer": url, "Origin": "https://" + url.split('/')[2] }
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
    var res = c;
    for (var i = 0; i < 5; i++) {
        var m = res.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
        if (!m) break;
        res = unpackOne(m[0]);
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

if (typeof module !== "undefined") module.exports = { getStreams: getStreams };
else global.getStreams = getStreams;
