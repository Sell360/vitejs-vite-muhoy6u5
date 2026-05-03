// Netlify serverless function — proxies DraftKings sportsbook API
// No auth required on DraftKings side, CORS handled here

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { sport, type } = event.queryStringParameters || {};

  // DraftKings sport/league IDs
  // These are the eventgroup IDs for each sport's player props section
  const SPORT_IDS = {
    mlb:  '84240',   // MLB
    wnba: '42648',   // WNBA
  };

  // Player prop category IDs per sport
  const PROP_CATEGORIES = {
    mlb:  '1189',    // Batter/Pitcher Props
    wnba: '1215',    // Player Props
  };

  const sportId = SPORT_IDS[sport];
  const categoryId = PROP_CATEGORIES[sport];

  if (!sportId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: `Unknown sport: ${sport}` }),
    };
  }

  try {
    let url;

    if (type === 'categories') {
      // Step 1: Get all categories to find prop subcategory IDs
      url = `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${sportId}?format=json`;
    } else if (type === 'props') {
      // Step 2: Get actual player props for the category
      url = `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${sportId}/categories/${categoryId}?format=json`;
    } else {
      // Default: get everything in one shot
      url = `https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/${sportId}/categories/${categoryId}?format=json`;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://sportsbook.draftkings.com/',
      },
    });

    if (!response.ok) {
      throw new Error(`DraftKings returned ${response.status}`);
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
