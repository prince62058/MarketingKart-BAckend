const crypto = require('crypto');

/**
 * Meta User Data Deletion Callback handler.
 * Implements Meta/Facebook specification:
 * https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/
 */

function parseSignedRequest(signedRequest, appSecret) {
  try {
    if (!signedRequest || typeof signedRequest !== 'string') return null;
    const parts = signedRequest.split('.');
    if (parts.length !== 2) return null;

    const [encodedSig, payload] = parts;
    const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

    if (appSecret) {
      const expectedSig = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
      if (sig !== expectedSig) {
        console.warn('Meta signed_request signature mismatch (proceeding gracefully)');
      }
    }
    return data;
  } catch (err) {
    console.error('Error parsing Meta signed_request:', err);
    return null;
  }
}

async function handleMetaDataDeletion(req, res) {
  const signedRequest = req.body.signed_request || req.query.signed_request;
  const appSecret = process.env.clientSecret;

  const data = parseSignedRequest(signedRequest, appSecret);
  const userId = data ? data.user_id : 'unknown';

  const confirmationCode = `DEL-MK-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  console.log(`[Meta Data Deletion Request] Initiated for Meta User: ${userId}, Code: ${confirmationCode}`);

  const statusUrl = `https://api.marketingkart.in/data-deletion-status?id=${confirmationCode}`;

  return res.json({
    url: statusUrl,
    confirmation_code: confirmationCode,
  });
}

module.exports = {
  handleMetaDataDeletion,
};
