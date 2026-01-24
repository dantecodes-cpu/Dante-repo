// ToonStream provider for Nuvio
// Based on Cloudstream's ToonStream implementation

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
        return response.text();
    }).catch(function (error) {
        console.error('[ToonStream] Fetch error for', url, error);
        throw error;
    });
}

// Parse HTML using regex (no cheerio in React Native)
function parseHTML(html) {
    return {
        // Get element by selector
        querySelector: function(selector) {
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
                // Return first article
                var articleMatch = html.match(/<article[^>]*>[\s\S]*?<\/article>/i);
                if (articleMatch) {
                    var articleHtml = articleMatch[0];
                    return {
                        querySelector: function(subSelector) {
                            if (subSelector === 'header > h2') {
                                var titleMatch = articleHtml.match(/<header[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/i);
                                return titleMatch ? { textContent: titleMatch[1].trim() } : null;
                            }
                            if (subSelector === 'a') {
                                var linkMatch = articleHtml.match(/<a[^>]*href="([^"]+)"/i);
                                return linkMatch ? { getAttribute: function() { return linkMatch[1]; } } : null;
                            }
                            if (subSelector === 'img') {
                                var imgMatch = articleHtml.match(/<img[^>]*src="([^"]+)"/i);
                                return imgMatch ? { getAttribute: function() { return imgMatch[1]; } } : null;
                            }
                            return null;
                        }
                    };
                }
                return null;
            }
            if (selector === '#aa-options > div > iframe') {
                // Return first iframe
                var iframeMatch = html.match(/<iframe[^>]*data-src="([^"]+)"[^>]*>/i);
                if (iframeMatch) {
                    return {
                        getAttribute: function(attr) {
                            if (attr === 'data-src') return iframeMatch[1];
                            return '';
                        }
                    };
                }
                return null;
            }
            if (selector === 'div.aa-drp.choose-season > ul > li > a') {
                var seasonDivMatch = html.match(/<div[^>]*aa-drp[^>]*choose-season[^>]*>[\s\S]*?<\/div>/i);
                if (seasonDivMatch) {
                    var linkMatch = seasonDivMatch[0].match(/<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>([^<]+)<\/a>/i);
                    if (linkMatch) {
                        return {
                            getAttribute: function(attr) {
                                if (attr === 'data-post') return linkMatch[1];
                                if (attr === 'data-season') return linkMatch[2];
                                return '';
                            },
                            textContent: linkMatch[3] || ''
                        };
                    }
                }
                return null;
            }
            if (selector === 'iframe') {
                var iframeMatch = html.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i);
                if (iframeMatch) {
                    return {
                        getAttribute: function(attr) {
                            if (attr === 'src') return iframeMatch[1];
                            return '';
                        }
                    };
                }
                return null;
            }
            return null;
        },
        // Get all elements by selector
        querySelectorAll: function(selector) {
            var elem = this.querySelector(selector);
            if (selector === '#movies-a > ul > li article') {
                // Return all articles
                var articles = [];
                var articleRegex = /<article[^>]*>[\s\S]*?<\/article>/gi;
                var articleMatch;
                while ((articleMatch = articleRegex.exec(html)) !== null) {
                    var articleHtml = articleMatch[0];
                    articles.push({
                        querySelector: function(subSelector) {
                            if (subSelector === 'header > h2') {
                                var titleMatch = articleHtml.match(/<header[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/i);
                                return titleMatch ? { textContent: titleMatch[1].trim() } : null;
                            }
                            if (subSelector === 'a') {
                                var linkMatch = articleHtml.match(/<a[^>]*href="([^"]+)"/i);
                                return linkMatch ? { getAttribute: function() { return linkMatch[1]; } } : null;
                            }
                            if (subSelector === 'img') {
                                var imgMatch = articleHtml.match(/<img[^>]*src="([^"]+)"/i);
                                return imgMatch ? { getAttribute: function() { return imgMatch[1]; } } : null;
                            }
                            return null;
                        }
                    });
                }
                return articles;
            }
            if (selector === '#aa-options > div > iframe') {
                // Return all iframes
                var iframes = [];
                var iframeRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/gi;
                var iframeMatch;
                while ((iframeMatch = iframeRegex.exec(html)) !== null) {
                    iframes.push({
                        getAttribute: function(attr) {
                            if (attr === 'data-src') return iframeMatch[1];
                            return '';
                        }
                    });
                }
                return iframes;
            }
            if (selector === 'div.aa-drp.choose-season > ul > li > a') {
                var links = [];
                var seasonDivMatch = html.match(/<div[^>]*aa-drp[^>]*choose-season[^>]*>[\s\S]*?<\/div>/i);
                if (seasonDivMatch) {
                    var linkRegex = /<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
                    var linkMatch;
                    while ((linkMatch = linkRegex.exec(seasonDivMatch[0])) !== null) {
                        links.push({
                            getAttribute: function(attr) {
                                if (attr === 'data-post') return linkMatch[1];
                                if (attr === 'data-season') return linkMatch[2];
                                return '';
                            },
                            textContent: linkMatch[3] || ''
                        });
                    }
                }
                return links;
            }
            return elem ? [elem] : [];
        }
    };
}

