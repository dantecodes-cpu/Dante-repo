// ToonStream provider for Nuvio
// Single file implementation with no external dependencies

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const MAIN_URL = 'https://toonstream.one';
const AJAX_URL = 'https://toonstream.one/wp-admin/admin-ajax.php';

// Debug helpers
function createRequestId() {
    try {
        var rand = Math.random().toString(36).slice(2, 8);
        var ts = Date.now().toString(36).slice(-6);
        return rand + ts;
    } catch (e) { return String(Date.now()); }
}

function logRid(rid, msg, extra) {
    try {
        if (typeof extra !== 'undefined') console.log('[ToonStream][rid:' + rid + '] ' + msg, extra);
        else console.log('[ToonStream][rid:' + rid + '] ' + msg);
    } catch (e) { }
}

// Headers for requests
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
};

// Generic fetch helper
function fetchRequest(url, options) {
    var merged = Object.assign({ method: 'GET', headers: HEADERS }, options || {});
    return fetch(url, merged).then(function (response) {
        if (!response.ok) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText);
        }
        return response;
    });
}

// Parse HTML string to DOM-like object
function parseHTML(html) {
    var doc = {
        querySelector: function(selector) {
            // Simple selector implementation for common cases
            if (selector === 'header.entry-header > h1') {
                var match = html.match(/<header[^>]*entry-header[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/i);
                return match ? { textContent: match[1].trim() } : null;
            }
            if (selector === 'div.description > p') {
                var match = html.match(/<div[^>]*description[^>]*>[\s\S]*?<p[^>]*>([^<]+)<\/p>/i);
                return match ? { textContent: match[1].trim() } : null;
            }
            if (selector === 'div.bghd > img') {
                var match = html.match(/<div[^>]*bghd[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i);
                return match ? { getAttribute: function() { return match[1]; } } : null;
            }
            if (selector === '#movies-a > ul > li article') {
                // Return array of article elements
                var articles = [];
                var articleMatches = html.match(/<article[\s\S]*?<\/article>/gi) || [];
                for (var i = 0; i < articleMatches.length; i++) {
                    articles.push({
                        querySelector: function(selector) {
                            if (selector === 'header > h2') {
                                var titleMatch = articleMatches[i].match(/<header[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/i);
                                return titleMatch ? { textContent: titleMatch[1].trim() } : null;
                            }
                            if (selector === 'a') {
                                var linkMatch = articleMatches[i].match(/<a[^>]*href="([^"]+)"/i);
                                return linkMatch ? { getAttribute: function() { return linkMatch[1]; } } : null;
                            }
                            if (selector === 'img') {
                                var imgMatch = articleMatches[i].match(/<img[^>]*src="([^"]+)"/i);
                                return imgMatch ? { getAttribute: function() { return imgMatch[1]; } } : null;
                            }
                            return null;
                        }
                    });
                }
                return articles;
            }
            if (selector === '#aa-options > div > iframe') {
                var iframes = [];
                var iframeMatches = html.match(/<iframe[^>]*data-src="([^"]+)"[^>]*>/gi) || [];
                for (var i = 0; i < iframeMatches.length; i++) {
                    var srcMatch = iframeMatches[i].match(/data-src="([^"]+)"/);
                    if (srcMatch) {
                        iframes.push({
                            getAttribute: function(attr) {
                                if (attr === 'data-src') return srcMatch[1];
                                return '';
                            }
                        });
                    }
                }
                return iframes.length > 0 ? iframes : null;
            }
            if (selector === 'div.aa-drp.choose-season > ul > li > a') {
                var seasonLinks = [];
                var pattern = /<div[^>]*aa-drp[^>]*choose-season[^>]*>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i;
                var ulMatch = html.match(pattern);
                if (ulMatch) {
                    var liMatches = ulMatch[1].match(/<li[\s\S]*?<\/li>/gi) || [];
                    for (var i = 0; i < liMatches.length; i++) {
                        var dataPost = liMatches[i].match(/data-post="([^"]+)"/);
                        var dataSeason = liMatches[i].match(/data-season="([^"]+)"/);
                        var textMatch = liMatches[i].match(/>([^<]+)</);
                        if (dataPost && dataSeason) {
                            seasonLinks.push({
                                getAttribute: function(attr) {
                                    if (attr === 'data-post') return dataPost[1];
                                    if (attr === 'data-season') return dataSeason[1];
                                    return '';
                                },
                                textContent: textMatch ? textMatch[1].trim() : ''
                            });
                        }
                    }
                }
                return seasonLinks.length > 0 ? seasonLinks : null;
            }
            return null;
        },
        querySelectorAll: function(selector) {
            var elem = this.querySelector(selector);
            if (Array.isArray(elem)) return elem;
            return elem ? [elem] : [];
        }
    };
    return doc;
}

