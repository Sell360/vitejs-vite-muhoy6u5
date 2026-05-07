// Creates a Stripe Checkout session for a pro subscription.
// Called from the upgrade modal. Returns the checkout URL the browser
// redirects to; Stripe collects payment, then redirects back to the site.
//
// ENV REQUIRED:
//   STRIPE_SECRET_KEY            — sk_live_... or sk_test_...
//   STRIPE_PRICE_ID_MONTHLY      — price_... for $24.99/mo
//   STRIPE_PRICE_ID_ANNUAL       — price_... for $199/yr
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for looking up user)
const https = require('https');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const PRICE_MONTHLY = process.env.STRIPE_PRICE_ID_MONTHLY;
const PRICE_ANNUAL  = process.env.STRIPE_PRICE_ID_ANNUAL;
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function stripeRequest(path, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const formData = new URLSearchParams(body).toString();
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method,
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
    req.write(formData);
    req.end();
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
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Health-check endpoint — GET /api/stripe-checkout shows config status
  // This lets us debug without running through the full UI flow
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ok: true,
        config: {
          hasSecretKey: !!STRIPE_SECRET,
          secretKeyPrefix: STRIPE_SECRET ? STRIPE_SECRET.slice(0, 8) : null,
          hasMonthlyPrice: !!PRICE_MONTHLY,
          monthlyPricePrefix: PRICE_MONTHLY ? PRICE_MONTHLY.slice(0, 12) : null,
          hasAnnualPrice: !!PRICE_ANNUAL,
          annualPricePrefix: PRICE_ANNUAL ? PRICE_ANNUAL.slice(0, 12) : null,
          hasSupabaseServiceKey: !!SUPA_SERVICE_KEY,
        },
      }),
    };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  if (!STRIPE_SECRET || !PRICE_MONTHLY || !PRICE_ANNUAL) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({
        error: 'Stripe not configured',
        details: {
          hasSecretKey: !!STRIPE_SECRET,
          hasMonthlyPrice: !!PRICE_MONTHLY,
          hasAnnualPrice: !!PRICE_ANNUAL,
        },
      }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid json' }) }; }

  const { plan, userId, email, returnUrl } = body;
  if (!userId || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId and email required' }) };
  }

  const priceId = plan === 'annual' ? PRICE_ANNUAL : PRICE_MONTHLY;
  const baseUrl = returnUrl || 'https://betz360.com';

  // Look up profile to see if they already have a Stripe customer ID
  let stripeCustomerId = null;
  try {
    const lookup = await fetchJSON(
      `${SUPA_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_customer_id`,
      { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` }
    );
    if (lookup.status === 200 && Array.isArray(lookup.data) && lookup.data[0]?.stripe_customer_id) {
      stripeCustomerId = lookup.data[0].stripe_customer_id;
    }
  } catch {}

  // Build Checkout session params
  const params = {
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `${baseUrl}/?subscribed=1`,
    'cancel_url': `${baseUrl}/?subscribed=0`,
    'subscription_data[trial_period_days]': '3',
    'subscription_data[metadata][user_id]': userId,
    // Require a card upfront — without this, trials can be started without
    // payment info and users get free access then disappear at trial end.
    'subscription_data[trial_settings][end_behavior][missing_payment_method]': 'cancel',
    'payment_method_collection': 'always',
    'metadata[user_id]': userId,
    'allow_promotion_codes': 'true',
    'billing_address_collection': 'auto',
  };
  if (stripeCustomerId) {
    params.customer = stripeCustomerId;
  } else {
    params.customer_email = email;
  }

  try {
    const { status, data } = await stripeRequest('/v1/checkout/sessions', params);
    if (status !== 200) {
      return {
        statusCode: 500, headers,
        body: JSON.stringify({
          error: data.error?.message || 'stripe error',
          stripeErrorType: data.error?.type,
          stripeErrorCode: data.error?.code,
          stripeErrorParam: data.error?.param,
          httpStatus: status,
        }),
      };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ url: data.url, sessionId: data.id }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err) }) };
  }
};
