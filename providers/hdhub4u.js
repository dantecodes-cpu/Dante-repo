// HDHub4u Scraper for Nuvio
// VERSION: 3.0 (Strict Port of Kotlin Source)
// Fixes: Redirect Resolution, HubCloud Extraction, TV Season Logic

const cheerio = require('cheerio-without-node-native');

// TMDB API Configuration
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// HDHub4u Configuration
let MAIN_URL = "https://hdhub4u.frl"; // Default fallback
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000;
let domainCacheTimestamp = 0;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Cookie": "xla=s4t",
    "Referer": `${MAIN_URL}/`,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
};

// =================================================================================
// UTILITY FUNCTIONS (Polyfills & Helpers)
// =================================================================================

// ROT13 Implementation (Matches 'pen' function in Utils.kt)
function rot13(str) {
    return str.replace(/[a-zA-Z]/g, function(c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}

// Base64 Polyfills (React Native safe)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function atobPoly(input) {
    if (!input) return '';
    var str = String(input).replace(/=+$/, '');
    var output = '';
    for (var bc = 0, bs = 0, buffer, i = 0; buffer = str.charAt(i++); ) {
        if (~(buffer = BASE64_CHARS.indexOf(buffer))) {
            bs = bc % 4 ? bs * 64 + buffer : buffer;
            if (bc++ % 4) output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
        }
    }
    return output;
}

function btoaPoly(input) {
    var str = String(input);
    var output = '';
    for (var block = 0, charCode, i = 0, map = BASE64_CHARS; str.charAt(i | 0) || (map = '=', i % 1); output += map.charAt(63 & block >> 8 - i % 1 * 8)) {
        charCode = str.charCodeAt(i += 3 / 4);
        if (charCode > 0xFF) throw new Error("'btoa' failed");
        block = block << 8 | charCode;
    }
    return output;
}

// Helpers
function fetchRequest(url, options) {
    options = options || {};
    options.headers = Object.assign({}, HEADERS, options.headers || {});
    return fetch(url, options).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
    });
}

function formatBytes(bytes) {
    if (!bytes) return 'Unknown';
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
}

function parseSizeStr(sizeStr) {
    if (!sizeStr) return 0;
    var match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB)/i);
    if (!match) return 0;
    var val = parseFloat(match[1]);
    var unit = match[2].toUpperCase();
    if (unit === 'GB') return val * 1024 * 1024 * 1024;
    if (unit === 'MB') return val * 1024 * 1024;
    if (unit === 'KB') return val * 1024;
    return 0;
}

function getQuality(str) {
    str = (str || '').toLowerCase();
    if (str.includes('2160p') || str.includes('4k')) return '4K';
    if (str.includes('1440p')) return '1440p';
    if (str.includes('1080p')) return '1080p';
    if (str.includes('720p')) return '720p';
    if (str.includes('480p')) return '480p';
    if (str.includes('360p')) return '360p';
    return 'Unknown';
}

function cleanTitle(title) {
    return title.replace(/\s+/g, ' ').trim();
}

// =================================================================================
// CORE LOGIC (Redirects & Domain)
// =================================================================================

function updateDomain() {
    var now = Date.now();
    if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) return Promise.resolve();
    return fetch(DOMAINS_URL).then(function(r) { return r.json(); }).then(function(data) {
        if (data && data.HDHUB4u) {
            MAIN_URL = data.HDHUB4u;
            HEADERS.Referer = MAIN_URL + "/";
            domainCacheTimestamp = now;
        }
    }).catch(function() {});
}

// Logic from Utils.kt: getRedirectLinks
function getRedirectLinks(url) {
    return fetchRequest(url).then(function(res) { return res.text(); }).then(function(doc) {
        var regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
        var match;
        var combined = "";
        while ((match = regex.exec(doc)) !== null) {
            combined += (match[1] || match[2] || "");
        }
        if (!combined) return url;

        // Kotlin: base64Decode(pen(base64Decode(base64Decode(combinedString))))
        try {
            var step1 = atobPoly(combined);
            var step2 = atobPoly(step1);
            var step3 = rot13(step2);
            var decodedJson = atobPoly(step3);
            
            var json = JSON.parse(decodedJson);

            // Note: Kotlin code calls 'base64Decode' on 'o', so we use atobPoly
            var encodedUrl = json.o ? atobPoly(json.o).trim() : "";
            
            // Note: Kotlin code calls 'encode' on 'data', which is actually a decode alias in Utils.kt
            var data = json.data ? atobPoly(json.data).trim() : ""; 
            var blogUrl = json.blog_url || "";

            if (encodedUrl) return encodedUrl;
            if (blogUrl && data) {
                return fetchRequest(blogUrl + "?re=" + data).then(function(r) { return r.text(); }).then(function(t) {
                    return t.trim() || url;
                });
            }
        } catch (e) {
            // console.log("Redirect decode failed: " + e);
        }
        return url;
    }).catch(function() { return url; });
}