// Get TMDB details
function getTMDBDetails(tmdbId, mediaType) {
    var url = TMDB_BASE_URL + '/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
    return fetchRequest(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
            return {
                title: data.title || data.name || data.original_title || data.original_name,
                originalTitle: data.original_title || data.original_name,
                year: mediaType === 'movie' 
                    ? (data.release_date ? parseInt(data.release_date.split('-')[0]) : null)
                    : (data.first_air_date ? parseInt(data.first_air_date.split('-')[0]) : null)
            };
        })
        .catch(function () { return { title: null, originalTitle: null, year: null }; });
}

// Search ToonStream by title
function searchToonStream(query) {
    var searchUrl = MAIN_URL + '/?s=' + encodeURIComponent(query);
    return fetchRequest(searchUrl)
        .then(function (res) { return res.text(); })
        .then(function (html) {
            var doc = parseHTML(html);
            var results = [];
            var items = doc.querySelectorAll('#movies-a > ul > li article');
            
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var titleElem = item.querySelector('header > h2');
                var linkElem = item.querySelector('a');
                var imgElem = item.querySelector('img');
                
                if (titleElem && linkElem) {
                    var title = titleElem.textContent.replace('Watch Online', '').trim();
                    var url = linkElem.getAttribute('href');
                    var poster = imgElem ? imgElem.getAttribute('src') : '';
                    
                    // Fix URLs
                    if (url && !url.startsWith('http')) {
                        url = url.startsWith('//') ? 'https:' + url : MAIN_URL + url;
                    }
                    if (poster && !poster.startsWith('http')) {
                        poster = poster.startsWith('//') ? 'https:' + poster : '';
                    }
                    
                    results.push({
                        title: title,
                        url: url,
                        poster: poster,
                        type: url.includes('/series/') ? 'tv' : 'movie'
                    });
                }
            }
            return results;
        })
        .catch(function () { return []; });
}

// Extract video from AWSStream/Zephyrflick
function extractAWSStream(url, referer) {
    return new Promise(function (resolve) {
        try {
            // Extract hash from URL
            var extractedHash = url.substring(url.lastIndexOf('/') + 1);
            var baseUrl = url.includes('zephyrflick.top') ? 'https://play.zephyrflick.top' : 'https://z.awstream.net';
            
            // Build request
            var m3u8Url = baseUrl + '/player/index.php?data=' + extractedHash + '&do=getVideo';
            var headers = Object.assign({}, HEADERS, {
                'x-requested-with': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': referer || url
            });
            
            var formData = 'hash=' + encodeURIComponent(extractedHash) + '&r=' + encodeURIComponent(baseUrl);
            
            fetch(m3u8Url, {
                method: 'POST',
                headers: headers,
                body: formData
            })
            .then(function (res) { return res.json(); })
            .then(function (response) {
                if (response && response.videoSource) {
                    resolve([{
                        url: response.videoSource,
                        quality: '1080p',
                        serverType: 'AWSStream'
                    }]);
                } else {
                    resolve([]);
                }
            })
            .catch(function () { resolve([]); });
        } catch (e) {
            resolve([]);
        }
    });
}

// Extract streams from a ToonStream page
function extractStreamsFromPage(url, season, episode) {
    return fetchRequest(url)
        .then(function (res) { return res.text(); })
        .then(function (html) {
            var doc = parseHTML(html);
            var streams = [];
            
            // Check if it's a series
            if (url.includes('/series/') || doc.querySelector('div.aa-drp.choose-season')) {
                return extractSeriesStreams(doc, url, season, episode);
            } else {
                return extractMovieStreams(doc, url);
            }
        })
        .catch(function () { return []; });
}

