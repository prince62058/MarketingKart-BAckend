# WhatsApp customer onboarding rollout

The hosted signup is deployed. Number-type safeguards are released through backend main (Dokploy); customer-number end-to-end verification and the mobile release remain separate rollout checks.

Customer flow: authenticated MarketingKart app → Connect WhatsApp → hosted Meta Embedded Signup → customer chooses their own business and WABA, verifies their phone in Meta, and grants management/messaging access → server exchanges the code, checks app/scopes/WABA/phone ownership, registers when necessary and subscribes webhooks → app confirms server status.

Required configuration:
- A dedicated WhatsApp Embedded Signup configuration for WhatsApp Cloud API, not the existing general Facebook Login configuration.
- `META_WHATSAPP_CONFIG_ID` set to the created configuration ID.
- `WHATSAPP_TOKEN_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hexadecimal characters. Preserve this secret across deployments and back it up securely. Do not commit it. Existing legacy encrypted records remain readable with their original encryption key.
- Existing `clientId`, `clientSecret`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` retained.
- Hosted signup: https://api.marketingkart.in/api/whatsapp/meta/signup
- Allow the API origin for Facebook JavaScript SDK login and the signup URL as OAuth redirect URI, preserving current Page login URLs.
- Meta webhook callback: https://api.marketingkart.in/api/whatsapp/webhook, with messages subscription.
- Verify app Live status, advanced access for whatsapp_business_management and whatsapp_business_messaging, and Tech Provider onboarding eligibility before public launch.

Rollout checks: verify code exchange and webhook subscription with a customer-owned test number; verify callbacks and delivery status; verify non-app-role customer onboarding. Do not advertise public readiness based on permission approval alone. Do not send a paid message without authorization.

Isolation: one number may belong to one MarketingKart account only. Legacy duplicate mappings fail closed for outgoing messages and incoming routing. Resolve their ownership through support; never arbitrarily transfer an existing mapping. The provider system token is not a fallback for public customer signup. Signup state expires after ten minutes and is consumed once. API JSON omits access tokens.

Customer instructions: use a number/business you control. Complete the SMS/voice verification in Meta yourself. Customers do not enter a registration PIN in MarketingKart. The backend generates the Meta-required PIN and stores it encrypted in the tenant-owned phone claim before registration, reusing it on retries. This does not bypass or reset an existing PIN imposed by Meta or another provider. Existing WhatsApp Business app coexistence is available only when Meta offers it for the number; do not tell customers to delete their WhatsApp account. Messaging eligibility, templates, opt-in and billing still need to be satisfied after authentication.

## Audit and number-type flow — 16 October 2026

Inspected in the signed-in Chrome Meta dashboard:
- App `2996420554032786` (Marketingkart.ai) is a Tech Provider; Business Verification and App Review show Approved.
- Configuration `1753939735905629` (MarketingKart WhatsApp SaaS) uses WhatsApp Embedded Signup, WhatsApp Cloud API and Marketing Messages API, a system-user token, WhatsApp account assets, and the three WhatsApp management/messaging/events permissions. Existing general Page-login configuration is separate.
- JavaScript SDK login is enabled for `https://api.marketingkart.in/`. HTTPS and strict redirect matching remain enabled; embedded-browser OAuth is disabled.
- WhatsApp callback is `https://api.marketingkart.in/api/whatsapp/webhook`. `messages` and `message_template_status_update` are subscribed.
- `account_update`, `history`, `smb_app_state_sync`, and `smb_message_echoes` are unsubscribed. Do not enable coexistence until the backend durably ingests these fields and initiates contacts/history synchronization.
- The existing generated Meta-hosted link points to the Page-login callback. Do not use it as the authenticated WhatsApp application connection flow.
- Live hosted signup returns HTTP 200 and already uses the correct WhatsApp configuration. Local `.env` was missing the config ID; the ignored local file is now aligned. `.env.production` already contained the config ID.

Local implementation now presents number type → prerequisites and checkbox → Meta signup in a real browser. A new number must be unused by the mobile WhatsApp apps; moving an existing API number is a separate provider-migration situation. Business App coexistence is explicitly unavailable rather than falling through to normal registration. The server rejects Business App numbers on the standard registration path. The popup finish event and OAuth code are both required; tests cover both callback arrival orders and foreign origins.

Pending external steps:
- Verify persistence of the approved OAuth redirect `https://api.marketingkart.in/api/whatsapp/meta/signup`, retaining the existing Page callback.
- Backend deployment uses GitHub main → Dokploy. Verify the public signup page after pushing. Mobile changes require a separate build/release.
- Test with an explicitly selected user-owned number, complete Meta's OTP/permissions/terms steps, and verify server-confirmed connection.
- Business App coexistence needs the additional webhook processing, synchronization lifecycle, and rollout validation before its entry can be enabled. Meta specifies skipping `/register` and starting synchronization within 24 hours for that flow.

References:
- User video: https://www.youtube.com/watch?v=stKXcZCg5I8 (complete 2:57 transcript reviewed)
- MSG91 guide: https://msg91.com/help/whatsapp/step-by-step-process-to-configure-whatsapp-api-in-msg91
- Meta coexistence: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users

Validation: 11 focused backend signup tests passed; mobile TypeScript check passed. No live number was registered/migrated and no message or payment was sent.
