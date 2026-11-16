# WhatsApp Conversions API (Conversions API for Business Messaging)

Built 2026-11-16 so Meta App Review can approve `whatsapp_business_manage_events` for app 2996420554032786.
Not committed or deployed yet.

## What it does

1. **Capture the ad click.** When an inbound WhatsApp message carries `referral.ctwa_clid` (the customer
   opened the chat from a Click-to-WhatsApp ad), `postWhatsAppWebhook` stores it on the conversation as
   `ctwa` (first touch: a later ad click in the same chat never replaces it). `ctwa.clid` is
   `select: false`, so inbox reads never return it.
2. **Mark as lead / sale.** The business owner marks the chat in the app. The backend sends one
   `LeadSubmitted` or `Purchase` event (value in INR) to the WABA's Conversions API dataset, at most once
   per chat and event, and records the result.
3. **Dataset per WABA.** Looked up (or created) through the Graph API on first use and saved on the
   account (`whatsappAccount.capiDataset`).

Code: `src/services/whatsappConversionService.js` (all logic, dependency-injected),
`src/controllers/whatsappConversionController.js`, `src/models/whatsappConversionEventModel.js`,
routes in `src/routes/whatsappChatRoute.js`, `ctwa` in `src/models/whatsappConversationModel.js`,
`capiDataset` in `src/models/whatsappAccountModel.js`, one call in `src/controllers/webhookController.js`.

## Meta API shapes used (checked against the docs on 2026-11-16)

### 1. Webhook `referral` on an inbound message

Doc: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text.md

```json
"referral": {
  "source_url": "<AD_URL>",
  "source_id": "<AD_ID>",
  "source_type": "ad",
  "body": "<AD_PRIMARY_TEXT>",
  "headline": "<AD_HEADLINE>",
  "media_type": "image | video",
  "image_url": "<only for image ads>",
  "video_url": "<only for video ads>",
  "thumbnail_url": "<only for video ads>",
  "ctwa_clid": "<AD_CLICK_ID>",
  "welcome_message": { "text": "<AD_GREETING_TEXT>" }
}
```

- `source_id` is the Click-to-WhatsApp ad id. `ctwa_clid` is omitted for ads shown in WhatsApp Status, so
  those chats cannot be reported (the app sees `fromAd: false`).
- Stored as `conversation.ctwa = { clid, adId, sourceType, sourceUrl, headline, mediaType, capturedAt }`.

### 2. Dataset of the WABA

Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging (guide) and
https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/dataset (reference).

- `POST /{waba-id}/dataset` (optional `dataset_name`) returns `{ "id": "<DATASET_ID>" }`. The guide says
  that when the WABA already has a dataset, this returns the existing id.
- `GET /{waba-id}/dataset`: the guide shows it, but the reference says reading this edge is not supported
  and no response example exists. **Unverified.** The code tries GET first (accepts `{ "id" }` or
  `{ "data": [{ "id" }] }`); on any error or empty answer it falls back to the POST.
- The id is saved as `whatsappAccount.capiDataset = { datasetId, wabaId, savedAt }` and only reused while
  `capiDataset.wabaId` equals the account's current `wabaId` (a reconnect can switch WABA).

### 3. Events

Doc: guide above, "Send events" for WhatsApp.

```
POST https://graph.facebook.com/{META_GRAPH_API_VERSION, default v22.0}/{DATASET_ID}/events
Authorization: Bearer <business token of the WABA>
```

```json
{
  "data": [
    {
      "event_name": "Purchase",
      "event_time": 1763294400,
      "event_id": "wa-<conversationId>-Purchase",
      "action_source": "business_messaging",
      "messaging_channel": "whatsapp",
      "user_data": {
        "whatsapp_business_account_id": "<WABA_ID>",
        "ctwa_clid": "<CTWA_CLID>"
      },
      "custom_data": { "currency": "INR", "value": 1499 }
    }
  ],
  "partner_agent": "<only when META_CAPI_PARTNER_AGENT is set>",
  "test_event_code": "<only when META_CAPI_TEST_EVENT_CODE is set>"
}
```

- The docs pass `access_token` as a query parameter; the code uses the equivalent `Authorization: Bearer`
  header so the token never lands in URLs or logs.
- Supported business-messaging event names (guide FAQ): Purchase, LeadSubmitted, InitiateCheckout,
  AddToCart, ViewContent, OrderCreated, OrderShipped, OrderDelivered, OrderCanceled, OrderReturned,
  CartAbandoned, QualifiedLead, RatingProvided, ReviewProvided. We send `LeadSubmitted` and `Purchase`.