// Extract movie streams
function extractMovieStreams(doc, url) {
    return new Promise(function (resolve) {
        var streams = [];
        var iframes = doc.querySelectorAll('#aa-options > div > iframe');
        
        if (!iframes || iframes.length === 0) {
            resolve(streams);
            return;
        }
        
        var processed = 0;
        var total = iframes.length;
        
        for (var i = 0; i < iframes.length; i++) {
            (function (iframe) {
                var serverLink = iframe.getAttribute('data-src');
                if (serverLink) {
                    fetchRequest(serverLink)
                        .then(function (res) { return res.text(); })
                        .then(function (frameHtml) {
                            var frameDoc = parseHTML(frameHtml);
                            var videoFrame = frameDoc.querySelector('iframe');
                            
                            if (videoFrame) {
                                var videoUrl = videoFrame.getAttribute('src');
                                if (videoUrl) {
                                    // Extract from AWSStream/Zephyrflick
                                    if (videoUrl.includes('awstream.net') || videoUrl.includes('zephyrflick.top')) {
                                        extractAWSStream(videoUrl, serverLink)
                                            .then(function (awsStreams) {
                                                streams = streams.concat(awsStreams);
                                                processed++;
                                                if (processed === total) resolve(streams);
                                            });
                                    } else {
                                        // Direct stream
                                        streams.push({
                                            url: videoUrl,
                                            quality: 'Unknown',
                                            serverType: 'Direct'
                                        });
                                        processed++;
                                        if (processed === total) resolve(streams);
                                    }
                                } else {
                                    processed++;
                                    if (processed === total) resolve(streams);
                                }
                            } else {
                                processed++;
                                if (processed === total) resolve(streams);
                            }
                        })
                        .catch(function () {
                            processed++;
                            if (processed === total) resolve(streams);
                        });
                } else {
                    processed++;
                    if (processed === total) resolve(streams);
                }
            })(iframes[i]);
        }
    });
}

// Extract series streams
function extractSeriesStreams(doc, url, season, episode) {
    return new Promise(function (resolve) {
        var streams = [];
        var seasonLinks = doc.querySelectorAll('div.aa-drp.choose-season > ul > li > a');
        
        if (!seasonLinks || seasonLinks.length === 0) {
            resolve(streams);
            return;
        }
        
        var processed = 0;
        var total = seasonLinks.length;
        
        for (var i = 0; i < seasonLinks.length; i++) {
            (function (seasonLink) {
                var dataPost = seasonLink.getAttribute('data-post');
                var dataSeason = seasonLink.getAttribute('data-season');
                var seasonText = seasonLink.textContent;
                
                // Check if this is the requested season
                if (season && !seasonText.includes('Season ' + season)) {
                    processed++;
                    if (processed === total) resolve(streams);
                    return;
                }
                
                // Load season data via AJAX
                var formData = new URLSearchParams();
                formData.append('action', 'action_select_season');
                formData.append('season', dataSeason);
                formData.append('post', dataPost);
                
                fetch(AJAX_URL, {
                    method: 'POST',
                    headers: Object.assign({}, HEADERS, {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Requested-With': 'XMLHttpRequest'
                    }),
                    body: formData.toString()
                })
                .then(function (res) { return res.text(); })
                .then(function (seasonHtml) {
                    var seasonDoc = parseHTML(seasonHtml);
                    var episodeItems = seasonDoc.querySelectorAll('article');
                    
                    for (var j = 0; j < episodeItems.length; j++) {
                        var epItem = episodeItems[j];
                        var epLink = epItem.querySelector('a');
                        
                        if (epLink) {
                            var episodeUrl = epLink.getAttribute('href');
                            // Extract episode number from title
                            var epTitle = epItem.querySelector('header > h2');
                            if (epTitle) {
                                var epNumMatch = epTitle.textContent.match(/Episode\s+(\d+)/i);
                                var epNumber = epNumMatch ? parseInt(epNumMatch[1]) : null;
                                
                                // Check if this is the requested episode
                                if (episode && epNumber !== episode) {
                                    continue;
                                }
                                
                                // Extract streams from episode page
                                extractStreamsFromPage(episodeUrl)
                                    .then(function (epStreams) {
                                        streams = streams.concat(epStreams);
                                    });
                            }
                        }
                    }
                    
                    processed++;
                    if (processed === total) {
                        // Wait a bit for all episode streams to be extracted
                        setTimeout(function () { resolve(streams); }, 1000);
                    }
                })
                .catch(function () {
                    processed++;
                    if (processed === total) resolve(streams);
                });
            })(seasonLinks[i]);
        }
    });
}

