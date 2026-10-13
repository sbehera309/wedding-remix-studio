module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Serverless execution environment does not have macOS avconvert.
  // Prompt the client to use native in-browser Web Audio decoding or pre-loaded audio stems.
  return res.status(200).json({
    success: false,
    platform: 'vercel-serverless',
    message: 'Direct video transcoding requires native avconvert (available when running locally with node server.js). On Vercel, audio is decoded directly via browser Web Audio or pre-loaded audio stems.'
  });
};