- `event_time` may be at most 7 days old; one stale event fails the whole request
  (https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api). We always send the
  time of the tap (also on a retry).
- `test_event_code` is an optional top-level field, next to `data`
  (https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/main-body). Meta says
  events sent with it are not dropped and still count.
- Deduplication: the guide FAQ says Meta does **not** deduplicate business-messaging events, so the
  unique index on `(conversationId, eventName)` does it. `event_id` is sent anyway (the generic Conversions
  API keeps the first copy of an `event_id` + `event_name`) and is reused on a retry.
- Success response: not shown on the pages read. **Unverified.** The code treats any 2xx as success,
  reads `events_received` (0 counts as a failure) and `fbtrace_id` when present.
- Rate limits: none specific; calls count as Marketing API calls.

### 4. Permissions and token

- Guide "Pre-integration requirements" (WhatsApp): advanced access to `whatsapp_business_management` and
  `whatsapp_business_manage_events`, plus the Marketing API Access Tier feature. The guide says an app with
  advanced `whatsapp_business_messaging` should be approved for `whatsapp_business_manage_events`
  automatically once it applies.
- Token: the guide recommends the Embedded Signup token, which is what `whatsappAccount.accessToken`
  stores (encrypted) for numbers connected through signup. The Embedded Signup configuration
  (1753939735905629) already lists `whatsapp_business_manage_events`.
- "Existing API number" accounts (`connectedVia: "FACEBOOK"`) store the long-lived token of the app's
  Facebook SDK login, which asks only for `whatsapp_business_management` and
  `whatsapp_business_messaging`, so Meta refuses their events. The SDK login must not ask for
  `whatsapp_business_manage_events` while the permission has only standard access (that broke the
  Facebook screen for people without a role before). Instead, a failed event answers with
  `fix: "ALLOW_EVENTS"`, the app runs a separate Facebook login that also asks for the permission, and
  `POST /api/whatsapp/meta/sdk/allow-events` swaps the stored token (see below).

## MarketingKart API

Both routes use `authUser` (same as the other chat routes) and only work for the owner of the chat's
business. Errors never use 401, because the app signs the user out on a 401 (`src/api/client.ts`).

### `GET /api/whatsapp/chat/conversations/:conversationId/conversion`

```json
{
  "success": true,
  "message": "Conversion status",
  "data": {
    "conversationId": "6553...",
    "fromAd": true,
    "ad": {
      "adId": "120000000000001",
      "sourceType": "ad",
      "sourceUrl": "https://fb.me/...",
      "headline": "Diwali offer",
      "mediaType": "image",
      "capturedAt": "2026-11-16T10:02:00.000Z"
    },
    "events": {
      "lead": null,
      "purchase": {
        "event": "purchase",
        "eventName": "Purchase",
        "status": "SENT",
        "value": 1499,
        "currency": "INR",
        "attempts": 1,
        "sentAt": "2026-11-16T10:05:00.000Z",
        "errorCode": null,
        "errorMessage": null
      }
    },
    "canMark": { "lead": true, "purchase": false }
  }
}
```

`status` is `SENDING`, `SENT` or `FAILED`. `canMark.x` is true when the chat came from an ad and that
event was never sent or its last send failed.

### `POST /api/whatsapp/chat/conversations/:conversationId/conversion`

Body: `{ "event": "lead" }`, `{ "event": "lead", "value": 250 }` or `{ "event": "purchase", "value": 1499 }`.
`value` is in rupees: required and above 0 for a purchase, optional (default 0) for a lead, at most
1,00,00,00,000, rounded to paise. The success body's `data` has the same shape as `events.lead` above.

| HTTP | `code` | Meaning | What the app should do |
| --- | --- | --- | --- |
| 201 | (none) | Reported to Meta | Show "Lead/Sale reported" and mark it done |
| 200 | (none), `alreadySent: true` | Was already reported | Treat as done |
| 400 | `INVALID_EVENT`, `INVALID_VALUE` | Bad input | Show the message by the amount field |
| 403 | `FORBIDDEN` | Not this user's chat | Show the message |
| 404 | `NOT_FOUND` | No such chat | Show the message |
| 404 | `WHATSAPP_NOT_CONNECTED` | The chat's number is not connected | Offer "Connect WhatsApp" |
| 409 | `NOT_FROM_AD` | The chat has no `ctwa_clid` | Hide the action |
| 409 | `WABA_MISMATCH` | The chat belongs to a WABA that is no longer connected | Offer "Reconnect WhatsApp" |
| 409 | `IN_PROGRESS` | Another tap is being sent | "Try again in a minute" |
| 502 | `EVENTS_PERMISSION_MISSING`, `fix: "ALLOW_EVENTS"` | An "Existing API number" token lacks `whatsapp_business_manage_events` | Offer "Allow": separate Facebook login, then `allow-events`, then send again |
| 502 | `EVENTS_PERMISSION_MISSING`, `fix: "RECONNECT"` | A signup token lacks `whatsapp_business_manage_events` | Offer "Reconnect WhatsApp" |
| 502 | `WHATSAPP_TOKEN_INVALID` | The token expired or was revoked (Meta 190) | Offer "Reconnect WhatsApp" |
| 502 | `META_ERROR` | Meta refused the event or could not be reached; saved as `FAILED` | Show the message; allow retry |

