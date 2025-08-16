import { useState } from 'react';

export default function Home() {
  const [links, setLinks] = useState('');
  const [message, setMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const startStream = async () => {
    if (!links.trim()) {
      setMessage('Please enter at least one video URL.');
      return;
    }

    setIsStreaming(true);
    setMessage('Starting stream...');

    try {
      const res = await fetch(`/api/stream?links=${encodeURIComponent(links)}`);
      const data = await res.json();
      setMessage(data.message || data.error);
    } catch (err) {
      setMessage('Error: ' + err.message);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>YouTube Live Stream</h1>
      <p>Enter video URLs (comma-separated):</p>
      <input
        type="text"
        value={links}
        onChange={(e) => setLinks(e.target.value)}
        placeholder="https://example.com/video1.mp4,https://example.com/video2.mp4"
        style={{ width: '100%', padding: '10px', marginBottom: '10px', fontSize: '16px' }}
        disabled={isStreaming}
      />
      <button
        onClick={startStream}
        disabled={isStreaming}
        style={{
          padding: '10px 20px',
          backgroundColor: isStreaming ? '#ccc' : '#0070f3',
          color: '#fff',
          border: 'none',
          borderRadius: '5px',
          cursor: isStreaming ? 'not-allowed' : 'pointer',
        }}
      >
        {isStreaming ? 'Streaming...' : 'Start Stream'}
      </button>
      {message && <p style={{ marginTop: '10px', color: message.includes('Error') ? 'red' : 'green' }}>{message}</p>}
    </div>
  );
}
