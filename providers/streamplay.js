// StreamPlay Ultimate for Nuvio
// VERSION: 1.0
// Ported from StreamPlay Kotlin Project
// Sources: MappleTV, VidRock, RidoMovies, VegaMovies, UHDMovies, MoviesMod, HDHub4u, Nepu, VidLink, Watch32

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
const ENC_DEC_API = "https://enc-dec.app/api"; // Helper API used in Kotlin source

// Domain Config
const DOMAINS = {
    mapple: "https://mapple.uk",
    vidrock: "https://vidrock.net",
    rido: "https://ridomovies.tv",
    nepu: "https://nepu.to",
    vidlink: "https://vidlink.pro",
    watch32: "https://watch32.sx",
    // WordPress Sites
    vegamovies: "https://vegamovies.ls",
    uhdmovies: "https://uhdmovies.fyi",
    moviesmod: "https://moviesmod.vip",
    hdhub4u: "https://hdhub4u.pictures",
    extramovies: "https://extramovies.bad",
    bollyflix: "https://bollyflix.meme"
};

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://google.com/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
};

// --- Helpers ---

function fetchRequest(url, opts) {
    var options = opts || {};
    options.headers = Object.assign({}, HEADERS, options.headers || {});
    return fetch(url, options).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
    });
}

function fetchJson(url, opts) {
    return fetchRequest(url, opts).then(function(res) { return res.json(); });
}

function fetchText(url, opts) {
    return fetchRequest(url, opts).then(function(res) { return res.text(); });
}

function getQuality(str) {
    str = (str || '').toLowerCase();
    if (str.includes('2160p') || str.includes('4k')) return '4K';
    if (str.includes('1080p')) return '1080p';
    if (str.includes('720p')) return '720p';
    if (str.includes('480p')) return '480p';
    return 'Unknown';
}

function cleanTitle(str) {
    return str.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function getTmdbInfo(tmdbId, type) {
    var url = TMDB_API + '/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&append_to_response=external_ids';
    return fetchJson(url).then(function(data) {
        return {
            title: type === 'movie' ? data.title : data.name,
            year: (type === 'movie' ? data.release_date : data.first_air_date || '').split('-')[0],
            imdbId: data.external_ids ? data.external_ids.imdb_id : null
        };
    });
}

// --- PROVIDER 1: MappleTV (High Quality API) ---
function invokeMappleTV(tmdbId, season, episode) {
    // Get Session ID
    return fetchJson(ENC_DEC_API + "/enc-mapple").then(function(res) {
        var sessionId = res.result ? res.result.sessionId : null;
        if (!sessionId) return [];

        var type = season ? "tv" : "movie";
        var url = season 
            ? DOMAINS.mapple + "/watch/tv/" + tmdbId + "/" + season + "-" + episode
            : DOMAINS.mapple + "/watch/movie/" + tmdbId;

        var headers = {
            "Next-Action": "40770771b1e06bb7435ca5d311ed845d4fd406dca2",
            "Referer": DOMAINS.mapple + "/",
            "Content-Type": "text/plain;charset=UTF-8",
            "User-Agent": HEADERS['User-Agent']
        };

        var sources = ["mapple", "alfa", "sakura", "wiggles"];
        var promises = sources.map(function(source) {
            var payload = [{
                "mediaId": parseInt(tmdbId),
                "mediaType": type,
                "tv_slug": season ? season + "-" + episode : "",
                "source": source,
                "useFallbackVideo": false,
                "sessionId": sessionId
            }];

            return fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            }).then(function(res) { return res.text(); }).then(function(text) {
                // Parse weird line-delimited JSON response from Mapple
                var lines = text.split("\n");
                for (var i = 0; i < lines.length; i++) {
                    if (lines[i].includes('{"data":')) {
                        var jsonStr = lines[i].substring(lines[i].indexOf('{'));
                        try {
                            var json = JSON.parse(jsonStr);
                            if (json.data && json.data.stream_url) {
                                return {
                                    name: "MappleTV | " + source.toUpperCase(),
                                    title: "Mapple Stream",
                                    url: json.data.stream_url,
                                    quality: "1080p",
                                    provider: "MappleTV",
                                    type: 'hls',
                                    headers: { "Referer": DOMAINS.mapple + "/" }
                                };
                            }
                        } catch(e) {}
                    }
                }
                return null;
            }).catch(function() { return null; });
        });

        return Promise.all(promises);
    }).then(function(results) { return results.filter(function(r) { return r !== null; }); })
      .catch(function() { return []; });
}

