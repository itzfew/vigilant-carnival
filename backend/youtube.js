const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

/**
 * Responsible for:
 * - creating a liveStream (youtube.liveStreams.insert)
 * - creating a liveBroadcast (youtube.liveBroadcasts.insert)
 * - binding the broadcast to stream (youtube.liveBroadcasts.bind)
 *
 * You MUST set process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, and OAUTH_REDIRECT_URI
 */

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.OAUTH_REDIRECT_URI || 'http://localhost:8080/oauth2callback';
const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

if (!clientId || !clientSecret || !refreshToken) {
  console.warn('Missing Google OAuth credentials or refresh token — youtube API calls will fail until those are provided');
}

function getOAuthClient() {
  const oAuth2Client = new OAuth2(clientId, clientSecret, redirectUri);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  return oAuth2Client;
}

async function createLiveBroadcast(title = 'Auto Live', description = '') {
  const auth = getOAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  // 1) create liveStream (which returns stream name/key & ingestionAddress)
  const streamRes = await youtube.liveStreams.insert({
    part: 'snippet,cdn',
    requestBody: {
      snippet: {
        title: `Stream for ${title}`,
        description
      },
      cdn: {
        format: '1080p',
        ingestionType: 'rtmp'
      }
    }
  });

  const liveStream = streamRes.data;
  // ingestion info: liveStream.cdn.ingestionInfo
  const ingestion = liveStream.cdn && liveStream.cdn.ingestionInfo;
  const rtmpUrl = ingestion ? ingestion.ingestionAddress : 'rtmp://a.rtmp.youtube.com/live2';
  const streamKey = ingestion ? ingestion.streamName : '';

  // 2) create liveBroadcast
  const startTime = new Date(Date.now() + 5 * 1000).toISOString(); // start 5s from now
  const endTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // +2 hours
  const broadRes = await youtube.liveBroadcasts.insert({
    part: 'snippet,status,contentDetails',
    requestBody: {
      snippet: {
        title,
        description,
        scheduledStartTime: startTime,
        scheduledEndTime: endTime
      },
      status: {
        privacyStatus: 'public'
      }
    }
  });

  const liveBroadcast = broadRes.data;

  // 3) bind broadcast to stream
  await youtube.liveBroadcasts.bind({
    part: 'id,contentDetails',
    id: liveBroadcast.id,
    streamId: liveStream.id
  });

  // return an object summarizing the stream & broadcast
  return {
    broadcast: liveBroadcast,
    stream: {
      id: liveStream.id,
      streamKey,
      rtmpUrl, // base URL
      ingestionInfo: ingestion
    }
  };
}

module.exports = { createLiveBroadcast };
