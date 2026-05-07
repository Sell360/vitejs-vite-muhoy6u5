// Stripe webhook handler — flips is_pro flags based on subscription events.
//
// Configure in Stripe Dashboard → Developers → Webhooks:
//   URL: https://betz360.com/api/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.updated,
//           customer.subscription.deleted, invoice.payment_failed
//
// ENV REQUIRED:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET     — whsec_... (Stripe gives you this when configuring)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const https = require('https');
const crypto = require('crypto');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || process.env.stripe_webhook_secret;
const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.supabase_url || process.env.vite_supabase_url;
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabase_service_role_key;

// Verify Stripe webhook signature (security-critical — without this, anyone
// could POST fake events to flip is_pro on any user)
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(',').reduce((acc, p) => {
    const [k, v] = p.split('=');
    if (k === 't') acc.timestamp = v;
    if (k === 'v1') acc.signatures = (acc.signatures || []).concat(v);
    return acc;
  }, {});
  if (!parts.timestamp || !parts.signatures) return false;

  const signedPayload = `${parts.timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return parts.signatures.some(sig => {
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
    catch { return false; }
  });
}

function patchProfile(userId, fields) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${SUPA_URL}/rest/v1/profiles?id=eq.${userId}`);
    const data = JSON.stringify(fields);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: {
        'apikey': SUPA_SERVICE_KEY,
        'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Prefer': 'return=minimal',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(data); req.end();
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

async function findUserByCustomerId(customerId) {
  const res = await fetchJSON(
    `${SUPA_URL}/rest/v1/profiles?stripe_customer_id=eq.${customerId}&select=id`,
    { apikey: SUPA_SERVICE_KEY, Authorization: `Bearer ${SUPA_SERVICE_KEY}` }
  );
  if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) return null;
  return res.data[0].id;
}

exports.handler = async (event) => {
  // Stripe sends raw POST body — must NOT parse before verifying signature
  const rawBody = event.body || '';
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  if (!verifyStripeSignature(rawBody, signature, WEBHOOK_SECRET)) {
    return { statusCode: 400, body: 'invalid signature' };
  }

  let evt;
  try { evt = JSON.parse(rawBody); }
  catch { return { statusCode: 400, body: 'invalid json' }; }

  try {
    switch (evt.type) {
      case 'checkout.session.completed': {
        const session = evt.data.object;
        const userId = session.metadata?.user_id || session.subscription_data?.metadata?.user_id;
        if (!userId) break;
        await patchProfile(userId, {
          is_pro: true,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          subscription_status: 'trialing',
        });
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = evt.data.object;
        const userId = sub.metadata?.user_id || await findUserByCustomerId(sub.customer);
        if (!userId) break;
        // is_pro is true while the subscription is active or in trial
        const activeStatuses = ['active', 'trialing'];
        await patchProfile(userId, {
          is_pro: activeStatuses.includes(sub.status),
          subscription_status: sub.status,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer,
          subscription_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = evt.data.object;
        const userId = sub.metadata?.user_id || await findUserByCustomerId(sub.customer);
        if (!userId) break;
        await patchProfile(userId, {
          is_pro: false,
          subscription_status: 'canceled',
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = evt.data.object;
        const userId = await findUserByCustomerId(invoice.customer);
        if (!userId) break;
        // Don't immediately revoke — Stripe will retry. Just flag the status.
        await patchProfile(userId, {
          subscription_status: 'past_due',
        });
        break;
      }
    }
  } catch (err) {
    console.error('webhook handler error:', err);
    // Return 200 anyway so Stripe doesn't retry forever; we logged the error
  }

  return { statusCode: 200, body: 'ok' };
};

// Stripe expects the function to receive raw bodies — make sure netlify.toml
// doesn't strip them. Default behavior preserves the raw body.
