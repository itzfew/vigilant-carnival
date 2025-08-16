require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');

ffmpeg.setFmpegPath(require('@ffmpeg-installer/ffmpeg').path);

const RTMP_URL = process.env.YOUTUBE_RTMP_URL;

async function createConcatFile(links, concatFilePath) {
  const content = links.map(link => `file '${link}'`).join('\n');
  await fs.writeFile(concatFilePath, content);
}

export default async function handler(req, res) {
  if (!RTMP_URL) {
    return res.status(500).json({ error: 'YOUTUBE_RTMP_URL not set in .env' });
  }

  const { links } = req.query; // e.g., ?links=url1,url2
  const videoLinks = links ? links.split(',') : [];

  if (!videoLinks.length) {
    return res.status(400).json({ error: 'No video links provided' });
  }

  const concatFilePath = path.join(process.cwd(), 'concat.txt');

  try {
    await createConcatFile(videoLinks, concatFilePath);

    ffmpeg()
      .input(concatFilePath)
      .inputOptions(['-f concat', '-safe 0', '-re'])
      .outputOptions(['-c:v copy', '-c:a aac', '-f flv'])
      .output(RTMP_URL)
      .on('start', () => {
        console.log('FFmpeg started streaming...');
      })
      .on('progress', (progress) => {
        console.log(`Progress: ${progress.percent}%`);
      })
      .on('end', async () => {
        await fs.remove(concatFilePath);
        console.log('Streaming completed.');
      })
      .on('error', async (err) => {
        await fs.remove(concatFilePath);
        console.error('Error:', err.message);
        res.status(500).json({ error: err.message });
      })
      .run();

    res.status(200).json({ message: 'Streaming started. Check YouTube dashboard.' });
  } catch (err) {
    await fs.remove(concatFilePath);
    res.status(500).json({ error: err.message });
  }
}