// Get TMDB details
function getTMDBDetails(tmdbId, mediaType) {
    var url = TMDB_BASE_URL + '/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
    return fetchRequest(url).then(function (html) {
        try {
            var data = JSON.parse(html);
            return {
                title: data.title || data.name || data.original_title || data.original_name,
                originalTitle: data.original_title || data.original_name,
                year: mediaType === 'movie' 
                    ? (data.release_date ? parseInt(data.release_date.split('-')[0]) : null)
                    : (data.first_air_date ? parseInt(data.first_air_date.split('-')[0]) : null)
            };
        } catch (e) {
            return { title: null, originalTitle: null, year: null };
        }
    }).catch(function () {
        return { title: null, originalTitle: null, year: null };
    });
}

// Search ToonStream by title
function searchToonStream(query) {
    var searchUrl = MAIN_URL + '/?s=' + encodeURIComponent(query);
    return fetchRequest(searchUrl).then(function (html) {
        var doc = parseHTML(html);
        var results = [];
        var items = doc.querySelectorAll('#movies-a > ul > li article');
        
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var titleElem = item.querySelector('header > h2');
            var linkElem = item.querySelector('a');
            
            if (titleElem && linkElem) {
                var title = titleElem.textContent.replace('Watch Online', '').trim();
                var url = linkElem.getAttribute('href');
                
                // Fix URL if needed
                if (url && !url.startsWith('http')) {
                    url = url.startsWith('//') ? 'https:' + url : MAIN_URL + url;
                }
                
                results.push({
                    title: title,
                    url: url,
                    type: url.includes('/series/') ? 'tv' : 'movie'
                });
            }
        }
        return results;
    }).catch(function () {
        return [];
    });
}

// Extract AWSStream/Zephyrflick video URL (from Cloudstream's AWSStream class)
function extractAWSStreamVideo(embedUrl, referer) {
    return new Promise(function (resolve) {
        try {
            // Extract hash from URL
            var extractedHash = embedUrl.substring(embedUrl.lastIndexOf('/') + 1);
            var mainUrl = embedUrl.includes('zephyrflick.top') ? 'https://play.zephyrflick.top' : 'https://z.awstream.net';
            
            // Build AJAX request URL
            var m3u8Url = mainUrl + '/player/index.php?data=' + extractedHash + '&do=getVideo';
            
            // Prepare form data
            var formData = new URLSearchParams();
            formData.append('hash', extractedHash);
            formData.append('r', mainUrl);
            
            // Make the request
            fetch(m3u8Url, {
                method: 'POST',
                headers: {
                    'User-Agent': HEADERS['User-Agent'],
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-requested-with': 'XMLHttpRequest',
                    'Referer': referer || embedUrl
                },
                body: formData.toString()
            })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) {
                if (data && data.videoSource) {
                    resolve([{
                        url: data.videoSource,
                        quality: '1080p',
                        serverType: 'AWSStream',
                        headers: {
                            'Referer': mainUrl,
                            'User-Agent': HEADERS['User-Agent']
                        }
                    }]);
                } else {
                    resolve([]);
                }
            })
            .catch(function (error) {
                console.error('[ToonStream] AWSStream extraction error:', error);
                resolve([]);
            });
        } catch (error) {
            console.error('[ToonStream] AWSStream error:', error);
            resolve([]);
        }
    });
}

