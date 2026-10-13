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

  // 1. If an external audio worker (e.g. Railway, Render, or Cobalt instance) is configured:
  const workerUrl = process.env.AUDIO_WORKER_URL; // e.g. https://my-yt-worker.railway.app
  if (workerUrl && videoId) {
    try {
      const response = await fetch(`${workerUrl}/api/audio?id=${videoId}`);
      if (response.ok) {
        const data = await response.json();
        return res.status(200).json({
          success: true,
          title: data.title || `Track ${deck}`,
          audioUrl: data.audioUrl
        });
      }
    } catch (err) {
      console.error("Worker fetch failed:", err);
    }
  }

  // 2. Return fallback metadata explaining serverless behavior
  return res.status(200).json({
    success: false,
    fallbackNeeded: true,
    videoId: videoId,
    title: videoId ? `YouTube Video (${videoId})` : 'Audio Stream',
    message: 'To download YouTube audio directly in cloud deployment without local tools, connect a free Railway worker or drag-and-drop the audio file directly.'
  });
};
