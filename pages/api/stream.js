require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');

ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

const RTMP_URL = process.env.YOUTUBE_RTMP_URL;

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
      console.warn(`Skipping inaccessible URL: ${link}`);
    }
  }

  if (!validLinks.length) {
    return res.status(400).json({ error: 'No valid or accessible video URLs provided' });
  }

  const tempDir = path.join(process.cwd(), 'temp');
  await fs.ensureDir(tempDir);

  try {
    let currentIndex = 0;

    const streamNextVideo = async () => {
      if (currentIndex >= validLinks.length) {
        console.log('All videos streamed.');
        await fs.remove(tempDir);
        return res.status(200).json({ message: 'Streaming completed.' });
      }

      const currentVideo = validLinks[currentIndex];
      const tempFilePath = path.join(tempDir, `video_${currentIndex}.mp4`);

      try {
        // Download video to local file to avoid HTTPS input issues
        console.log(`Downloading ${currentVideo} to ${tempFilePath}`);
        await downloadVideo(currentVideo, tempFilePath);

        const command = ffmpeg()
          .input(tempFilePath)
          .inputOptions([
            '-re', // Read input at native frame rate
            '-analyzeduration 20000000', // Increase analysis time
            '-probesize 20000000', // Increase probe size
          ])
          .outputOptions([
            '-c:v libx264', // Re-encode to H.264
            '-preset ultrafast', // Use ultrafast preset to reduce memory usage
            '-crf 28', // Lower quality to reduce resource usage
            '-c:a aac', // Encode audio to AAC
            '-b:a 128k', // Audio bitrate
            '-f flv', // Output format for RTMP
            '-flvflags no_duration_filesize', // Improve RTMP compatibility
            '-max_muxing_queue_size 2048', // Increase queue size
            '-err_detect ignore_err', // Ignore non-critical errors
            '-avioflags direct', // Reduce buffering
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
            res.status(500).json({ error: `Failed to stream ${currentVideo}: ${err.message}` });
          })
          .run();
      } catch (err) {
        console.error(`Error processing ${currentVideo}: ${err.message}`);
        await fs.remove(tempFilePath);
        currentIndex++;
        streamNextVideo(); // Continue with next video
      }
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
