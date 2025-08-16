import { useState } from 'react';

export default function Home() {
  const [links, setLinks] = useState('');
  const [message, setMessage] = useState('');

  const startStream = async () => {
    try {
      const res = await fetch(`/api/stream?links=${encodeURIComponent(links)}`);
      const data = await res.json();
      setMessage(data.message || data.error);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>YouTube Live Stream</h1>
      <p>Enter video URLs (comma-separated):</p>
      <input
        type="text"
        value={links}
        onChange={(e) => setLinks(e.target.value)}
        placeholder="https://example.com/video1.mp4,https://example.com/video2.mp4"
        style={{ width: '100%', padding: '10px', marginBottom: '10px' }}
      />
      <button onClick={startStream} style={{ padding: '10px 20px' }}>
        Start Stream
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
