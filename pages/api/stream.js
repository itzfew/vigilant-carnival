require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');

ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

const RTMP_URL = process.env.YOUTUBE_RTMP_URL;

async function isUrlAccessible(url) {
  try {
    const response = await axios.head(url, { timeout: 5000 });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (!RTMP_URL) {
    return res.status(500).json({ error: 'YOUTUBE_RTMP_URL not set in environment' });
  }

  const { links } = req.query; // e.g., ?links=url1,url2
  const videoLinks = links ? links.split(',').map(link => link.trim()).filter(link => link) : [];

  if (!videoLinks.length) {
    return res.status(400).json({ error: 'No video links provided' });
  }

  // Validate URLs
  const validLinks = [];
  for (const link of videoLinks) {
    if (await isUrlAccessible(link)) {
      validLinks.push(link);
    } else {
      console.warn(`Invalid or inaccessible URL: ${link}`);
    }
  }

  if (!validLinks.length) {
    return res.status(400).json({ error: 'No valid video URLs provided' });
  }

  const tempDir = path.join(process.cwd(), 'temp');
  await fs.ensureDir(tempDir);

  try {
    let currentIndex = 0;

    const streamNextVideo = () => {
      if (currentIndex >= validLinks.length) {
        console.log('All videos streamed.');
        return res.status(200).json({ message: 'Streaming completed.' });
      }

      const currentVideo = validLinks[currentIndex];

      const command = ffmpeg()
        .input(currentVideo)
        .inputOptions(['-re']) // Read input at native frame rate
        .outputOptions([
          '-c:v copy', // Copy video stream
          '-c:a aac', // Encode audio to AAC
          '-f flv', // Output format for RTMP
          '-flvflags no_duration_filesize', // Improve compatibility with RTMP
        ])
        .output(RTMP_URL);

      command
        .on('start', () => {
          console.log(`FFmpeg started streaming: ${currentVideo}`);
        })
        .on('progress', (progress) => {
          console.log(`Progress for ${currentVideo}: ${progress.timemark}`);
        })
        .on('end', async () => {
          console.log(`Finished streaming: ${currentVideo}`);
          currentIndex++;
          streamNextVideo(); // Stream the next video
        })
        .on('error', async (err) => {
          console.error(`Error streaming ${currentVideo}:`, err.message);
          await fs.remove(tempDir);
          res.status(500).json({ error: `Failed to stream ${currentVideo}: ${err.message}` });
        })
        .run();
    };

    // Start streaming the first video
    streamNextVideo();

    // Send initial response to client
    res.status(200).json({ message: 'Streaming started. Check YouTube dashboard.' });
  } catch (err) {
    await fs.remove(tempDir);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
