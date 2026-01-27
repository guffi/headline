const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const HEADLINES_FILE = path.join(__dirname, 'headlines.json');

app.use(express.json());
app.use(express.static('public'));

// Load data from file
function loadData() {
  try {
    if (fs.existsSync(HEADLINES_FILE)) {
      const raw = JSON.parse(fs.readFileSync(HEADLINES_FILE, 'utf8'));

      // Migrate from old format (plain strings) to new format (objects with timestamp)
      if (!raw.headlines) {
        const migrated = { headlines: {}, history: [] };
        const now = Date.now();
        for (const [country, value] of Object.entries(raw)) {
          if (typeof value === 'string') {
            migrated.headlines[country] = { headline: value, timestamp: now };
            migrated.history.push({ country, headline: value, timestamp: now });
          }
        }
        return migrated;
      }

      return raw;
    }
  } catch (err) {
    console.error('Error loading data:', err);
  }
  return { headlines: {}, history: [] };
}

// Save data to file
function saveData(data) {
  fs.writeFileSync(HEADLINES_FILE, JSON.stringify(data, null, 2));
}

// Get visitor's country from their IP
app.get('/api/location', async (req, res) => {
  try {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip === '::1' || ip === '127.0.0.1') ip = '';

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
app.get('/api/headline/:country', (req, res) => {
  const country = req.params.country;
  const data = loadData();
  const entry = data.headlines[country] || null;
  res.json({
    country,
    headline: entry ? entry.headline : null,
    timestamp: entry ? entry.timestamp : null
  });
});

// Set headline for a country
app.post('/api/headline/:country', (req, res) => {
  const country = req.params.country;
  const { headline } = req.body;

  if (!headline || typeof headline !== 'string') {
    return res.status(400).json({ error: 'Headline is required' });
  }

  const data = loadData();
  const timestamp = Date.now();
  const trimmedHeadline = headline.trim().substring(0, 500);

  data.headlines[country] = {
    headline: trimmedHeadline,
    timestamp
  };

  // Add to history (keep last 50 for storage, we'll send last 10)
  data.history.unshift({
    country,
    headline: trimmedHeadline,
    timestamp
  });
  data.history = data.history.slice(0, 50);

  saveData(data);

  res.json({ country, headline: trimmedHeadline, timestamp });
});

// Get recent headlines for a country
app.get('/api/recent/:country', (req, res) => {
  const country = req.params.country;
  const data = loadData();
  const countryHistory = data.history
    .filter(item => item.country === country)
    .slice(0, 10);
  res.json({ recent: countryHistory });
});

// For local development
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Headline app running at http://localhost:${PORT}`);
  });
}

// For Vercel
module.exports = app;
