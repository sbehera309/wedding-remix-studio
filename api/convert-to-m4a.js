/**
 * Vercel Serverless Function: Audio Converter Fallback
 * Vercel runs in an isolated Linux container without macOS afconvert.
 * Returns informative JSON instructing the client to perform in-browser encoding.
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  res.status(200).json({
    success: false,
    reason: 'serverless_use_client_mp3',
    message: 'Serverless environment: client-side encoder will generate iPhone-compatible MP3/M4A'
  });
};
