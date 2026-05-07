// Creates a Stripe Customer Portal session so users can manage/cancel
// their subscription themselves. Called from the user's account settings.
const https = require('https');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key;
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.supabase_url || process.env.vite_supabase_url;
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabase_service_role_key;

function stripeRequest(path, body) {
  return new Promise((resolve, reject) => {
    const formData = new URLSearchParams(body).toString();
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(formData); req.end();
  });
}

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
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid json' }) }; }
  const { userId, returnUrl } = body;
  if (!userId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId required' }) };

  const profileRes = await fetchJSON(
    `${SUPA_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_customer_id`,
    { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` }
  );
  const customerId = profileRes.data?.[0]?.stripe_customer_id;
  if (!customerId) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'no stripe customer found for user' }) };
  }

  const { status, data } = await stripeRequest('/v1/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl || 'https://betz360.com',
  });
  if (status !== 200) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: data.error?.message || 'stripe error' }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ url: data.url }) };
};