Conversation objects from `GET /api/whatsapp/chat/conversations` now also carry
`ctwa: { adId, sourceType, sourceUrl, headline, mediaType, capturedAt }` (never the click id) for chats
that started from an ad.

### `POST /api/whatsapp/meta/sdk/allow-events`

Body: `{ "accessToken": "<token from the app's separate Facebook SDK login>" }`. Only for the signed-in
user's connected account with `connectedVia: "FACEBOOK"`. The server checks the token with
`debug_token` (this app, valid, management + messaging + `whatsapp_business_manage_events`, and the
connected WABA among the granted accounts), swaps it for a long-lived token, checks that again, and
replaces only `accessToken` and `tokenExpiresAt` of that same account. The token is never sent back.

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 200 | (none) | Stored. `data: { allowed: true, tokenExpiresAt }`; send the event again |
| 400 | `EVENTS_PERMISSION_DECLINED` | The token lacks the permission, or not for the connected WABA |
| 400 | (none) | The token is invalid, expired, from another app, or cannot manage the connected WABA |
| 404 | `WHATSAPP_NOT_CONNECTED` | No connected account |
| 409 | `RECONNECT_REQUIRED` | The account came from Embedded Signup; reconnect instead |
| 409 | `WHATSAPP_CHANGED` | The account was reconnected meanwhile; try again |
| 503 | (none) or `NOT_CONFIGURED` | Facebook app settings are missing on the server |

## Mobile app (MarketingKartNative): what to build

Not built yet. It needs:

1. `src/api/whatsapp.ts`:

   ```ts
   export interface WAConversionEvent {
     event: 'lead' | 'purchase';
     eventName: 'LeadSubmitted' | 'Purchase';
     status: 'SENDING' | 'SENT' | 'FAILED';
     value: number;
     currency: 'INR';
     attempts: number;
     sentAt: string | null;
     errorCode: string | null;
     errorMessage: string | null;
   }
   export interface WAConversionState {
     conversationId: string;
     fromAd: boolean;
     ad: { adId: string | null; sourceType: string | null; sourceUrl: string | null; headline: string | null; mediaType: string | null; capturedAt: string | null } | null;
     events: { lead: WAConversionEvent | null; purchase: WAConversionEvent | null };
     canMark: { lead: boolean; purchase: boolean };
   }
   export const waGetConversion = (conversationId: string) =>
     unwrap<WAConversionState>(client.get(`/whatsapp/chat/conversations/${conversationId}/conversion`));
   export const waMarkConversion = (conversationId: string, data: { event: 'lead' | 'purchase'; value?: number }) =>
     unwrap<WAConversionEvent>(client.post(`/whatsapp/chat/conversations/${conversationId}/conversion`, data));
   ```

   Add `ctwa?: { adId?: string; headline?: string; capturedAt?: string }` to `WAConversation` for an
   optional "From ad" badge in the inbox.
2. `src/screens/WhatsAppMarketing/WA_ChatScreen.tsx`: on open call `waGetConversion(conversationId)`.
   When `fromAd` is true, show "Mark as lead" and "Mark as sale" (enabled per `canMark`, a tick when the
   event is `SENT`). "Mark as sale" asks for the amount in ₹ (numeric keyboard). After a 201/200 store the
   returned event; on errors read `error.response.data.code` and react as in the table above
   ("Reconnect WhatsApp" opens the existing connect flow).
3. A Play Store build (`com.marketingkart.app`) with this screen, because reviewers test the Play build.

## Data stored

- `whatsappConversation.ctwa` (first touch, `clid` hidden from reads).
- `whatsappAccount.capiDataset`.
- New collection `whatsappconversionevents`: conversation, business, user, WABA, phone number id,
  dataset, event name, `eventId`, `eventTime`, value, currency, ad id, status, attempts, `lockedAt`,
  `sentAt`, `eventsReceived`, `fbtraceId`, `errorCode`, `errorMessage`. Unique index
  `{ conversationId: 1, eventName: 1 }`; it is a new, empty collection, so building the index on deploy
  cannot hit duplicates.