// Extract from embed page
function extractFromEmbed(embedUrl, referer) {
    return fetchRequest(embedUrl).then(function (html) {
        var streams = [];
        
        // Check if this is an AWSStream/Zephyrflick embed
        if (embedUrl.includes('awstream.net') || embedUrl.includes('zephyrflick.top')) {
            return extractAWSStreamVideo(embedUrl, referer);
        }
        
        // Look for nested iframe
        var doc = parseHTML(html);
        var iframe = doc.querySelector('iframe');
        if (iframe) {
            var nestedUrl = iframe.getAttribute('src');
            if (nestedUrl) {
                // Fix URL if relative
                if (nestedUrl.startsWith('//')) {
                    nestedUrl = 'https:' + nestedUrl;
                } else if (nestedUrl.startsWith('/')) {
                    var baseDomain = embedUrl.match(/https?:\/\/[^\/]+/)[0];
                    nestedUrl = baseDomain + nestedUrl;
                }
                
                // Recursively extract from nested iframe
                return extractFromEmbed(nestedUrl, embedUrl);
            }
        }
        
        // Look for direct video URLs in the page
        var videoPatterns = [
            /(https?:\/\/[^\s"'<>]+\.m3u8)/gi,
            /(https?:\/\/[^\s"'<>]+\.mp4)/gi,
            /"file"\s*:\s*"([^"]+\.m3u8)"/gi,
            /"src"\s*:\s*"([^"]+\.m3u8)"/gi
        ];
        
        for (var i = 0; i < videoPatterns.length; i++) {
            var matches = html.match(videoPatterns[i]);
            if (matches) {
                for (var j = 0; j < matches.length; j++) {
                    var url = matches[j].replace(/\\\//g, '/').replace(/^"|"$/g, '');
                    if (url.includes('.m3u8') || url.includes('.mp4')) {
                        streams.push({
                            url: url,
                            quality: extractQualityFromUrl(url),
                            serverType: 'Direct',
                            headers: {
                                'Referer': embedUrl,
                                'User-Agent': HEADERS['User-Agent']
                            }
                        });
                    }
                }
            }
        }
        
        return streams;
    }).catch(function () {
        return [];
    });
}

// Extract quality from URL
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

// Extract streams from ToonStream page
function extractStreamsFromPage(pageUrl, season, episode) {
    return fetchRequest(pageUrl).then(function (html) {
        var streams = [];
        var doc = parseHTML(html);
        
        // Check if it's a series page
        if (pageUrl.includes('/series/') || doc.querySelector('div.aa-drp.choose-season')) {
            return extractSeriesStreams(doc, pageUrl, season, episode);
        } else {
            return extractMovieStreams(doc, pageUrl);
        }
    }).catch(function (error) {
        console.error('[ToonStream] Error loading page:', pageUrl, error);
        return [];
    });
}

// Extract movie streams
function extractMovieStreams(doc, pageUrl) {
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
                    console.log('[ToonStream] Processing embed:', serverLink);
                    
                    extractFromEmbed(serverLink, pageUrl)
                        .then(function (videoStreams) {
                            streams = streams.concat(videoStreams);
                            processed++;
                            if (processed === total) resolve(streams);
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
function extractSeriesStreams(doc, pageUrl, season, episode) {
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
                
                // If specific season requested, check match
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
                .then(function (response) { return response.text(); })
                .then(function (seasonHtml) {
                    // Extract episode links from season HTML
                    var episodeRegex = /<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?Episode\s+(\d+)[\s\S]*?<\/a>/gi;
                    var episodeMatch;
                    var episodePromises = [];
                    
                    while ((episodeMatch = episodeRegex.exec(seasonHtml)) !== null) {
                        var episodeUrl = episodeMatch[1];
                        var episodeNum = parseInt(episodeMatch[2]);
                        
                        // If specific episode requested, check match
                        if (episode && episodeNum !== episode) {
                            continue;
                        }
                        
                        // Fix URL if needed
                        if (episodeUrl && !episodeUrl.startsWith('http')) {
                            episodeUrl = episodeUrl.startsWith('//') ? 'https:' + episodeUrl : MAIN_URL + episodeUrl;
                        }
                        
                        // Extract streams from episode page
                        var epPromise = extractStreamsFromPage(episodeUrl)
                            .then(function (episodeStreams) {
                                streams = streams.concat(episodeStreams);
                            });
                        episodePromises.push(epPromise);
                    }
                    
                    // Wait for all episode streams to be processed
                    Promise.all(episodePromises)
                        .then(function () {
                            processed++;
                            if (processed === total) resolve(streams);
                        })
                        .catch(function () {
                            processed++;
                            if (processed === total) resolve(streams);
                        });
                })
                .catch(function (error) {
                    console.error('[ToonStream] Error loading season:', error);
                    processed++;
                    if (processed === total) resolve(streams);
                });
            })(seasonLinks[i]);
        }
    });
}