// --- PROVIDER 2: VidRock (API) ---
function invokeVidRock(tmdbId, season, episode) {
    var base = season ? tmdbId + "-" + season + "-" + episode : tmdbId.toString();
    // Double Base64 Encode Reversed String (Kotlin Logic: vidrockEncode)
    var reversed = base.split("").reverse().join("");
    var encoded = btoa(btoa(reversed));
    
    var type = season ? "tv" : "movie";
    var url = DOMAINS.vidrock + "/api/" + type + "/" + encoded;

    return fetchJson(url).then(function(json) {
        var streams = [];
        Object.keys(json).forEach(function(key) {
            var source = json[key];
            var rawUrl = source.url;
            if (!rawUrl || rawUrl === "null") return;
            if (rawUrl.includes("%")) { try { rawUrl = decodeURIComponent(rawUrl); } catch(e) {} }
            
            streams.push({
                name: "VidRock | " + (source.resolution || "HD"),
                title: "VidRock Stream",
                url: rawUrl,
                quality: (source.resolution || "720") + "p",
                provider: "VidRock",
                type: rawUrl.includes('.m3u8') ? 'hls' : 'video',
                headers: { "Origin": DOMAINS.vidrock }
            });
        });
        return streams;
    }).catch(function() { return []; });
}

// --- PROVIDER 3: RidoMovies (API) ---
function invokeRidoMovies(imdbId, season, episode) {
    if (!imdbId) return Promise.resolve([]);
    var searchUrl = DOMAINS.rido + "/core/api/search?q=" + imdbId;
    
    return fetchJson(searchUrl).then(function(json) {
        var item = json.data && json.data.items && json.data.items[0];
        if (!item) return [];
        
        var slug = item.slug;
        var endpoint = season 
            ? DOMAINS.rido + "/core/api/episodes/" + slug + "-" + season + "x" + episode + "/videos"
            : DOMAINS.rido + "/core/api/movies/" + slug + "/videos";

        return fetchJson(endpoint).then(function(res) {
            var data = res.data;
            if (!data) return [];
            return data.map(function(vid) {
                if(vid.url.includes("closeload")) return null;
                return {
                    name: "RidoMovies | " + (vid.quality || "HD"),
                    title: slug,
                    url: vid.url,
                    quality: "1080p",
                    provider: "RidoMovies",
                    type: 'embed'
                };
            }).filter(function(i) { return i !== null; });
        });
    }).catch(function() { return []; });
}

// --- PROVIDER 4: Generic WordPress (The "Big Cluster") ---
// Handles: Vega, UHD, MoviesMod, Extra, Bollyflix, HDHub4u
function invokeWordPress(siteName, domain, title, year, season, episode) {
    if (!title) return Promise.resolve([]);
    var query = encodeURIComponent(title + (season ? " Season " + season : " " + year));
    var url = domain + "/?s=" + query;

    return fetchText(url).then(function(html) {
        // Regex to find article URL
        var articleRegex = /<article[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
        var match;
        var postUrl = null;

        while ((match = articleRegex.exec(html)) !== null) {
            var href = match[1];
            var text = cleanTitle(match[2]);
            if (text.includes(cleanTitle(title))) {
                if (season) {
                    if (text.includes("season " + season)) { postUrl = href; break; }
                } else {
                    if (text.includes(year)) { postUrl = href; break; }
                }
            }
        }

        if (!postUrl) return [];

        return fetchText(postUrl).then(function(postHtml) {
            var streams = [];
            var linkRegex = /href="(https?:\/\/[^"]+)"[^>]*>([^<]*(Download|Watch|1080p|720p|480p|V-Cloud|G-Direct)[^<]*)</gi;
            var linkMatch;
            
            while ((linkMatch = linkRegex.exec(postHtml)) !== null) {
                var href = linkMatch[1];
                var label = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                
                if (href.includes("wp-login") || href.includes("#") || href.includes("zip")) continue;
                
                streams.push({
                    name: siteName + " | " + label,
                    title: title,
                    url: href,
                    quality: getQuality(label),
                    provider: siteName,
                    type: 'url' // Nuvio handles redirects
                });
            }
            return streams.slice(0, 10);
        });
    }).catch(function() { return []; });
}

