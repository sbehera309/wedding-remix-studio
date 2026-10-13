module.exports = (req, res) => {
  res.status(200).json({
    status: 'online',
    platform: 'vercel',
    timestamp: new Date().toISOString(),
    features: {
      clientSideAudioProcessing: true,
      webAudioSynthesis: true,
      offlineMasterRendering: true,
      localFileAudioExtraction: true
    }
  });
};
