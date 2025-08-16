require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs-extra');

// Set FFmpeg path from installer
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

const RTMP_URL = process.env.YOUTUBE_RTMP_URL;
if (!RTMP_URL) {
  console.error('Error: YOUTUBE_RTMP_URL not set in .env');
  process.exit(1);
}

// Example list of video links (replace with your own public MP4 URLs)
const videoLinks = [
  'https://example.com/video1.mp4',
  'https://example.com/video2.mp4',
  // Add more...
];

// Create a temporary concat list file
const concatFilePath = path.join(__dirname, 'concat.txt');
async function createConcatFile(links) {
  const content = links.map(link => `file '${link}'`).join('\n');
  await fs.writeFile(concatFilePath, content);
}

// Main streaming function
async function startStream() {
  if (videoLinks.length === 0) {
    console.error('No video links provided.');
    return;
  }

  await createConcatFile(videoLinks);

  const command = ffmpeg()
    .input(concatFilePath)
    .inputOptions(['-f concat', '-safe 0', '-re'])  // Concat, unsafe URLs, real-time read
    .outputOptions([
      '-c:v copy',       // Copy video codec (assume compatible; change to libx264 if needed)
      '-c:a aac',        // AAC audio (required for YouTube)
      '-f flv'           // FLV container for RTMP
    ])
    .output(RTMP_URL)
    .on('start', (cmd) => {
      console.log('FFmpeg started:', cmd);
      console.log('Streaming to YouTube... Monitor your live dashboard.');
    })
    .on('progress', (progress) => {
      console.log(`Progress: ${progress.percent}% done`);
    })
    .on('end', async () => {
      console.log('Streaming completed.');
      await fs.remove(concatFilePath);  // Cleanup
      // Optional: Loop for 24/7 - uncomment below
      // startStream();
    })
    .on('error', async (err) => {
      console.error('Error:', err.message);
      await fs.remove(concatFilePath);
    });

  command.run();
}

// Run the stream
startStream();