// =================================================================================
// EXTRACTORS (HubCloud, etc.)
// =================================================================================

function invokeHubCloud(url, referer) {
    if (url.includes("hubcloud.ink")) url = url.replace("hubcloud.ink", "hubcloud.dad");

    return fetchRequest(url, { headers: { Referer: referer } }).then(function(res) { return res.text(); }).then(function(html) {
        // Handle 'var url = ...' redirect pattern often found in HubCloud
        var scriptUrl = /var url = '([^']*)'/.exec(html);
        if (!url.includes("hubcloud.php") && scriptUrl && scriptUrl[1]) {
            return fetchRequest(scriptUrl[1], { headers: { Referer: url } }).then(function(r) { return r.text(); });
        }
        return html;
    }).then(function(html) {
        var $ = cheerio.load(html);
        var sizeStr = $('i#size').text().trim();
        var header = $('div.card-header').text().trim();
        var quality = getQuality(header);
        var sizeBytes = parseSizeStr(sizeStr);
        var sizeLabel = sizeStr ? " [" + sizeStr + "]" : "";
        var titleLabel = header ? " [" + header + "]" : "";

        var streams = [];
        var promises = [];

        $('div.card-body h2 a.btn').each(function(i, el) {
            var link = $(el).attr('href');
            var text = $(el).text().trim();
            var sourceName = "HubCloud";

            if (text.includes("Download File") || text.includes("FSL Server") || text.includes("S3 Server") || text.includes("FSLv2") || text.includes("Mega Server")) {
                sourceName = text.replace("Download", "").trim() || "HubCloud";
                streams.push({
                    name: sourceName + titleLabel + sizeLabel,
                    url: link,
                    quality: quality,
                    size: sizeBytes,
                    provider: "HubCloud",
                    type: 'url'
                });
            } else if (text.includes("BuzzServer")) {
                var p = fetch(link + "/download", { method: 'HEAD', redirect: 'manual' }).then(function(r) {
                    var loc = r.headers.get("location");
                    if (loc && loc.includes("hx-redirect=")) {
                        var final = decodeURIComponent(loc.split("hx-redirect=")[1]);
                        streams.push({ name: "BuzzServer" + titleLabel, url: final, quality: quality, size: sizeBytes, provider: "HubCloud", type: 'url' });
                    }
                }).catch(function() {});
                promises.push(p);
            } else if (text.includes("10Gbps")) {
                // Manual redirect following loop (max 3)
                var p = (function follow(u, count) {
                    if (count > 3) return Promise.resolve();
                    return fetch(u, { method: 'GET', redirect: 'manual' }).then(function(r) {
                        var loc = r.headers.get("location");
                        if (loc) {
                            if (loc.includes("link=")) {
                                var final = loc.split("link=")[1];
                                streams.push({ name: "10Gbps" + titleLabel, url: final, quality: quality, size: sizeBytes, provider: "HubCloud", type: 'url' });
                            } else {
                                return follow(new URL(loc, u).toString(), count + 1);
                            }
                        }
                    }).catch(function() {});
                })(link, 0);
                promises.push(p);
            } else if (link.includes("pixeldra")) {
                streams.push({ name: "PixelDrain" + titleLabel, url: link, quality: quality, size: sizeBytes, provider: "PixelDrain", type: 'url' });
            }
        });

        return Promise.all(promises).then(function() { return streams; });
    }).catch(function() { return []; });
}

// Main Dispatcher for Links
function extractLink(url, referer) {
    if (url.includes("?id=") || url.includes("techyboy")) {
        return getRedirectLinks(url).then(function(finalUrl) {
            if (finalUrl == url) return []; // Failed to resolve
            return extractLink(finalUrl, url);
        });
    }
    if (url.includes("hubcloud") || url.includes("hubdrive")) {
        return invokeHubCloud(url, referer);
    }
    // Fallback: return direct link
    return Promise.resolve([{
        name: "HDHub Link",
        url: url,
        quality: "Unknown",
        provider: "HDHub4u",
        type: 'url'
    }]);
}

// =================================================================================
// MAIN SCRAPER
// =================================================================================

