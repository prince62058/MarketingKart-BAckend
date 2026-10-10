const axios = require('axios');

/** Assign only explicitly configured business-scoped users, then verify Meta saved them. */
async function ensurePageAdvertisingAccess({ pageId, pageAccessToken, systemUserAccessToken, businessId, userIds, api = axios }) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!pageAccessToken || !systemUserAccessToken || !businessId || !ids.length) {
    throw new Error('Page advertising access requires Page and agency system-user tokens, business ID and configured business-scoped user IDs.');
  }
  const url = `https://graph.facebook.com/v22.0/${pageId}/assigned_users`;
  const headers = { Authorization: `Bearer ${systemUserAccessToken}` };
  const pageHeaders = { Authorization: `Bearer ${pageAccessToken}` };
  // The owner Page token can read existing assignments before agency users have
  // Page access. Mutations must use the agency token with its business-scoped IDs.
  const current = await api.get(url, { headers: pageHeaders, params: { business: businessId, fields: 'id,tasks', limit: 200 }, timeout: 15000 });
  const existing = current.data.data || [];
  for (const user of ids) {
    const tasks = existing.find(item => String(item.id) === user)?.tasks || [];
    if (tasks.includes('ADVERTISE') || tasks.includes('PROFILE_PLUS_ADVERTISE') || tasks.includes('MANAGE') || tasks.includes('PROFILE_PLUS_FULL_CONTROL')) continue;
    await api.post(url, {
      user, business: businessId,
      // Preserve existing tasks when repairing an existing assignment.
      tasks: [...new Set([...tasks, 'ADVERTISE', 'ANALYZE'])],
    }, { headers, timeout: 15000 });
  }
  const verified = await api.get(url, { headers, params: { business: businessId, fields: 'id,tasks', limit: 200 }, timeout: 15000 });
  const missing = ids.filter(id => !(verified.data.data || []).some(item =>
    String(item.id) === id && (item.tasks || []).some(task => ['ADVERTISE', 'PROFILE_PLUS_ADVERTISE', 'MANAGE', 'PROFILE_PLUS_FULL_CONTROL'].includes(task)),
  ));
  if (missing.length) throw new Error(`Meta has not confirmed Page advertising access for business users: ${missing.join(', ')}.`);
}

module.exports = { ensurePageAdvertisingAccess };
