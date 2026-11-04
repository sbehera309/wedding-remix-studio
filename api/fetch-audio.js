module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, deck } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Extract YouTube Video ID
  const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = url.match(ytRegex);
  const videoId = match ? match[1] : null;

  // 1. Fetch live YouTube video metadata using YouTube's official oEmbed API
  let title = null;
  let author = null;
  let thumbnail = null;
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const oembedRes = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(3500)
    });
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      title = oembedData.title || null;
      author = oembedData.author_name || null;
      thumbnail = oembedData.thumbnail_url || null;
    }
  } catch (err) {
    console.warn("oEmbed metadata lookup warning:", err.message);
  }

  // 2. Check for Catalog Auto-Match
  // If the user pasted a link for one of our studio wedding tracks,
  // load the pristine studio master directly!
  const normTitle = (title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normUrl = url.toLowerCase();

  // Kala Chashma (Amar Arshi / Badshah / Baar Baar Dekho)
  if (normTitle.includes('kala chashma') || (normUrl.includes('kala') && normUrl.includes('chashma')) || videoId === 'k4yXQkG2s1E') {
    return res.status(200).json({
      success: true,
      title: title || 'Kala Chashma (Amar Arshi / Badshah)',
      author: author || 'Zee Music Company',
      thumbnail: thumbnail,
      audioUrl: '/Kala_Chashma_Corrected_Seamless_Full_2m55s_Mix.mp3',
      isCatalogMatch: true,
      songId: 'kala_chashma',
      message: 'Matched Kala Chashma studio master from catalog!'
    });
  }

  // Tauba Tauba (Karan Aujla / Bad Newz)
  if (normTitle.includes('tauba tauba') || (normUrl.includes('tauba') && normUrl.includes('tauba')) || videoId === 'LK7-_dgAVQE') {
    return res.status(200).json({
      success: true,
      title: title || 'Tauba Tauba (Karan Aujla • Movie 1)',
      author: author || 'Saregama Music',
      thumbnail: thumbnail,
      audioUrl: '/tauba_tauba_movie1.m4a',
      isCatalogMatch: true,
      songId: 'tauba_tauba_movie1',
      message: 'Matched Tauba Tauba studio master from catalog!'
    });
  }

  // Kudmayi (Rocky Aur Rani)
  if (normTitle.includes('kudmayi') || normUrl.includes('kudmayi')) {
    return res.status(200).json({
      success: true,
      title: title || 'Kudmayi Mashup (Rocky Aur Rani)',
      author: author,
      thumbnail: thumbnail,
      audioUrl: '/kudmayi_mashup.m4a',
      isCatalogMatch: true,
      songId: 'kudmayi',
      message: 'Matched Kudmayi studio master from catalog!'
    });
  }

  // Tere Hawaale
  if (normTitle.includes('tere hawaale') || normTitle.includes('tere hawale') || normUrl.includes('hawaale')) {
    return res.status(200).json({
      success: true,
      title: title || 'Tere Hawaale (Arijit Singh)',
      author: author,
      thumbnail: thumbnail,
      audioUrl: '/tere_hawaale.m4a',
      isCatalogMatch: true,
      songId: 'tere_hawaale',
      message: 'Matched Tere Hawaale studio master from catalog!'
    });
  }

  // Kanyadaan
  if (normTitle.includes('kanyadaan') || normUrl.includes('kanyadaan')) {
    return res.status(200).json({
      success: true,
      title: title || 'Kanyadaan Song (Studio Master)',
      author: author,
      thumbnail: thumbnail,
      audioUrl: '/kanyadaan_song.m4a',
      isCatalogMatch: true,
      songId: 'kanyadaan',
      message: 'Matched Kanyadaan studio master from catalog!'
    });
  }

  // 3. If an external audio worker (e.g. self-hosted extractor) is configured:
  const workerUrl = process.env.AUDIO_WORKER_URL;
  if (workerUrl && videoId) {
    try {
      const response = await fetch(`${workerUrl}/api/audio?id=${videoId}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data = await response.json();
        return res.status(200).json({
          success: true,
          title: data.title || title || `Track ${deck}`,
          audioUrl: data.audioUrl,
          thumbnail: thumbnail
        });
      }
    } catch (err) {
      console.warn("External worker fetch failed:", err.message);
    }
  }

  // 4. Return helpful metadata and 1-click fallback guidance
  // YouTube blocks direct serverless cloud downloads; provide title and friendly options
  const displayTitle = title || (videoId ? `YouTube Track (${videoId})` : 'YouTube Audio Track');
  return res.status(200).json({
    success: false,
    cloudRestricted: true,
    fallbackNeeded: true,
    videoId: videoId,
    title: displayTitle,
    author: author || 'YouTube Creator',
    thumbnail: thumbnail,
    message: 'YouTube prevents cloud servers from downloading audio directly. You can upload a screen-recording/video directly or use our 1-click downloader.'
  });
};
