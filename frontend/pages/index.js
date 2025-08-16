import { useState } from "react";

export default function Home() {
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [backendUrl, setBackendUrl] = useState(process.env.NEXT_PUBLIC_BACKEND_URL || "https://your-backend.example.com");
  const [status, setStatus] = useState("");

  async function startStream(e) {
    e.preventDefault();
    setStatus("Requesting stream...");
    try {
      const res = await fetch(`${backendUrl}/start-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, title })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || "Failed");
      setStatus(`Started: broadcastId=${j.broadcast.id}. YouTube: ${j.broadcast.snippet.title}`);
    } catch (err) {
      setStatus("Error: " + err.message);
    }
  }

  async function stopStream() {
    setStatus("Stopping...");
    try {
      const res = await fetch(`${backendUrl}/stop-all`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || "Failed");
      setStatus(`Stopped ${j.stopped || 0} ffmpeg processes.`);
    } catch (err) {
      setStatus("Error: " + err.message);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>YouTube Live automator (Vercel frontend)</h1>
      <p>Paste a video URL (MP4, HLS, etc.) and hit Start — the backend will create a YouTube live and push the stream via FFmpeg.</p>

      <form onSubmit={startStream} style={{ marginBottom: 16 }}>
        <div>
          <label>Video URL</label><br />
          <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} style={{ width: "100%" }} placeholder="https://example.com/video.mp4" />
        </div>
        <div style={{ marginTop: 8 }}>
          <label>Stream title</label><br />
          <input value={title} onChange={e => setTitle(e.target.value)} style={{ width: "100%" }} placeholder="My Live Stream" />
        </div>
        <div style={{ marginTop: 8 }}>
          <label>Backend URL</label><br />
          <input value={backendUrl} onChange={e => setBackendUrl(e.target.value)} style={{ width: "100%" }} />
        </div>

        <div style={{ marginTop: 12 }}>
          <button type="submit">Start Stream</button>
          <button type="button" onClick={stopStream} style={{ marginLeft: 8 }}>Stop All</button>
        </div>
      </form>

      <div>
        <strong>Status:</strong>
        <pre>{status}</pre>
      </div>
    </main>
  );
}