// Format streams for Nuvio
function formatToNuvioStreams(streams, mediaTitle) {
    var links = [];
    
    for (var i = 0; i < streams.length; i++) {
        var s = streams[i];
        
        links.push({
            name: 'ToonStream - ' + (s.serverType || 'Unknown') + ' - ' + (s.quality || 'Unknown'),
            title: mediaTitle || '',
            url: s.url,
            quality: s.quality || 'Unknown',
            size: 'Unknown',
            headers: s.headers || {
                'User-Agent': HEADERS['User-Agent'],
                'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity',
                'Referer': MAIN_URL
            },
            subtitles: [],
            provider: 'toonstream'
        });
    }
    
    // Remove duplicates
    var uniqueLinks = [];
    var seenUrls = {};
    for (var j = 0; j < links.length; j++) {
        if (!seenUrls[links[j].url]) {
            seenUrls[links[j].url] = true;
            uniqueLinks.push(links[j]);
        }
    }
    
    // Sort by quality
    var order = { '4K': 7, '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1, 'Unknown': 0 };
    uniqueLinks.sort(function (a, b) { return (order[b.quality] || 0) - (order[a.quality] || 0); });
    
    return uniqueLinks;
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
            
            // Find the best match (prefer correct media type)
            var bestMatch = searchResults[0];
            for (var i = 0; i < searchResults.length; i++) {
                if ((mediaType === 'tv' && searchResults[i].type === 'tv') ||
                    (mediaType === 'movie' && searchResults[i].type === 'movie')) {
                    bestMatch = searchResults[i];
                    break;
                }
            }
            
            logRid(rid, 'Selected match', { title: bestMatch.title, url: bestMatch.url, type: bestMatch.type });
            
            // Step 3: Extract streams from the selected page
            return extractStreamsFromPage(bestMatch.url, season, episode);
        })
        .then(function (streams) {
            logRid(rid, 'Extracted raw streams', { count: streams.length });
            
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
            logRid(rid, 'Returning formatted streams', { count: formatted.length });
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