// Quality detection
function extractQualityFromUrl(url) {
    var patterns = [
        /(\d{3,4})p/i,
        /quality[_-]?(\d{3,4})/i,
        /(\d{3,4})x\d{3,4}/i
    ];
    for (var i = 0; i < patterns.length; i++) {
        var m = url.match(patterns[i]);
        if (m) {
            var q = parseInt(m[1]);
            if (q >= 240 && q <= 4320) return q + 'p';
        }
    }
    return 'Unknown';
}

// Format streams for Nuvio
function formatToNuvioStreams(streams, mediaTitle) {
    var links = [];
    var headers = {
        'User-Agent': HEADERS['User-Agent'],
        'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity'
    };
    
    for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        var quality = s.quality || extractQualityFromUrl(s.url) || 'Unknown';
        var server = (s.serverType || 'server').toUpperCase();
        
        links.push({
            name: 'ToonStream ' + server + ' - ' + quality,
            title: mediaTitle || '',
            url: s.url,
            quality: quality,
            size: 'Unknown',
            headers: headers,
            subtitles: [],
            provider: 'toonstream'
        });
    }
    
    // Sort by quality
    var order = { '4K': 7, '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1, 'Unknown': 0 };
    links.sort(function (a, b) { return (order[b.quality] || 0) - (order[a.quality] || 0); });
    
    return links;
}

// Main Nuvio function
function getStreams(tmdbId, mediaType, season, episode) {
    var rid = createRequestId();
    logRid(rid, 'getStreams start', { tmdbId: tmdbId, mediaType: mediaType, season: season, episode: episode });
    
    var mediaInfo = null;
    
    // Step 1: Get title from TMDB
    return getTMDBDetails(tmdbId, mediaType)
        .then(function (tmdbData) {
            if (!tmdbData || !tmdbData.title) {
                throw new Error('Could not get TMDB details');
            }
            mediaInfo = tmdbData;
            logRid(rid, 'TMDB details', { title: tmdbData.title, year: tmdbData.year });
            
            // Step 2: Search ToonStream with the title
            var searchQuery = tmdbData.title;
            if (tmdbData.year) {
                searchQuery += ' ' + tmdbData.year;
            }
            return searchToonStream(searchQuery);
        })
        .then(function (searchResults) {
            if (!searchResults || searchResults.length === 0) {
                throw new Error('No results found on ToonStream');
            }
            
            logRid(rid, 'Search results', { count: searchResults.length });
            
            // Find the best match
            var bestMatch = searchResults[0];
            
            // For series, prefer series results
            if (mediaType === 'tv') {
                for (var i = 0; i < searchResults.length; i++) {
                    if (searchResults[i].type === 'tv') {
                        bestMatch = searchResults[i];
                        break;
                    }
                }
            }
            
            logRid(rid, 'Selected match', { title: bestMatch.title, url: bestMatch.url });
            
            // Step 3: Extract streams from the selected page
            return extractStreamsFromPage(bestMatch.url, season, episode);
        })
        .then(function (streams) {
            // Build media title
            var mediaTitle = mediaInfo.title;
            if (mediaType === 'tv' && season && episode) {
                var s = String(season).padStart(2, '0');
                var e = String(episode).padStart(2, '0');
                mediaTitle = mediaInfo.title + ' S' + s + 'E' + e;
            } else if (mediaInfo.year) {
                mediaTitle = mediaInfo.title + ' (' + mediaInfo.year + ')';
            }
            
            var formatted = formatToNuvioStreams(streams, mediaTitle);
            logRid(rid, 'Returning streams', { count: formatted.length });
            return formatted;
        })
        .catch(function (err) {
            logRid(rid, 'ERROR: ' + (err && err.message ? err.message : String(err)));
            return [];
        });
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamModule = { getStreams };
}
