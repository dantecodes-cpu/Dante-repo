// StreamPlay "Best Of" Scraper for Nuvio
// VERSION: 1.0 (Most Popular Sources Only)
// Sources: MappleTV, VidRock, Nepu, XDMovies, VegaMovies, UHDMovies, MoviesMod, RidoMovies, KissKH

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

// --- Configuration ---
const MAPPLE_API = "https://mapple.uk";
const VIDROCK_API = "https://vidrock.net";
const NEPU_API = "https://nepu.to";
const XDMOVIES_API = "https://xdmovies.site";
const ENC_DEC_API = "https://enc-dec.app/api";

const DOMAINS = {
    vegamovies: "https://vegamovies.ls",
    uhdmovies: "https://uhdmovies.fyi",
    moviesmod: "https://moviesmod.vip",
    bollyflix: "https://bollyflix.meme",
    ridomovies: "https://ridomovies.tv",
    kisskh: "https://kisskh.ovh"
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

// --- ID Mapping ---

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

// --- PROVIDER 1: MappleTV (Direct High Quality) ---
function invokeMappleTV(tmdbId, season, episode) {
    return fetchJson(ENC_DEC_API + "/enc-mapple").then(function(res) {
        var sessionId = res.result ? res.result.sessionId : null;
        if (!sessionId) return [];

        var type = season ? "tv" : "movie";
        var url = season 
            ? MAPPLE_API + "/watch/tv/" + tmdbId + "/" + season + "-" + episode
            : MAPPLE_API + "/watch/movie/" + tmdbId;

        var headers = {
            "Next-Action": "40770771b1e06bb7435ca5d311ed845d4fd406dca2",
            "Referer": MAPPLE_API + "/",
            "Content-Type": "text/plain;charset=UTF-8"
        };

        var sources = ["mapple", "alfa", "sakura"];
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
                var parts = text.split("\n");
                for (var i = 0; i < parts.length; i++) {
                    if (parts[i].includes('{"data":')) {
                        var jsonStr = parts[i].substring(parts[i].indexOf('{'));
                        var json = JSON.parse(jsonStr);
                        if (json.data && json.data.stream_url) {
                            return {
                                name: "MappleTV | " + source.toUpperCase(),
                                title: "Mapple Stream",
                                url: json.data.stream_url,
                                quality: "1080p",
                                provider: "MappleTV",
                                type: 'hls',
                                headers: { "Referer": MAPPLE_API + "/" }
                            };
                        }
                    }
                }
                return null;
            }).catch(function() { return null; });
        });

        return Promise.all(promises);
    }).then(function(results) {
        return results.filter(function(r) { return r !== null; });
    }).catch(function() { return []; });
}

// --- PROVIDER 2: VidRock (Direct) ---
function invokeVidRock(tmdbId, season, episode) {
    var base = season ? tmdbId + "-" + season + "-" + episode : tmdbId.toString();
    var encoded = btoa(btoa(base.split("").reverse().join("")));
    var type = season ? "tv" : "movie";
    var url = VIDROCK_API + "/api/" + type + "/" + encoded;

    return fetchJson(url).then(function(json) {
        var streams = [];
        Object.keys(json).forEach(function(key) {
            var source = json[key];
            if (source.url && source.url !== "null") {
                streams.push({
                    name: "VidRock | " + (source.resolution || "HD"),
                    title: "VidRock Stream",
                    url: source.url,
                    quality: (source.resolution || "720") + "p",
                    provider: "VidRock",
                    type: source.url.includes('.m3u8') ? 'hls' : 'video',
                    headers: { "Origin": VIDROCK_API }
                });
            }
        });
        return streams;
    }).catch(function() { return []; });
}

// --- PROVIDER 3: Generic WordPress (Vega, UHD, etc.) ---
function invokeWordPress(siteName, domain, title, year, season, episode) {
    if (!title) return Promise.resolve([]);
    var query = encodeURIComponent(title + (season ? " Season " + season : " " + year));
    var url = domain + "/?s=" + query;

    return fetchText(url).then(function(html) {
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
            var linkRegex = /href="(https?:\/\/[^"]+)"[^>]*>([^<]*(Download|Watch|1080p|720p|480p)[^<]*)</gi;
            var linkMatch;
            
            while ((linkMatch = linkRegex.exec(postHtml)) !== null) {
                var href = linkMatch[1];
                var label = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                
                if (href.includes("wp-login") || href.includes("#")) continue;
                
                streams.push({
                    name: siteName + " | " + label,
                    title: title,
                    url: href,
                    quality: getQuality(label),
                    provider: siteName,
                    type: 'url'
                });
            }
            return streams.slice(0, 8);
        });
    }).catch(function() { return []; });
}

// --- PROVIDER 4: RidoMovies (API) ---
function invokeRidoMovies(imdbId, season, episode) {
    if (!imdbId) return Promise.resolve([]);
    var searchUrl = DOMAINS.ridomovies + "/core/api/search?q=" + imdbId;
    
    return fetchJson(searchUrl).then(function(json) {
        var item = json.data && json.data.items && json.data.items[0];
        if (!item) return [];
        
        var slug = item.slug;
        var endpoint = season 
            ? DOMAINS.ridomovies + "/core/api/episodes/" + slug + "-" + season + "x" + episode + "/videos"
            : DOMAINS.ridomovies + "/core/api/movies/" + slug + "/videos";

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

// --- MAIN ENTRY ---

function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'movie' && mediaType !== 'tv') return Promise.resolve([]);

    return getTmdbInfo(tmdbId, mediaType).then(function(info) {
        var promises = [];
        var title = info.title;
        var year = info.year;
        var imdbId = info.imdbId;

        // 1. Direct APIs (Fastest)
        promises.push(invokeMappleTV(tmdbId, season, episode));
        promises.push(invokeVidRock(tmdbId, season, episode));

        // 2. High Quality WordPress Sites
        var wpSites = [
            { name: "VegaMovies", domain: DOMAINS.vegamovies },
            { name: "UHDMovies", domain: DOMAINS.uhdmovies },
            { name: "MoviesMod", domain: DOMAINS.moviesmod },
            { name: "BollyFlix", domain: DOMAINS.bollyflix }
        ];
        wpSites.forEach(function(site) {
            promises.push(invokeWordPress(site.name, site.domain, title, year, season, episode));
        });

        // 3. RidoMovies (Good Backup)
        promises.push(invokeRidoMovies(imdbId, season, episode));

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
    global.StreamPlayBestModule = { getStreams };
}
