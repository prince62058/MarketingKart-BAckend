/**
 * Legal & Compliance Pages for MarketingKart.ai
 * Responsive, modern HTML views for Meta / Google / Apple compliance.
 */

function getSharedStyles() {
  return `
    :root {
      --bg-primary: #0F172A;
      --bg-card: #1E293B;
      --border-color: rgba(255, 255, 255, 0.1);
      --text-primary: #F8FAFC;
      --text-secondary: #94A3B8;
      --text-muted: #64748B;
      --accent-orange: #FF6B00;
      --accent-gradient: linear-gradient(135deg, #FF6B00 0%, #FF8C00 100%);
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 20px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      padding: 0;
      margin: 0;
    }
    .header {
      background: rgba(15, 23, 42, 0.95);
      border-bottom: 1px solid var(--border-color);
      padding: 20px 24px;
      position: sticky;
      top: 0;
      backdrop-filter: blur(10px);
      z-index: 100;
    }
    .header-inner {
      max-width: 900px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      font-size: 22px;
      font-weight: 800;
      color: #FFF;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .logo span { color: var(--accent-orange); }
    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      margin-left: 18px;
      transition: color 0.2s;
    }
    .nav-links a:hover { color: #FFF; }
    .container {
      max-width: 900px;
      margin: 40px auto;
      padding: 0 24px 60px 24px;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 36px 32px;
      margin-bottom: 30px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }
    h1 {
      font-size: 32px;
      font-weight: 800;
      margin-bottom: 12px;
      color: #FFF;
      letter-spacing: -0.5px;
    }
    .updated-date {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 28px;
      display: block;
    }
    h2 {
      font-size: 20px;
      font-weight: 700;
      margin: 28px 0 12px 0;
      color: var(--accent-orange);
    }
    p, li {
      color: var(--text-secondary);
      font-size: 15px;
      margin-bottom: 14px;
    }
    ul, ol {
      margin-left: 24px;
      margin-bottom: 18px;
    }
    li { margin-bottom: 8px; }
    .step-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--radius-md);
      padding: 20px 22px;
      margin: 16px 0;
    }
    .step-box h3 {
      color: #FFF;
      font-size: 16px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .step-number {
      background: var(--accent-orange);
      color: #FFF;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
    }
    .contact-card {
      background: rgba(255, 107, 0, 0.08);
      border: 1px solid rgba(255, 107, 0, 0.25);
      border-radius: var(--radius-md);
      padding: 22px;
      margin-top: 24px;
    }
    .contact-card h3 {
      color: #FFF;
      margin-bottom: 8px;
      font-size: 17px;
    }
    .contact-card a {
      color: var(--accent-orange);
      text-decoration: underline;
      font-weight: 600;
    }
    .badge {
      display: inline-block;
      background: rgba(16, 185, 129, 0.15);
      color: #10B981;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 16px;
    }
    .footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
      padding: 24px 0 40px 0;
      border-top: 1px solid var(--border-color);
    }
  `;
}

