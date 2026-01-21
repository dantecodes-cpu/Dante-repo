const TOONSTREAM_BASE = "https://toonstream.one";

/**
 * Main function to get search results and home page content.
 */
function getStreams(query, type) {
  if (query) {
    return search(query);
  }
  return getHome();
}

/**
 * [span_0](start_span)Implements the search logic from Toonstream.kt[span_0](end_span).
 * Iterates through the first 3 pages of results.
 */
async function search(query) {
  const searchResults = [];
  for (let i = 1; i <= 3; i++) {
    const url = `${TOONSTREAM_BASE}/page/${i}/?s=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    const items = doc.querySelectorAll("#movies-a > ul > li");
    if (items.length === 0) break;

    items.forEach(item => {
      const title = item.querySelector("article > header > h2")?.textContent.replace("Watch Online", "").trim();
      const href = item.querySelector("article > a")?.getAttribute("href");
      let poster = item.querySelector("article figure img")?.getAttribute("src");
      if (poster && !poster.startsWith("http")) poster = "https:" + poster;

      searchResults.push({
        title,
        url: href,
        poster,
        [span_1](start_span)type: "movie" // Defaulting to movie as per Kotlin toSearch()[span_1](end_span)
      });
    });
  }
  return searchResults;
}

/**
 * [span_2](start_span)Implements the load logic for both Movies and TV Series[span_2](end_span).
 */
async function loadMetadata(url) {
  const response = await fetch(url);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const title = doc.querySelector("header.entry-header > h1")?.textContent.replace("Watch Online", "").trim();
  const description = doc.querySelector("div.description > p")?.textContent.trim();
  let poster = doc.querySelector("div.bghd > img")?.getAttribute("src");
  if (poster && !poster.startsWith("http")) poster = "https:" + poster;

  const isSeries = url.includes("series");
  
  if (isSeries) {
    const episodes = [];
    const seasonElements = doc.querySelectorAll("div.aa-drp.choose-season > ul > li > a");
    
    for (const info of seasonElements) {
      const dataPost = info.getAttribute("data-post");
      const dataSeason = info.getAttribute("data-season");

      [span_3](start_span)// Ajax call for seasons[span_3](end_span)
      const ajaxResponse = await fetch(`${TOONSTREAM_BASE}/wp-admin/admin-ajax.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
        body: `action=action_select_season&season=${dataSeason}&post=${dataPost}`
      });
      const seasonHtml = await ajaxResponse.text();
      const seasonDoc = new DOMParser().parseFromString(seasonHtml, "text/html");

      seasonDoc.querySelectorAll("article").forEach(ep => {
        const epHref = ep.querySelector("a")?.getAttribute("href");
        const epTitle = ep.querySelector("h2")?.textContent.trim();
        episodes.push({
          name: epTitle,
          url: epHref,
          season: parseInt(dataSeason)
        });
      });
    }
    return { title, description, poster, episodes, type: "series" };
  }

  return { title, description, poster, url, type: "movie" };
}

/**
 * [span_4](start_span)[span_5](start_span)Implements Link Extraction including the AWSStream/Zephyrflick logic[span_4](end_span)[span_5](end_span).
 */
async function loadLinks(data) {
  const response = await fetch(data);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sources = [];

  const iframes = doc.querySelectorAll("#aa-options > div > iframe");
  for (const iframe of iframes) {
    const serverLink = iframe.getAttribute("data-src");
    const iframeRes = await fetch(serverLink);
    const iframeHtml = await iframeRes.text();
    const innerDoc = new DOMParser().parseFromString(iframeHtml, "text/html");
    const streamUrl = innerDoc.querySelector("iframe")?.getAttribute("src");

    if (streamUrl && (streamUrl.includes("awstream.net") || streamUrl.includes("zephyrflick.top"))) {
      const hash = streamUrl.split("/").pop();
      const apiUrl = `${streamUrl.includes("zephyrflick") ? "https://play.zephyrflick.top" : "https://z.awstream.net"}/player/index.php?data=${hash}&do=getVideo`;
      
      const apiRes = await fetch(apiUrl, {
        method: "POST",
        headers: { "x-requested-with": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" },
        body: `hash=${hash}&r=${encodeURIComponent(TOONSTREAM_BASE)}`
      });
      
      const json = await apiRes.json();
      if (json.videoSource) {
        sources.push({
          url: json.videoSource,
          quality: "1080p",
          type: "hls"
        });
      }
    }
  }
  return sources;
}