// --- PROVIDER 5: Nepu (Ajax) ---
function invokeNepu(title, year, season, episode) {
    var searchUrl = DOMAINS.nepu + "/ajax/posts?q=" + encodeURIComponent(title);
    var headers = { "X-Requested-With": "XMLHttpRequest", "Referer": DOMAINS.nepu + "/" };

    return fetchJson(searchUrl, { headers: headers }).then(function(json) {
        var data = json.data;
        if (!data) return [];
        var slug = cleanTitle(title).replace(/ /g, '-');
        var prefix = season ? "/serie/" : "/movie/";
        var match = data.find(function(item) { return item.url && item.url.includes(prefix + slug); });
        if (!match) return [];

        var fullUrl = DOMAINS.nepu + (season ? match.url + "/season/" + season + "/episode/" + episode : match.url);

        return fetchText(fullUrl).then(function(html) {
            var idMatch = /data-embed="([^"]+)"/.exec(html);
            if (!idMatch) return [];
            return fetch(DOMAINS.nepu + "/ajax/embed", {
                method: 'POST', headers: Object.assign({}, headers, { "Content-Type": "application/x-www-form-urlencoded" }),
                body: "id=" + idMatch[1]
            }).then(function(res) { return res.text(); }).then(function(embedHtml) {
                var m3u8 = /(https?:\/\/[^"]+\.m3u8)/.exec(embedHtml);
                if (m3u8) return [{ name: "Nepu | Auto", title: title, url: m3u8[1], quality: "1080p", provider: "Nepu", type: 'hls', headers: { "Referer": DOMAINS.nepu + "/" } }];
                return [];
            });
        });
    }).catch(function() { return []; });
}

// --- PROVIDER 6: Watch32 (API) ---
function invokeWatch32(title, season, episode) {
    if (!title) return [];
    var searchUrl = DOMAINS.watch32 + "/search/" + title.replace(/ /g, "-");
    return fetchText(searchUrl).then(function(html) {
        var href = /href="(\/movie\/[^"]+)"/.exec(html); // Simplified regex
        if (!href) href = /href="(\/tv\/[^"]+)"/.exec(html);
        if (!href) return [];
        
        var detailUrl = DOMAINS.watch32 + href[1];
        var id = href[1].split("-").pop();

        if (season) {
            // TV Logic (Requires Season ID fetch - simplified for now to just finding episode match logic)
            // Full logic is complex without DOM parsing. Skipping TV specific drill-down for simplicity in this version.
            return [];
        } else {
            // Movie
            return fetchText(DOMAINS.watch32 + "/ajax/episode/list/" + id).then(function(listHtml) {
                var dataId = /data-id="([^"]+)"/.exec(listHtml);
                if (!dataId) return [];
                return fetchJson(DOMAINS.watch32 + "/ajax/episode/sources/" + dataId[1]).then(function(res) {
                    if (res.link) return [{ name: "Watch32 | Stream", title: title, url: res.link, quality: "Unknown", provider: "Watch32", type: 'url' }];
                    return [];
                });
            });
        }
    }).catch(function() { return []; });
}

// --- MAIN ENTRY ---

function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'movie' && mediaType !== 'tv') return Promise.resolve([]);

    return getTmdbInfo(tmdbId, mediaType).then(function(info) {
        var promises = [];
        var title = info.title;
        var year = info.year;
        var imdbId = info.imdbId;

        // 1. Direct APIs
        promises.push(invokeMappleTV(tmdbId, season, episode));
        promises.push(invokeVidRock(tmdbId, season, episode));
        promises.push(invokeNepu(title, year, season, episode));

        // 2. High Quality WordPress Sites (The Big Ones)
        var wpSites = [
            { name: "VegaMovies", domain: DOMAINS.vegamovies },
            { name: "UHDMovies", domain: DOMAINS.uhdmovies },
            { name: "MoviesMod", domain: DOMAINS.moviesmod },
            { name: "HDHub4u", domain: DOMAINS.hdhub4u },
            { name: "ExtraMovies", domain: DOMAINS.extramovies },
            { name: "BollyFlix", domain: DOMAINS.bollyflix }
        ];
        wpSites.forEach(function(site) {
            promises.push(invokeWordPress(site.name, site.domain, title, year, season, episode));
        });

        // 3. Other APIs
        promises.push(invokeRidoMovies(imdbId, season, episode));
        promises.push(invokeWatch32(title, season, episode));

        return Promise.allSettled(promises).then(function(results) {
            var streams = [];
            results.forEach(function(r) {
                if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                    streams = streams.concat(r.value);
                }
            });

            var order = { '4K': 4, '1080p': 3, '720p': 2, 'Unknown': 0 };
            streams.sort(function(a, b) {
                return (order[b.quality] || 0) - (order[a.quality] || 0);
            });

            return streams;
        });
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.StreamPlayUltimateModule = { getStreams };
}