function renderBaseHtml({ title, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | MarketingKart.ai</title>
  <style>${getSharedStyles()}</style>
</head>
<body>
  <header class="header">
    <div class="header-inner">
      <a href="/" class="logo">MarketingKart<span>.ai</span></a>
      <div class="nav-links">
        <a href="/privacy-policy">Privacy Policy</a>
        <a href="/terms-of-service">Terms of Service</a>
        <a href="/data-deletion">Data Deletion</a>
      </div>
    </div>
  </header>

  <main class="container">
    <div class="card">
      ${content}
    </div>
  </main>

  <footer class="footer">
    <p>© ${new Date().getFullYear()} MarketingKart.ai (Ayotrix Technologies). All rights reserved.</p>
  </footer>
</body>
</html>`;
}

function getDataDeletionInstructionsHtml() {
  const content = `
    <span class="badge">Meta Platform Compliance</span>
    <h1>User Data Deletion Instructions</h1>
    <span class="updated-date">Last Updated: August 2026</span>

    <p>
      At <strong>MarketingKart.ai</strong>, we value your privacy and data autonomy. In accordance with Meta / Facebook Platform Policies and Global Privacy Laws (GDPR & CCPA), you have the right to request the permanent deletion of your data and any Facebook/Meta account association from our systems at any time.
    </p>

    <h2>Option 1: Remove App via Facebook Settings (Instant)</h2>
    <p>If you signed in or linked your Facebook Pages / Instagram account with MarketingKart.ai, you can remove our access directly via Facebook:</p>

    <div class="step-box">
      <h3><span class="step-number">1</span> Open Facebook Settings</h3>
      <p>Go to your Facebook profile's <strong>Settings & Privacy ➔ Settings</strong>.</p>
    </div>

    <div class="step-box">
      <h3><span class="step-number">2</span> Navigate to Apps and Websites</h3>
      <p>In the left sidebar, click on <strong>Apps and Websites</strong> to see all services connected to your Facebook account.</p>
    </div>

    <div class="step-box">
      <h3><span class="step-number">3</span> Remove MarketingKart.ai</h3>
      <p>Search for <strong>Marketingkart.ai</strong> and click the <strong>Remove</strong> button.</p>
    </div>

    <div class="step-box">
      <h3><span class="step-number">4</span> Request Data Deletion Confirmation</h3>
      <p>Check the box to delete all posts, videos, or associated data created by MarketingKart.ai and confirm.</p>
    </div>

    <h2>Option 2: Direct Data Deletion Request via Email</h2>
    <p>
      If you want all your business data, campaign history, leads, phone records, and account information completely and permanently wiped from our databases, please submit a deletion request to our compliance team:
    </p>

    <div class="contact-card">
      <h3>📧 Email Data Deletion Support</h3>
      <p>Send an email to: <a href="mailto:ayotrix1@gmail.com?subject=Data Deletion Request - MarketingKart">ayotrix1@gmail.com</a></p>
      <p><strong>Subject:</strong> Data Deletion Request - [Your Registered Phone / Email]</p>
      <p><strong>Please Include:</strong></p>
      <ul>
        <li>Registered Mobile Number</li>
        <li>Business Name</li>
        <li>Facebook User ID or Page Name (if applicable)</li>
      </ul>
      <p><em>Our data privacy team will process and purge your data within 48-72 hours and provide a confirmation code.</em></p>
    </div>
  `;
  return renderBaseHtml({ title: 'User Data Deletion Instructions', content });
}

function getDataDeletionStatusHtml(id) {
  const content = `
    <span class="badge">Status Tracking</span>
    <h1>Data Deletion Request Status</h1>
    <span class="updated-date">Confirmation Code: <strong>${id || 'DEL-MK-' + Date.now()}</strong></span>

    <div class="step-box" style="border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.05);">
      <h3 style="color: #10B981;">✅ Request Received & In-Progress</h3>
      <p>
        Your request to delete data associated with MarketingKart.ai has been received and queued for deletion. All associated access tokens, lead records, and profile details are being purged from our active databases.
      </p>
    </div>

    <div class="contact-card">
      <h3>Need Help?</h3>
      <p>If you have any questions regarding your data deletion, contact us at <a href="mailto:ayotrix1@gmail.com">ayotrix1@gmail.com</a> with your confirmation code.</p>
    </div>
  `;
  return renderBaseHtml({ title: 'Data Deletion Status', content });
}

function getPrivacyPolicyHtml() {
  const content = `
    <h1>Privacy Policy</h1>
    <span class="updated-date">Effective Date: August 2026</span>

    <p>
      <strong>MarketingKart.ai</strong> ("we", "us", or "our") is dedicated to protecting your privacy. This Privacy Policy describes how we collect, use, and share information when you use our mobile application and web platform.
    </p>

    <h2>1. Information We Collect</h2>
    <ul>
      <li><strong>Account Information:</strong> Mobile phone number, business name, category, and profile details.</li>
      <li><strong>Meta / Facebook Data:</strong> When you connect Facebook or Instagram, we receive Page access tokens, Page IDs, and lead data strictly to manage and publish your digital campaigns.</li>
      <li><strong>Usage & Analytics:</strong> Ad performance metrics, impression counts, lead timestamps, and billing records.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>To generate, publish, and manage digital ad campaigns across Meta platforms.</li>
      <li>To provide in-app CRM tools for tracking incoming leads and customer contacts.</li>
      <li>To process billing, invoices, and wallet transactions.</li>
      <li>To authenticate via OTP and provide customer assistance.</li>
    </ul>

    <h2>3. Data Security & Storage</h2>
    <p>
      We implement enterprise-grade encryption and secure access controls to ensure your data is safe. We never sell your personal data or business leads to third parties.
    </p>

    <h2>4. Data Deletion</h2>
    <p>
      You may request data deletion at any time by following our <a href="/data-deletion" style="color: var(--accent-orange);">Data Deletion Instructions</a> or by contacting <a href="mailto:ayotrix1@gmail.com" style="color: var(--accent-orange);">ayotrix1@gmail.com</a>.
    </p>
  `;
  return renderBaseHtml({ title: 'Privacy Policy', content });
}

function getTermsOfServiceHtml() {
  const content = `
    <h1>Terms of Service</h1>
    <span class="updated-date">Effective Date: August 2026</span>

    <p>
      Welcome to <strong>MarketingKart.ai</strong>. By accessing our mobile application or services, you agree to be bound by these Terms of Service.
    </p>

    <h2>1. Use of Services</h2>
    <p>
      MarketingKart.ai provides AI-powered digital ad creation, Meta ad publishing, lead CRM tools, and WhatsApp marketing tools. You agree to use these services only for lawful business purposes.
    </p>

    <h2>2. Meta Advertising Policies</h2>
    <p>
      Ads created through our platform must comply with Meta's Advertising Standards. We reserve the right to decline or halt campaigns that violate advertising guidelines.
    </p>

    <h2>3. Wallet and Payments</h2>
    <p>
      All wallet balances, subscriptions, and ad spend deposits are processed securely via registered payment gateways. Applicable taxes (GST) are charged as required by law.
    </p>

    <h2>4. Contact & Inquiries</h2>
    <p>
      For any inquiries regarding these terms, please contact <a href="mailto:ayotrix1@gmail.com" style="color: var(--accent-orange);">ayotrix1@gmail.com</a>.
    </p>
  `;
  return renderBaseHtml({ title: 'Terms of Service', content });
}

module.exports = {
  getDataDeletionInstructionsHtml,
  getDataDeletionStatusHtml,
  getPrivacyPolicyHtml,
  getTermsOfServiceHtml,
};
