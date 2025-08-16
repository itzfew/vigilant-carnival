require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');

ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

let RTMP_URL = process.env.YOUTUBE_RTMP_URL || '';

// Trim accidental prefix from env var
if (RTMP_URL.startsWith('YOUTUBE_RTMP_URL=')) {
  RTMP_URL = RTMP_URL.replace(/^YOUTUBE_RTMP_URL=/, '');
}

async function isUrlAccessible(url) {
  try {
    const response = await axios.head(url, { timeout: 10000 });
    return response.status >= 200 && response.status < 300;
  } catch (err) {
    console.warn(`URL accessibility check failed for ${url}: ${err.message}`);
    return false;
  }
}

async function downloadVideo(url, outputPath) {
  try {
    const response = await axios.get(url, { responseType: 'stream', timeout: 30000 });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (err) {
    throw new Error(`Failed to download ${url}: ${err.message}`);
  }
}

export default async function handler(req, res) {
  if (!RTMP_URL.startsWith('rtmp://')) {
    return res.status(500).json({ error: 'Invalid or missing YOUTUBE_RTMP_URL (must start with rtmp://)' });
  }

  const { links } = req.query;
  const videoLinks = links ? links.split(',').map(link => link.trim()).filter(link => link) : [];

  if (!videoLinks.length) {
    return res.status(400).json({ error: 'No video links provided' });
  }

  const validLinks = [];
  for (const link of videoLinks) {
    if (await isUrlAccessible(link)) {
      validLinks.push(link);
    } else {
      console.warn(`Skipping inaccessible URL: ${link}`);
    }
  }

  if (!validLinks.length) {
    return res.status(400).json({ error: 'No valid or accessible video URLs provided' });
  }

  const tempDir = path.join(process.cwd(), 'temp');
  await fs.ensureDir(tempDir);

  // Cleanup on process exit
  process.on('exit', async () => {
    await fs.remove(tempDir);
  });
  process.on('SIGTERM', async () => {
    await fs.remove(tempDir);
    process.exit(0);
  });

  try {
    let currentIndex = 0;

    const streamNextVideo = async () => {
      if (currentIndex >= validLinks.length) {
        console.log('All videos streamed successfully.');
        await fs.remove(tempDir);
        return;
      }

      const currentVideo = validLinks[currentIndex];
      const tempFilePath = path.join(tempDir, `video_${currentIndex}.mp4`);

      try {
        console.log(`Downloading ${currentVideo} to ${tempFilePath}`);
        await downloadVideo(currentVideo, tempFilePath);

        const command = ffmpeg()
          .input(tempFilePath)
          .inputOptions([
            '-re', // Native frame rate
            '-analyzeduration 20000000',
            '-probesize 20000000',
          ])
          .outputOptions([
            '-c:v libx264',
            '-preset ultrafast',
            '-crf 30', // Higher CRF to reduce memory usage
            '-maxrate 1000k', // Limit video bitrate
            '-bufsize 2000k', // Smaller buffer for low memory
            '-vf scale=640:360', // Downscale to reduce CPU load
            '-c:a aac', // Explicitly re-encode audio to AAC
            '-b:a 96k', // Lower audio bitrate
            '-ar 44100', // Standard sample rate for compatibility
            '-f flv',
            '-flvflags no_duration_filesize',
            '-max_muxing_queue_size 4096',
            '-err_detect ignore_err',
            '-avioflags direct',
            '-threads 1', // Single-threaded to reduce CPU load
          ])
          .output(RTMP_URL);

        command
          .on('start', (commandLine) => {
            console.log(`FFmpeg started streaming: ${currentVideo}`);
            console.log(`FFmpeg command: ${commandLine}`);
          })
          .on('progress', (progress) => {
            console.log(`Progress for ${currentVideo}: ${progress.timemark}`);
          })
          .on('end', async () => {
            console.log(`Finished streaming: ${currentVideo}`);
            await fs.remove(tempFilePath);
            currentIndex++;
            streamNextVideo();
          })
          .on('error', async (err, stdout, stderr) => {
            console.error(`Error streaming ${currentVideo}: ${err.message}`);
            console.error(`FFmpeg stdout: ${stdout}`);
            console.error(`FFmpeg stderr: ${stderr}`);
            await fs.remove(tempFilePath);
            currentIndex++;
            streamNextVideo();
          })
          .run();
      } catch (err) {
        console.error(`Error processing ${currentVideo}: ${err.message}`);
        await fs.remove(tempFilePath);
        currentIndex++;
        streamNextVideo();
      }
    };

    streamNextVideo();
    res.status(200).json({ message: 'Streaming started. Check YouTube Studio and Render logs for progress.' });
  } catch (err) {
    await fs.remove(tempDir);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
