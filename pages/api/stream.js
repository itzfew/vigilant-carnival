require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const os = require('os');

// Use a newer FFmpeg static binary (download manually or via script)
const FFMPEG_BINARY_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
const FFMPEG_PATH = path.join(os.tmpdir(), 'ffmpeg'); // Store in temp dir

// Download and extract FFmpeg binary if not present (for Render)
async function ensureFFmpegBinary() {
  if (await fs.pathExists(FFMPEG_PATH)) return;
  console.log('Downloading FFmpeg binary...');
  try {
    const response = await axios.get(FFMPEG_BINARY_URL, { responseType: 'stream' });
    const tarPath = path.join(os.tmpdir(), 'ffmpeg.tar.xz');
    const writer = fs.createWriteStream(tarPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    // Note: Requires `tar` to extract on Render (assumes available)
    await new Promise((resolve, reject) => {
      require('child_process').exec(`tar -xJf ${tarPath} -C ${os.tmpdir()} --strip-components=1`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await fs.remove(tarPath);
    console.log('FFmpeg binary installed.');
  } catch (err) {
    console.error(`Failed to install FFmpeg binary: ${err.message}`);
    throw err;
  }
}

// Set FFmpeg path
(async () => {
  await ensureFFmpegBinary();
  ffmpeg.setFfmpegPath(FFMPEG_PATH);
})();

let RTMP_URL = process.env.YOUTUBE_RTMP_URL || '';
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

  // Cleanup on process signals
  ['exit', 'SIGTERM', 'SIGINT'].forEach((signal) => {
    process.on(signal, async () => {
      await fs.remove(tempDir);
      process.exit(0);
    });
  });

  try {
    let currentIndex = 0;

    const streamNextVideo = async () => {
      if (currentIndex >= validLinks.length) {
        console.log('All videos processed.');
        await fs.remove(tempDir);
        return;
      }

      const currentVideo = validLinks[currentIndex];
      const tempFilePath = path.join(tempDir, `video_${currentIndex}.mp4`);
      const reportPath = path.join(tempDir, `ffmpeg-report-${currentIndex}.log`);

      try {
        console.log(`Downloading ${currentVideo} to ${tempFilePath}`);
        await downloadVideo(currentVideo, tempFilePath);

        const command = ffmpeg()
          .input(tempFilePath)
          .inputOptions([
            '-re',
            '-analyzeduration 20000000',
            '-probesize 20000000',
          ])
          .outputOptions([
            '-c:v copy', // Try copying video to avoid re-encoding
            '-c:a aac', // Re-encode audio to AAC (Opus not supported by RTMP)
            '-b:a 64k',
            '-ar 22050',
            '-f flv',
            '-flvflags no_duration_filesize',
            '-max_muxing_queue_size 8192',
            '-err_detect ignore_err',
            '-avioflags direct',
            '-threads 1',
            '-loglevel verbose', // Detailed logging
            `-report`,
          ])
          .output(RTMP_URL)
          .save({ logfile: reportPath });

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
            await fs.remove(reportPath);
            currentIndex++;
            streamNextVideo();
          })
          .on('error', async (err, stdout, stderr) => {
            console.error(`Error streaming ${currentVideo}: ${err.message}`);
            console.error(`FFmpeg stdout: ${stdout}`);
            console.error(`FFmpeg stderr: ${stderr}`);
            if (await fs.pathExists(reportPath)) {
              const report = await fs.readFile(reportPath, 'utf8');
              console.error(`FFmpeg report: ${report}`);
            }
            // Fallback to re-encoding if copy fails
            if (err.message.includes('copy')) {
              console.log(`Retrying ${currentVideo} with re-encoding...`);
              try {
                const retryCommand = ffmpeg()
                  .input(tempFilePath)
                  .inputOptions([
                    '-re',
                    '-analyzeduration 20000000',
                    '-probesize 20000000',
                  ])
                  .outputOptions([
                    '-c:v libx264',
                    '-preset ultrafast',
                    '-crf 34',
                    '-maxrate 600k',
                    '-bufsize 1200k',
                    '-vf scale=320:180', // Lowest resolution
                    '-c:a aac',
                    '-b:a 64k',
                    '-ar 22050',
                    '-f flv',
                    '-flvflags no_duration_filesize',
                    '-max_muxing_queue_size 8192',
                    '-err_detect ignore_err',
                    '-avioflags direct',
                    '-threads 1',
                    '-loglevel verbose',
                    `-report`,
                  ])
                  .output(RTMP_URL)
                  .save({ logfile: reportPath });

                retryCommand
                  .on('start', (commandLine) => {
                    console.log(`FFmpeg retry started: ${currentVideo}`);
                    console.log(`FFmpeg command: ${commandLine}`);
                  })
                  .on('end', async () => {
                    console.log(`Finished retry streaming: ${currentVideo}`);
                    await fs.remove(tempFilePath);
                    await fs.remove(reportPath);
                    currentIndex++;
                    streamNextVideo();
                  })
                  .on('error', async (err, stdout, stderr) => {
                    console.error(`Retry error for ${currentVideo}: ${err.message}`);
                    console.error(`FFmpeg stdout: ${stdout}`);
                    console.error(`FFmpeg stderr: ${stderr}`);
                    if (await fs.pathExists(reportPath)) {
                      const report = await fs.readFile(reportPath, 'utf8');
                      console.error(`FFmpeg retry report: ${report}`);
                    }
                    await fs.remove(tempFilePath);
                    await fs.remove(reportPath);
                    currentIndex++;
                    streamNextVideo();
                  })
                  .run();
              } catch (retryErr) {
                console.error(`Retry failed for ${currentVideo}: ${retryErr.message}`);
                await fs.remove(tempFilePath);
                await fs.remove(reportPath);
                currentIndex++;
                streamNextVideo();
              }
            } else {
              await fs.remove(tempFilePath);
              await fs.remove(reportPath);
              currentIndex++;
              streamNextVideo();
            }
          })
          .run();
      } catch (err) {
        console.error(`Error processing ${currentVideo}: ${err.message}`);
        await fs.remove(tempFilePath);
        await fs.remove(reportPath);
        currentIndex++;
        streamNextVideo();
      }
    };

    streamNextVideo();
    res.status(200).json({ message: 'Streaming started. Check YouTube Studio and Render logs (FFmpeg reports) for progress.' });
  } catch (err) {
    await fs.remove(tempDir);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
