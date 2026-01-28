const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Redis helper functions
async function redis(command, ...args) {
  const response = await fetch(`${UPSTASH_URL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
  });
  const data = await response.json();
  return data.result;
}

// Get visitor's country from their IP
app.get('/api/location', async (req, res) => {
  try {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (!ip || ip === '::1' || ip === '127.0.0.1') ip = '';

    const response = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await response.json();

    if (data.status === 'success') {
      res.json({ country: data.country });
    } else {
      res.json({ country: 'Unknown' });
    }
  } catch (err) {
    console.error('Geolocation error:', err);
    res.json({ country: 'Unknown' });
  }
});

// Get headline for a country
app.get('/api/headline/:country', async (req, res) => {
  try {
    const country = req.params.country;
    const data = await redis('HGET', 'headlines', country);

    if (data) {
      const parsed = JSON.parse(data);
      res.json({ country, headline: parsed.headline, timestamp: parsed.timestamp });
    } else {
      res.json({ country, headline: null, timestamp: null });
    }
  } catch (err) {
    console.error('Get headline error:', err);
    res.json({ country: req.params.country, headline: null, timestamp: null });
  }
});

// Set headline for a country
app.post('/api/headline/:country', async (req, res) => {
  try {
    const country = req.params.country;
    const { headline } = req.body;

    if (!headline || typeof headline !== 'string') {
      return res.status(400).json({ error: 'Headline is required' });
    }

    const timestamp = Date.now();
    const trimmedHeadline = headline.trim().substring(0, 280);

    const entry = JSON.stringify({ headline: trimmedHeadline, timestamp });

    // Save headline
    await redis('HSET', 'headlines', country, entry);

    // Add to country's history (store all entries)
    const historyKey = `history:${country}`;
    await redis('LPUSH', historyKey, entry);

    res.json({ country, headline: trimmedHeadline, timestamp });
  } catch (err) {
    console.error('Set headline error:', err);
    res.status(500).json({ error: 'Failed to save headline' });
  }
});

// Get recent headlines for a country
app.get('/api/recent/:country', async (req, res) => {
  try {
    const country = req.params.country;
    const historyKey = `history:${country}`;
    const history = await redis('LRANGE', historyKey, 0, 9);

    const recent = (history || []).map(item => {
      const parsed = JSON.parse(item);
      return { country, headline: parsed.headline, timestamp: parsed.timestamp };
    });

    res.json({ recent });
  } catch (err) {
    console.error('Get recent error:', err);
    res.json({ recent: [] });
  }
});

// For local development
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Headline app running at http://localhost:${PORT}`);
  });
}

// For Vercel
module.exports = app;
