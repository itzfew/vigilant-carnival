require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');

ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

const RTMP_URL = process.env.YOUTUBE_RTMP_URL;

async function downloadVideo(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${url}`);
  const dest = fs.createWriteStream(outputPath);
  await new Promise((resolve, reject) => {
    res.body.pipe(dest);
    res.body.on("error", reject);
    dest.on("finish", resolve);
  });
}

async function createConcatFile(localFiles, concatFilePath) {
  const content = localFiles.map(f => `file '${f}'`).join('\n');
  await fs.writeFile(concatFilePath, content);
}

export default async function handler(req, res) {
  if (!RTMP_URL) {
    return res.status(500).json({ error: 'YOUTUBE_RTMP_URL not set in environment' });
  }

  const { links } = req.query; // ?links=url1,url2
  const videoLinks = links ? links.split(',') : [];

  if (!videoLinks.length) {
    return res.status(400).json({ error: 'No video links provided' });
  }

  const tempDir = path.join(process.cwd(), 'temp_videos');
  await fs.ensureDir(tempDir);

  const localFiles = [];
  try {
    // Download each video to temp dir
    for (let i = 0; i < videoLinks.length; i++) {
      const localPath = path.join(tempDir, `video${i}.mp4`);
      await downloadVideo(videoLinks[i], localPath);
      localFiles.push(localPath);
    }

    // Create concat.txt
    const concatFilePath = path.join(tempDir, 'concat.txt');
    await createConcatFile(localFiles, concatFilePath);

    // Run FFmpeg
    const command = ffmpeg()
      .input(concatFilePath)
      .inputOptions(['-f concat', '-safe 0', '-re'])
      .outputOptions(['-c:v copy', '-c:a aac', '-f flv'])
      .output(RTMP_URL);

    command
      .on('start', () => {
        console.log('FFmpeg started streaming...');
      })
      .on('progress', (progress) => {
        console.log(`Progress: ${progress.timemark}`);
      })
      .on('end', async () => {
        await fs.remove(tempDir);
        console.log('Streaming completed.');
      })
      .on('error', async (err) => {
        await fs.remove(tempDir);
        console.error('Error:', err.message);
      })
      .run();

    res.status(200).json({ message: 'Streaming started. Check YouTube dashboard.' });
  } catch (err) {
    await fs.remove(tempDir);
    res.status(500).json({ error: err.message });
  }
}
