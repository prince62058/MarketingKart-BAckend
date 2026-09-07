# MarketingKart.ai — Meta App Review Submission Guide

This document contains ready-to-use descriptions, justification details, and reviewer instructions for each permission requested in the Meta Developer Portal (**App ID: 2996420554032786**).

---

## ⚠️ Important Actions Before Filling Out
1. **Remove `threads_basic`**:
   - Your codebase has no Threads API integration.
   - Keeping `threads_basic` will require you to record a screencast and trigger test calls for Threads, and Meta will reject it if no feature exists.
   - Click **"edit your submission"** at the top of the "Allowed usage" page and uncheck/remove `threads_basic`.

2. **Trigger Required API Test Calls for WhatsApp**:
   - `whatsapp_business_management` and `whatsapp_business_messaging` need at least one test call in Dev mode to get the green checkmark before final submission.

---

## 1. Business Asset User Profile Access

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart is an all-in-one AI marketing automation platform designed for local businesses and small enterprises in India. The platform helps merchants manage digital advertising campaigns across Facebook & Instagram and communicate with their customers via WhatsApp.
>
> **Why this permission is needed:**
> To associate the business assets (Facebook Pages, Ad Accounts, and WhatsApp Business Accounts) with the verified business profile of the merchant. This allows MarketingKart to display the merchant's business details, verify ownership of ad assets, and properly map campaigns and customer inquiries to the correct merchant profile.
>
> **Step-by-step User Flow:**
> 1. User logs into the MarketingKart mobile/web application.
> 2. User navigates to Settings / Business Profile and clicks "Connect Meta Business".
> 3. User authenticates via Facebook Login and selects their business assets.
> 4. MarketingKart queries the business profile to retrieve asset associations and verify ownership.
> 5. The connected business assets are displayed in the user's dashboard for launching ads and WhatsApp campaigns.

---

## 2. Marketing API Access Tier

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart enables small business owners to create, publish, monitor, and optimize Facebook and Instagram ad campaigns directly from a simple mobile/web interface without needing complex Ads Manager knowledge.
>
> **Why this permission is needed:**
> The Marketing API Access Tier is necessary for our backend server to programmatically create ad campaigns, ad sets, creatives, and ads (`act_{ad_account_id}/campaigns`, `adsets`, `ads`), configure daily budgets, set local geo-targeting, and retrieve real-time ad performance metrics (impressions, clicks, spend, leads) via `/insights`.
>
> **Step-by-step User Flow:**
> 1. Merchant connects their Meta Ad Account in MarketingKart.
> 2. Merchant selects an ad template, inputs budget and target location, and clicks "Publish Campaign".
> 3. MarketingKart backend creates the campaign, ad set, and ad creative via Marketing API.
> 4. Merchant tracks live spend, impressions, and leads generated on their Campaign Analytics screen.

---

## 3. ads_management

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart provides automated ad campaign creation and lifecycle management for local businesses.
>
> **Why this permission is needed:**
> `ads_management` is required to:
> 1. Create and publish Facebook and Instagram campaigns, ad sets, and creatives (`POST /act_{ad_account_id}/campaigns`, `POST /act_{ad_account_id}/adsets`, `POST /act_{ad_account_id}/ads`).
> 2. Pause, resume, or edit campaign budgets and schedules directly from the mobile app (`POST /{campaign_id}`).
> 3. Generate lead generation forms for lead ads (`POST /{page_id}/leadgen_forms`).
>
> **Step-by-step User Flow:**
> 1. User opens the MarketingKart app and goes to "Create Campaign".
> 2. User chooses ad media (image/video), writes ad copy, sets daily budget and duration.
> 3. User selects their connected Facebook Page and Ad Account.
> 4. User clicks "Launch Ad". MarketingKart creates the campaign using `ads_management`.
> 5. User can toggle ad status (Active/Paused) from the Campaign Details screen.

---

## 4. ads_read

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart provides a real-time analytics dashboard where merchants monitor the performance of their Facebook and Instagram advertisements.
>
> **Why this permission is needed:**
> `ads_read` is required to read ad account details, campaign statuses, ad creative previews, and fetch performance analytics via the Graph API (`GET /{campaign_id}/insights` for spend, impressions, clicks, CTR, and reach).
>
> **Step-by-step User Flow:**
> 1. User opens the MarketingKart app and taps the "Analytics" or "Campaigns" tab.
> 2. The app fetches and displays the list of campaigns with their current status (Active, In Review, Completed).
> 3. User clicks on a specific campaign to view detailed graphs showing daily spend, total reach, and conversion statistics pulled via `ads_read`.

---

## 5. pages_show_list

### Description / Justification
> **App Purpose & Feature:**
> In MarketingKart, businesses run advertisements and receive customer leads through their official Facebook Pages.
>
> **Why this permission is needed:**
> `pages_show_list` is required to retrieve the list of Facebook Pages that the authenticated user manages (`GET /me/accounts`). This allows the merchant to select which Facebook Page should be linked to their business and represent their brand in ad campaigns and lead forms.
>
> **Step-by-step User Flow:**
> 1. User navigates to "Profile" -> "Connect Facebook Page" in the app.
> 2. User completes Facebook Login consent.
> 3. The app calls `GET /me/accounts` to display a dropdown/modal with all the Pages the user administers.
> 4. User selects their business Page and clicks "Link Page".

---

