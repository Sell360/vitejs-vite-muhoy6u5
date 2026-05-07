// Admin stats endpoint — visit https://betz360.com/api/admin-stats?key=YOUR_KEY
// Returns signup counts + subscription metrics. Service-role only.
//
// Pass your service-role key as a query param so randoms can't hit this.
const https = require('https');

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.supabase_url || process.env.vite_supabase_url;
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabase_service_role_key;

function fetchJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (!SUPA_URL || !SUPA_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  // Light auth: visitor must pass service-role key as ?key= param
  const key = event.queryStringParameters?.key;
  if (!key || key !== SUPA_SERVICE_KEY) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const auth = { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` };

  // Profile counts (signups + subscribers)
  const profilesRes = await fetchJSON(
    `${SUPA_URL}/rest/v1/profiles?select=id,is_pro,pro_grandfathered,subscription_status,created_at`,
    auth,
  );
  const profiles = Array.isArray(profilesRes.data) ? profilesRes.data : [];

  // Mock bet counts
  const betsRes = await fetchJSON(
    `${SUPA_URL}/rest/v1/mock_bets?select=id,status,bet_type,created_at`,
    auth,
  );
  const bets = Array.isArray(betsRes.data) ? betsRes.data : [];

  // Time bucketing
  const now = Date.now();
  const sinceDate = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const last24h = sinceDate(1);
  const last7d = sinceDate(7);

  const totalSignups = profiles.length;
  const grandfathered = profiles.filter(p => p.pro_grandfathered).length;
  const paidSubscribers = profiles.filter(p => p.is_pro && !p.pro_grandfathered).length;
  const trialing = profiles.filter(p => p.subscription_status === 'trialing').length;
  const activeSubscribers = profiles.filter(p => p.subscription_status === 'active').length;
  const canceled = profiles.filter(p => p.subscription_status === 'canceled').length;
  const signupsLast24h = profiles.filter(p => p.created_at && p.created_at >= last24h).length;
  const signupsLast7d  = profiles.filter(p => p.created_at && p.created_at >= last7d).length;

  const totalBets = bets.length;
  const pendingBets = bets.filter(b => b.status === 'pending').length;
  const settledBets = bets.filter(b => b.status !== 'pending').length;
  const wonBets = bets.filter(b => b.status === 'won').length;
  const betsLast24h = bets.filter(b => b.created_at && b.created_at >= last24h).length;
  const parlayBets = bets.filter(b => b.bet_type === 'PARLAY').length;

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      ts: new Date().toISOString(),
      signups: {
        total: totalSignups,
        last24h: signupsLast24h,
        last7d: signupsLast7d,
        grandfathered,
      },
      subscriptions: {
        paidSubscribers,
        trialing,
        active: activeSubscribers,
        canceled,
      },
      bets: {
        total: totalBets,
        last24h: betsLast24h,
        pending: pendingBets,
        settled: settledBets,
        won: wonBets,
        parlays: parlayBets,
        winRatePct: settledBets > 0 ? Math.round((wonBets / settledBets) * 100) : null,
      },
    }, null, 2),
  };
};