## Deploy and go-live notes

- Nothing is committed or deployed. `src/controllers/webhookController.js` and
  `src/models/whatsappAccountModel.js` also hold another session's uncommitted account-health work;
  commit the two features together or split the hunks carefully.
- No new env var is required. Optional: `META_CAPI_PARTNER_AGENT` (only if Meta assigns a partner agent
  name) and `META_CAPI_TEST_EVENT_CODE` (only while checking events in Events Manager "Test events";
  remove afterwards).
- `whatsapp_business_manage_events` has Standard access only, so only people with a role on the app can
  grant it. The Embedded Signup configuration (1753939735905629) already lists the permission, so an
  app-role user who connects through it should get a token that carries it. Public customers' tokens do
  not have it yet: their taps return `502 EVENTS_PERMISSION_MISSING` and are saved as `FAILED` (they can
  be retried). A token keeps the permissions it was granted, so after App Review grants advanced access,
  customers need to reconnect WhatsApp once to report conversions.
- `connectSignup()` checks only `whatsapp_business_management` and `whatsapp_business_messaging`, so
  connecting WhatsApp keeps working without the events permission.
- To produce a real `ctwa_clid`, run (or reuse) a Click-to-WhatsApp ad that sends people to a number
  connected by an app-role user, tap it from another phone and send a message.
- Check delivery in Events Manager: Data sources, then the WABA's dataset. Events show in Overview within
  about 20 minutes, or immediately in "Test events" when `META_CAPI_TEST_EVENT_CODE` is set.

## App Review screencast script (`whatsapp_business_manage_events`)

Record on the Play Store build, after the backend is deployed and the mobile screen is released.

1. **Connect WhatsApp.** In MarketingKart open WhatsApp, tap "Connect WhatsApp", go through Meta's
   Embedded Signup and pause on the permissions screen that lists managing events for the WhatsApp
   account. Finish and show the connected number. A number that is already on the Cloud API connects
   as "Existing API number" instead; its permission screen comes in step 3.
2. **Customer arrives from an ad.** On a second phone, tap the Click-to-WhatsApp ad in Facebook or
   Instagram and send a message. Show the chat arriving in the MarketingKart inbox with its "From ad"
   label.
3. **Mark as lead.** Open the chat, tap "Mark as lead" and show the "Lead reported to Meta"
   confirmation. For an "Existing API number", the first tap shows "Allow lead and sale reports": tap
   "Allow", pause on the Facebook screen that asks to manage events, approve, and the lead is sent.
4. **Mark as sale.** Tap "Mark as sale", enter ₹1,499, confirm, and show that it is marked as sent and
   cannot be sent a second time.
5. **Show it in Meta.** Open Events Manager, then the WABA's dataset, and show the `LeadSubmitted` and
   `Purchase` (1,499 INR) events received from MarketingKart.

Draft usage description: "MarketingKart lets businesses that run Click-to-WhatsApp ads mark a WhatsApp
chat as a lead or a sale. We use whatsapp_business_manage_events only to get or create the business's
Conversions API dataset for its WhatsApp Business Account and to send LeadSubmitted and Purchase events
with the chat's ctwa_clid and the sale value, so the business can measure and optimise its ads in Ads
Manager. We send no other customer data."

## Tests

- `test/whatsappConversions.test.js` (14 tests, fakes only): referral extraction, first touch, the exact
  event payload, purchase validation, at-most-once (already sent, in progress, stale lock), failure
  recorded and retried with the same `event_id`, `events_received: 0`, Meta error mapping, tenant and
  not-from-ad refusals, WhatsApp not connected / WABA mismatch, dataset GET/POST/cache/reconnect,
  optional `partner_agent` / `test_event_code`, status without the click id, controller scoping.
- `test/whatsappConversions.e2e.test.js` (1 test, real app + throwaway mongod, axios stubbed so nothing
  leaves the machine): signed webhook stores the click id (first touch), the inbox never returns it,
  another tenant gets 403, one Purchase is sent and the second tap is not.
- `test/security.routes.test.js`: both routes added to `SIGNED_IN` (anonymous callers get 401).

## Known limits

- Only live `messages` webhooks are scanned. Chats imported by Business App history sync have no click id.
- The first ad click is kept for the life of the chat, by design.
- If saving the result fails after Meta accepted the event, the row stays `SENDING`; after 10 minutes a
  retry may send it again, with the same `event_id`.
- The path without `ctwa_clid` (Page id plus hashed customer data) is not implemented.