function getStreams(tmdbId, mediaType, season, episode) {
    return updateDomain().then(function() {
        return getTMDBDetails(tmdbId, mediaType);
    }).then(function(info) {
        var title = info.title;
        var year = info.year;
        
        // Construct search query
        var searchQuery = mediaType === 'tv' && season 
            ? title + " season " + season
            : title;
            
        var searchUrl = MAIN_URL + "/?s=" + encodeURIComponent(searchQuery);
        
        return fetchRequest(searchUrl).then(function(res) { return res.text(); }).then(function(html) {
            var $ = cheerio.load(html);
            var posts = [];
            
            // Parse Search Results (Kotlin: ".recent-movies > li.thumb")
            $('.recent-movies > li.thumb').each(function(i, el) {
                var href = $(el).find('figure a').attr('href');
                var pTitle = $(el).find('figcaption p').text();
                if (href && pTitle) {
                    var normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
                    var normPTitle = pTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
                    
                    // Fuzzy match
                    if (normPTitle.includes(normTitle)) {
                        if (mediaType === 'movie' && year && pTitle.includes(year)) {
                            posts.push(href);
                        } else if (mediaType === 'tv' && pTitle.toLowerCase().includes("season " + season)) {
                            posts.push(href);
                        }
                    }
                }
            });

            if (posts.length === 0) return [];

            var streamPromises = [];

            posts.forEach(function(postUrl) {
                var p = fetchRequest(postUrl).then(function(res) { return res.text(); }).then(function(postHtml) {
                    var $$ = cheerio.load(postHtml);
                    var linksToResolve = [];

                    if (mediaType === 'movie') {
                        // Movie Logic: h3/h4 with quality text
                        $$('h3 a, h4 a').each(function(i, el) {
                            var txt = $$(el).text();
                            var href = $$(el).attr('href');
                            if (href && (txt.match(/480|720|1080|2160|4K/i))) {
                                linksToResolve.push(href);
                            }
                        });
                    } else {
                        // TV Logic: Precise Episode Matching
                        var epRegex = new RegExp("Episode\\s*" + episode, "i");
                        
                        // Iterate headers h3/h4
                        $$('h3, h4').each(function(i, el) {
                            var headerTxt = $$(el).text();
                            
                            if (epRegex.test(headerTxt)) {
                                // Found the specific episode header!
                                // Collect all links from this header until the next header or <hr>
                                var next = $$(el).next();
                                while(next.length > 0 && next[0].tagName !== 'h3' && next[0].tagName !== 'h4' && next[0].tagName !== 'hr') {
                                    next.find('a').each(function(j, a) {
                                        var href = $$(a).attr('href');
                                        if (href) linksToResolve.push(href);
                                    });
                                    next = next.next();
                                }
                                // Also check inside the header itself (sometimes links are inside the h4)
                                $$(el).find('a').each(function(j, a) {
                                    var href = $$(a).attr('href');
                                    if (href) linksToResolve.push(href);
                                });
                            }
                        });
                    }

                    // Remove duplicates
                    linksToResolve = linksToResolve.filter(function(item, pos) {
                        return linksToResolve.indexOf(item) == pos;
                    });

                    var resolvePromises = linksToResolve.map(function(l) {
                        return extractLink(l, postUrl);
                    });

                    return Promise.all(resolvePromises).then(function(res) {
                        return res.flat();
                    });
                });
                streamPromises.push(p);
            });

            return Promise.all(streamPromises).then(function(results) {
                var streams = results.flat().filter(function(s) { return s && s.url; });
                
                // Deduplicate
                var unique = [];
                var seen = {};
                streams.forEach(function(s) {
                    if (!seen[s.url]) {
                        seen[s.url] = true;
                        s.headers = HEADERS; // Ensure headers attached
                        unique.push(s);
                    }
                });

                // Sort: 4K > 1080p > 720p
                var order = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, 'Unknown': 0 };
                unique.sort(function(a, b) {
                    return (order[b.quality] || 0) - (order[a.quality] || 0);
                });

                return unique;
            });
        });
    }).catch(function(e) {
        console.error("[HDHub4u] Error: " + e);
        return [];
    });
}

function getTMDBDetails(tmdbId, mediaType) {
    var endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    var url = TMDB_BASE_URL + '/' + endpoint + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
    return fetchRequest(url).then(function(res) { return res.json(); }).then(function(data) {
        var title = mediaType === 'tv' ? data.name : data.title;
        var date = mediaType === 'tv' ? data.first_air_date : data.release_date;
        return {
            title: title,
            year: date ? date.split('-')[0] : null,
            imdbId: data.external_ids ? data.external_ids.imdb_id : null
        };
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.HDHub4uModule = { getStreams };
}
