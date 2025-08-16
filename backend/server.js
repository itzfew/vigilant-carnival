require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const youtube = require('./youtube');
const { spawn } = require('child_process');
const uuid = require('uuid');

const app = express();
app.use(bodyParser.json());

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const PORT = process.env.PORT || 8080;

// in-memory map of running ffmpeg processes
const processes = new Map();

app.get('/', (req, res) => res.send('YouTube Live Worker Running'));

/**
 * POST /start-stream
 * body: { videoUrl: string, title?: string }
 * returns: created broadcast + stream info
 */
app.post('/start-stream', async (req, res) => {
  const { videoUrl, title } = req.body;
  if (!videoUrl) return res.status(400).json({ message: 'videoUrl required' });

  try {
    // 1) create stream object & broadcast on YouTube
    const broadcast = await youtube.createLiveBroadcast(title || `Auto stream ${new Date().toISOString()}`);
    // broadcast contains streamKey & rtmpEndpoint inside bound stream data
    const streamId = broadcast.stream.id;
    const rtmpUrl = broadcast.stream.rtmpUrl; // we'll return this for inspection
    const streamKey = broadcast.stream.streamKey;

    // 2) Build ffmpeg args: read from videoUrl and push to rtmp
    // -re to read at native rate (simulate live). Copy codecs if possible to avoid re-encode; fallback to re-encode if needed.
    const output = `${rtmpUrl}/${streamKey}`;
    const args = [
      '-re',
      '-i', videoUrl,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'flv',
      output
    ];

    const id = uuid.v4();
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // capture logs
    proc.stdout.on('data', d => console.log(`[ffmpeg ${id} stdout]`, d.toString()));
    proc.stderr.on('data', d => console.log(`[ffmpeg ${id} stderr]`, d.toString()));

    proc.on('exit', (code, sig) => {
      console.log(`ffmpeg ${id} exited`, code, sig);
      processes.delete(id);
    });

    // optional time limit
    const maxMs = parseInt(process.env.FFMPEG_MAX_RUNTIME_MS || '0', 10);
    let timeout;
    if (maxMs > 0) {
      timeout = setTimeout(() => {
        console.log(`Killing ffmpeg ${id} due to timeout`);
        proc.kill('SIGINT');
      }, maxMs);
    }

    processes.set(id, { proc, broadcastId: broadcast.broadcast.id, startedAt: Date.now(), videoUrl });

    res.json({ id, broadcast, message: 'started' });
  } catch (err) {
    console.error('start-stream error', err);
    res.status(500).json({ message: err.message || 'error' });
  }
});

/**
 * POST /stop-all
 * stops all running ffmpeg processes
 */
app.post('/stop-all', (req, res) => {
  let stopped = 0;
  for (const [id, entry] of processes.entries()) {
    try {
      entry.proc.kill('SIGINT');
      processes.delete(id);
      stopped++;
    } catch (e) {
      console.error('stop error', e);
    }
  }
  res.json({ stopped });
});

/**
 * GET /status
 * returns list of running processes
 */
app.get('/status', (req, res) => {
  const list = [];
  for (const [id, entry] of processes.entries()) {
    list.push({ id, broadcastId: entry.broadcastId, startedAt: entry.startedAt, videoUrl: entry.videoUrl });
  }
  res.json({ running: list });
});

app.listen(PORT, () => console.log(`YT worker listening on ${PORT}`));
