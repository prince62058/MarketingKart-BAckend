# WhatsApp customer onboarding rollout

Implementation is not yet deployed or live-verified.

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

Customer instructions: use a number/business you control. Complete the SMS/voice verification in Meta yourself. A six-digit WhatsApp two-step registration PIN is distinct from the SMS OTP. Existing WhatsApp Business app coexistence is available only when Meta offers it for the number; do not tell customers to delete their WhatsApp account. Messaging eligibility, templates, opt-in and billing still need to be satisfied after authentication.
