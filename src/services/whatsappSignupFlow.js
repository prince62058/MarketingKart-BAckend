const MODES = ['NEW_OR_MIGRATE', 'BUSINESS_APP'];

function parseSignupMode(value = 'NEW_OR_MIGRATE') {
  if (!MODES.includes(value)) throw new Error('Choose New / Migrate Number or Connect WhatsApp Business App.');
  return value;
}

function signupOptions(configId, mode) {
  return {
    config_id: configId,
    response_type: 'code',
    override_default_response_type: true,
    extras: mode === 'BUSINESS_APP'
      // Session logging v3 is distinct from Embedded Signup v4 (selected by config_id).
      // Meta's Business App onboarding launch requires this session payload format.
      ? { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }
      : { setup: {} },
  };
}

module.exports = { parseSignupMode, signupOptions };
