/**
 * Wedding Remix Studio - Backend Server
 * Zero external dependencies. Uses Node.js standard libraries: http, fs, path, url, child_process.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec, spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, 'audio_cache');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4'
};

// Check if yt-dlp is available on system or local virtualenv
function checkYtDlpAvailable() {
  const venvYt = path.join(__dirname, '.venv', 'bin', 'yt-dlp');
  if (fs.existsSync(venvYt)) return Promise.resolve(venvYt);
  return new Promise((resolve) => {
    exec('which yt-dlp', (err, stdout) => {
      resolve(!err && stdout.trim().length > 0 ? stdout.trim() : false);
    });
  });
}

// Check if ffmpeg is available on system
function checkFfmpegAvailable() {
  return new Promise((resolve) => {
    exec('which ffmpeg', (err, stdout) => {
      resolve(!err && stdout.trim().length > 0 ? stdout.trim() : false);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API Routes ---

  // 1. Status Check
  if (pathname === '/api/status' && req.method === 'GET') {
    const ytBinary = await checkYtDlpAvailable();
    const hasFfmpeg = await checkFfmpegAvailable();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      nodeVersion: process.version,
      tools: {
        ytDlp: !!ytBinary,
        ffmpeg: hasFfmpeg
      },
      message: ytBinary 
        ? "YouTube audio fetch engine ready." 
        : "Direct URL fetch requires yt-dlp. File upload and audio synthesis are ready."
    }));
    return;
  }

  // 2. Fetch Audio from YouTube / Spotify
  if (pathname === '/api/fetch-audio' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const targetUrl = payload.url;
        const deck = payload.deck || 'A';

        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'URL is required' }));
          return;
        }

        const ytBinary = await checkYtDlpAvailable();
        if (!ytBinary) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            fallbackNeeded: true,
            reason: 'yt-dlp_not_installed',
            title: `Track from ${targetUrl.slice(0, 30)}...`,
            message: "yt-dlp is not installed on this machine. To enable URL downloads, run: brew install yt-dlp. In the meantime, use drag-and-drop or the built-in demo tracks."
          }));
          return;
        }

        // Invoke yt-dlp to download highest quality audio stream without needing external ffmpeg
        const fileId = `track_${deck}_${Date.now()}`;
        const outputTemplate = path.join(CACHE_DIR, `${fileId}.%(ext)s`);

        exec(`"${ytBinary}" -f "bestaudio[ext=m4a]/bestaudio" -o "${outputTemplate}" "${targetUrl}"`, (err, stdout, stderr) => {
          if (err) {
            console.error('yt-dlp error:', stderr);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Failed to download audio from URL: ' + err.message
            }));
            return;
          }

          // Locate generated file (.m4a, .webm, or .mp3)
          const possibleExts = ['.m4a', '.webm', '.opus', '.mp3'];
          let foundFile = null;
          for (const ext of possibleExts) {
            const p = path.join(CACHE_DIR, `${fileId}${ext}`);
            if (fs.existsSync(p)) {
              foundFile = p;
              break;
            }
          }

          if (foundFile) {
            const ext = path.extname(foundFile);
            const cleanM4a = path.join(CACHE_DIR, `${fileId}_clean.m4a`);

            // If it's an m4a, run afconvert to ensure standard container
            if (ext === '.m4a') {
              exec(`/usr/bin/afconvert -f mp4f -d aac "${foundFile}" "${cleanM4a}"`, (cErr) => {
                const finalFile = (!cErr && fs.existsSync(cleanM4a)) ? cleanM4a : foundFile;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  success: true,
                  title: `Downloaded Track (${deck})`,
                  audioUrl: `/cache/${path.basename(finalFile)}`
                }));
              });
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                title: `Downloaded Track (${deck})`,
                audioUrl: `/cache/${path.basename(foundFile)}`
              }));
            }
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Downloaded file not found in cache' }));
          }
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON request' }));
      }
    });
    return;
  }

  // 3. Extract Audio from Uploaded Video File (.mov, .mp4) using macOS avconvert
  if (pathname === '/api/extract-video-audio' && req.method === 'POST') {
    const origName = decodeURIComponent(req.headers['x-file-name'] || 'video.mov');
    const ext = path.extname(origName) || '.mov';
    const timestamp = Date.now();
    const tempVideoPath = path.join(CACHE_DIR, `upload_${timestamp}${ext}`);
    const outputM4aPath = path.join(CACHE_DIR, `extracted_${timestamp}.m4a`);

    const writeStream = fs.createWriteStream(tempVideoPath);
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      // Use macOS built-in /usr/bin/avconvert
      exec(`/usr/bin/avconvert -s "${tempVideoPath}" -p PresetAppleM4A -o "${outputM4aPath}" --replace`, (err, stdout, stderr) => {
        // Clean up temporary video file
        try { fs.unlinkSync(tempVideoPath); } catch (e) {}

        if (err) {
          console.error('avconvert error:', stderr || err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Failed to extract audio from video: ' + (stderr || err.message)
          }));
          return;
        }

        if (fs.existsSync(outputM4aPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            audioUrl: `/cache/extracted_${timestamp}.m4a`,
            message: 'Audio extracted successfully via macOS avconvert'
          }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Extracted audio file not found' }));
        }
      });
    });

    writeStream.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Failed to write video file: ' + err.message }));
    });
    return;
  }

  // 4. Convert Rendered WAV to iPhone M4A (Apple AAC 256kbps) using macOS afconvert
  if (pathname === '/api/convert-to-m4a' && req.method === 'POST') {
    const timestamp = Date.now();
    const tempWavPath = path.join(CACHE_DIR, `render_${timestamp}.wav`);
    const outputM4aPath = path.join(CACHE_DIR, `render_${timestamp}.m4a`);

    const writeStream = fs.createWriteStream(tempWavPath);
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      // Use macOS built-in /usr/bin/afconvert for studio-grade CoreAudio AAC
      exec(`/usr/bin/afconvert -f m4af -d aac -b 256000 "${tempWavPath}" "${outputM4aPath}"`, (err, stdout, stderr) => {
        // Clean up temporary wav file
        try { fs.unlinkSync(tempWavPath); } catch (e) {}

        if (err) {
          console.error('afconvert error:', stderr || err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Failed to convert to M4A: ' + (stderr || err.message)
          }));
          return;
        }

        if (fs.existsSync(outputM4aPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            format: 'm4a',
            audioUrl: `/cache/render_${timestamp}.m4a`,
            message: 'Audio converted to iPhone M4A (Apple AAC 256kbps) successfully'
          }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Converted M4A file not found' }));
        }
      });
    });

    writeStream.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Failed to write wav stream: ' + err.message }));
    });
    return;
  }

  // --- Serve Audio Cache ---
  if (pathname.startsWith('/cache/')) {
    const filename = path.basename(pathname);
    const filePath = path.join(CACHE_DIR, filename);

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(filePath).pipe(res);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Cached audio not found');
      return;
    }
  }

  // --- Serve Static Frontend Files ---
  let safePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  safePath = path.normalize(safePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🎵 Wedding Remix Studio is running!`);
  console.log(`👉 Open http://localhost:${PORT} in your browser`);
  console.log(`==================================================\n`);
});