## 6. pages_read_engagement

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart monitors Page identity and campaign engagement metrics to report overall marketing effectiveness.
>
> **Why this permission is needed:**
> Required alongside `pages_show_list` to read Page metadata, verify Page status, and ensure the app can access ad-related page engagement and lead generation configurations associated with the connected Facebook Page.
>
> **Step-by-step User Flow:**
> 1. User links their Facebook Page via Facebook Login for Business.
> 2. The app verifies that the Page is active and eligible to run Lead Ads and display sponsored content.
> 3. Engagement data and Page details are displayed in the connected business card in the app settings.

---

## 7. business_management

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart manages client business assets, connecting Meta Business Managers, WhatsApp Business Accounts (WABAs), and Ad Accounts under the merchant's business entity.
>
> **Why this permission is needed:**
> `business_management` is required to query the merchant's Meta Business Accounts (`GET /me/businesses`), discover associated WhatsApp Business Accounts (`GET /{business_id}/owned_whatsapp_business_accounts` and `client_whatsapp_business_accounts`), and verify Business Manager ownership for onboarding.
>
> **Step-by-step User Flow:**
> 1. User opens "Connect Business / WhatsApp" in MarketingKart.
> 2. App queries the merchant's Meta Business Manager accounts.
> 3. The merchant confirms the Business Manager managing their brand assets.
> 4. The app associates the relevant Ad Account and WABA to the merchant's MarketingKart workspace.

---

## 8. leads_retrieval

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart provides an integrated Lead Management System (CRM) for local businesses running Lead Generation ad campaigns.
>
> **Why this permission is needed:**
> When prospective customers submit an Instant Form on a Facebook/Instagram Lead Ad, MarketingKart receives real-time webhook notifications and fetches the lead details (name, phone number, email, custom questions) via `GET /{lead_id}` or `GET /{form_id}/leads`.
>
> **Step-by-step User Flow:**
> 1. A customer fills out a lead form on a Facebook/Instagram ad published via MarketingKart.
> 2. Meta webhook sends a `leadgen` event to MarketingKart backend.
> 3. Backend retrieves lead information using `leads_retrieval` (`GET /{lead_id}`).
> 4. The merchant receives an instant push notification on the MarketingKart mobile app.
> 5. The merchant views the lead in the "Leads" tab and can call or message the lead immediately.

---

## 9. whatsapp_business_management

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart allows businesses to integrate their official WhatsApp Business Account (WABA) for customer support and automated marketing broadcasts.
>
> **Why this permission is needed:**
> Required to manage the merchant's WhatsApp Business Account configuration:
> 1. Discover and fetch registered phone numbers (`GET /{waba_id}/phone_numbers`).
> 2. Fetch message templates and their approval statuses (`GET /{waba_id}/message_templates`).
> 3. Subscribe webhooks for incoming messages and delivery statuses.
>
> **Step-by-step User Flow:**
> 1. Merchant navigates to "Connect WhatsApp" in MarketingKart settings.
> 2. Merchant completes the WhatsApp Embedded Signup flow.
> 3. MarketingKart queries the WABA phone numbers and approval status using `whatsapp_business_management`.
> 4. Merchant's verified WhatsApp sender number and approved templates appear in the app.

---

## 10. whatsapp_business_messaging

### Description / Justification
> **App Purpose & Feature:**
> MarketingKart enables businesses to send transactional updates, automated order confirmations, lead responses, and marketing notifications to opted-in customers via WhatsApp.
>
> **Why this permission is needed:**
> Required to send WhatsApp messages (template messages and session messages) to customers via the Meta Cloud API (`POST /{phone_number_id}/messages`).
>
> **Step-by-step User Flow:**
> 1. A new lead is captured or a merchant triggers a campaign update in MarketingKart.
> 2. The merchant creates or selects an approved template message.
> 3. The backend sends the message to the customer's phone number using `POST /{phone_number_id}/messages`.
> 4. Customer receives the message on WhatsApp, and delivery receipts are tracked in the app.

---

## 11. public_profile

### Description / Justification
> **App Purpose & Feature:**
> User authentication and identification.
>
> **Why this permission is needed:**
> Used to authenticate the user during Facebook Login, obtain their unique Meta User ID (`id`) and name, and link their account to their MarketingKart profile.
>
> **Step-by-step User Flow:**
> 1. User taps "Continue with Facebook" or connects their Facebook account in settings.
> 2. User grants standard profile permission.
> 3. App displays the user's name and avatar in the profile header.

---

## Screencast Video Instructions (What Meta Reviewers Look For)

Meta requires a video walkthrough showing the exact flow for each permission (you can record 1 or 2 comprehensive videos covering all permissions):

### Key Screencast Checklist:
1. **Show the Login / Connect dialog clearly**:
   - Show user opening the MarketingKart app.
   - Show user clicking "Connect Facebook / Meta".
   - The Facebook OAuth consent screen must be visible showing the app name (`Marketingkart.ai`) and the requested permissions.
2. **Show the Feature in Action**:
   - **Pages**: Show the list of Pages retrieved (`pages_show_list`), selecting one, and saving it.
   - **Ads**: Show creating an ad campaign, selecting budget/audience, publishing it (`ads_management`), and viewing campaign graphs (`ads_read`).
   - **Leads**: Show the "Leads" tab in the app where leads are displayed (`leads_retrieval`).
   - **WhatsApp**: Show connected WhatsApp Business number and template/messaging screen (`whatsapp_business_management`, `whatsapp_business_messaging`).
3. **Format**:
   - Format: MP4 or MOV.
   - Max file size: 500MB per video.
   - Keep screen resolution clear (1080p recommended).
   - Add English voiceover or clear text captions explaining each step.
