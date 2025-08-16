/**
 * Usage:
 * 1) Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and OAUTH_REDIRECT_URI in .env
 * 2) Run: node oauth_helper.js
 * 3) Open printed URL, authorize, copy code, and paste in terminal when prompted.
 * 4) Save the printed refresh_token into backend .env as YOUTUBE_REFRESH_TOKEN
 */

require('dotenv').config();
const readline = require('readline');
const { google } = require('googleapis');

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.OAUTH_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env');
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
// scopes needed for YouTube Live control
const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl'
];

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

console.log('Open this URL in your browser to authorize the application:\n', authUrl);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste authorization code here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    console.log('Received tokens:', tokens);
    console.log('\nSave this refresh token into your backend .env as YOUTUBE_REFRESH_TOKEN:\n');
    console.log(tokens.refresh_token);
    process.exit(0);
  } catch (err) {
    console.error('Error getting tokens', err);
    process.exit(1);
  }
});
