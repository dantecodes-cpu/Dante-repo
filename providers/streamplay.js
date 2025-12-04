// StreamPlay HTTPS Scraper for Nuvio
// Based on StreamPlayPlugin.kt
// Focus: Direct HTTP Providers (Non-Torrent)
// Sources: RidoMovies, UHDMovies, MoviesMod, VidSrc, SuperStream

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

// --- Domain Config (From StreamPlay.kt) ---
const DOMAINS = {
    ridomovies: "https://ridomovies.tv",
    uhdmovies: "https://uhdmovies.fyi",
    moviesmod: "https://moviesmod.vip",
    vidsrc: "https://vidsrc.net",
    superstream: "https://item.gstb.fun" // FourthAPI from Kotlin code
};

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://google.com/'
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

function fetchJson(url) {
    return fetchRequest(url).then(function(res) { return res.json(); });
}

function fetchText(url) {
    return fetchRequest(url).then(function(res) { return res.text(); });
}

function getQuality(str) {
    str = (str || '').toLowerCase();
    if (str.includes('2160p') || str.includes('4k')) return '4K';
    if (str.includes('1080p')) return '1080p';
    if (str.includes('720p')) return '720p';
    return 'Unknown';
}

// --- ID Mapping ---

function getMetaInfo(tmdbId, type) {
    var url = TMDB_API + '/' + type + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&append_to_response=external_ids';
    return fetchJson(url).then(function(data) {
        return {
            title: type === 'movie' ? data.title : data.name,
            year: (type === 'movie' ? data.release_date : data.first_air_date || '').split('-')[0],
            imdbId: data.external_ids ? data.external_ids.imdb_id : null
        };
    });
}

// --- PROVIDER 1: RidoMovies (API Based) ---
function invokeRidoMovies(imdbId, season, episode) {
    if (!imdbId) return Promise.resolve([]);
    
    var searchUrl = DOMAINS.ridomovies + "/core/api/search?q=" + imdbId;
    
    return fetchJson(searchUrl).then(function(json) {
        var items = json.data && json.data.items;
        if (!items || items.length === 0) return [];
        
        var slug = items[0].slug;
        
        // Rido API Structure for streams
        var endpoint = season 
            ? DOMAINS.ridomovies + "/core/api/episodes/" + slug + "-" + season + "x" + episode + "/videos"
            : DOMAINS.ridomovies + "/core/api/movies/" + slug + "/videos";

        // Fallback for ID based lookup if slug fails
        // In StreamPlayExtractor.kt, they sometimes use ID. 
        // We stick to slug matching for now as it's cleaner in JS.

        return fetchJson(endpoint).then(function(res) {
            var data = res.data;
            if (!data) return [];
            
            return data.map(function(item) {
                var url = item.url;
                if(url.includes("closeload")) return null; // Skip closeload (often ads)
                
                return {
                    name: "RidoMovies | " + (item.quality || "HD"),
                    title: slug,
                    url: url,
                    quality: item.quality === "1080p" ? "1080p" : "720p",
                    provider: "RidoMovies",
                    type: 'embed' // Usually an iframe
                };
            }).filter(function(i) { return i !== null; });
        });
    }).catch(function() { return []; });
}

// --- PROVIDER 2: Generic WordPress (UHD/MoviesMod) ---
function invokeWordPress(siteName, domain, title, year, season, episode) {
    if (!title) return Promise.resolve([]);
    var query = encodeURIComponent(title + (season ? " Season " + season : " " + year));
    var url = domain + "/?s=" + query;

    return fetchText(url).then(function(html) {
        // Regex to find the article URL
        var match = /href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g.exec(html);
        if (!match) return [];
        var postUrl = match[1];

        return fetchText(postUrl).then(function(postHtml) {
            var streams = [];
            // Regex to find "Download", "Watch", "V-Cloud" links
            var linkRegex = /href="(https?:\/\/[^"]+)"[^>]*>([^<]*(Download|Watch|1080p|720p)[^<]*)</gi;
            var linkMatch;
            
            while ((linkMatch = linkRegex.exec(postHtml)) !== null) {
                var href = linkMatch[1];
                var label = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                
                // Filtering logic similar to Kotlin
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
            return streams.slice(0, 10);
        });
    }).catch(function() { return []; });
}

// --- PROVIDER 3: VidSrc (Iframe) ---
function invokeVidSrc(imdbId, season, episode) {
    if (!imdbId) return Promise.resolve([]);
    
    // https://vidsrc.net/embed/movie?imdb=tt12345
    // https://vidsrc.net/embed/tv?imdb=tt12345&season=1&episode=1
    var url = DOMAINS.vidsrc + "/embed/" + (season ? "tv" : "movie") + "?imdb=" + imdbId;
    if (season) url += "&season=" + season + "&episode=" + episode;

    // Nuvio can often resolve these embed URLs directly if returned
    return Promise.resolve([{
        name: "VidSrc | Auto",
        title: "VidSrc Stream",
        url: url,
        quality: "1080p",
        provider: "VidSrc",
        type: 'embed',
        headers: { "Referer": DOMAINS.vidsrc }
    }]);
}

// --- MAIN ENTRY ---

function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'movie' && mediaType !== 'tv') return Promise.resolve([]);

    return getMetaInfo(tmdbId, mediaType).then(function(meta) {
        var promises = [];
        var title = meta.title;
        var year = meta.year;
        var imdbId = meta.imdbId;

        // 1. RidoMovies (Fast, Reliable)
        promises.push(invokeRidoMovies(imdbId, season, episode));

        // 2. WordPress Sites (High Quality)
        promises.push(invokeWordPress("UHDMovies", DOMAINS.uhdmovies, title, year, season, episode));
        promises.push(invokeWordPress("MoviesMod", DOMAINS.moviesmod, title, year, season, episode));

        // 3. VidSrc (Backup)
        promises.push(invokeVidSrc(imdbId, season, episode));

        return Promise.allSettled(promises).then(function(results) {
            var streams = [];
            results.forEach(function(r) {
                if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                    streams = streams.concat(r.value);
                }
            });

            // Sort by Quality
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
    global.StreamPlayModule = { getStreams };
}
