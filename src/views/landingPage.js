/**
 * MarketingKart API Gateway Landing UI
 * High-performance, responsive dark-mode landing page for the core backend API.
 */
function getLandingHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MarketingKart API Gateway | All Systems Operational</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #090d16;
      --bg-secondary: #0e1526;
      --bg-card: rgba(18, 27, 49, 0.7);
      --bg-card-hover: rgba(28, 42, 74, 0.85);
      --border-color: rgba(255, 255, 255, 0.08);
      --border-glow: rgba(59, 130, 246, 0.3);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-blue: #3b82f6;
      --accent-cyan: #06b6d4;
      --accent-indigo: #6366f1;
      --accent-purple: #a855f7;
      --status-green: #10b981;
      --status-green-glow: rgba(16, 185, 129, 0.25);
      --gradient-brand: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%);
      --gradient-card: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%);
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 20px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      position: relative;
    }

    /* Ambient background glows */
    .ambient-glow-1 {
      position: absolute;
      top: -150px;
      left: 50%;
      transform: translateX(-50%);
      width: 750px;
      height: 450px;
      background: radial-gradient(circle, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.08) 50%, transparent 80%);
      filter: blur(80px);
      pointer-events: none;
      z-index: 0;
    }

    .ambient-glow-2 {
      position: absolute;
      bottom: 5%;
      right: 5%;
      width: 500px;
      height: 400px;
      background: radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, transparent 70%);
      filter: blur(90px);
      pointer-events: none;
      z-index: 0;
    }

    .container {
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
      position: relative;
      z-index: 1;
    }

    /* Header */
    header {
      padding: 24px 0;
      border-bottom: 1px solid var(--border-color);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(9, 13, 22, 0.85);
    }

    .header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo-container {
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      color: var(--text-primary);
    }

    .logo-icon {
      width: 42px;
      height: 42px;
      border-radius: var(--radius-sm);
      background: var(--gradient-brand);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 20px;
      color: #ffffff;
      box-shadow: 0 8px 24px rgba(59, 130, 246, 0.35);
    }

    .logo-text {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }

    .logo-badge {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(59, 130, 246, 0.15);
      color: var(--accent-blue);
      border: 1px solid rgba(59, 130, 246, 0.3);
      margin-left: 6px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      font-size: 13px;
      font-weight: 600;
      color: #34d399;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--status-green);
      box-shadow: 0 0 10px var(--status-green);
      animation: pulse 2s infinite ease-in-out;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.15); }
    }

    /* Hero Section */
    .hero {
      padding: 56px 0 40px;
      text-align: center;
    }

    .badge-sub {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 9999px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .hero-title {
      font-size: clamp(32px, 5vw, 54px);
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -1.2px;
      margin-bottom: 16px;
    }

    .gradient-text {
      background: var(--gradient-brand);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .hero-desc {
      font-size: clamp(15px, 2vw, 18px);
      color: var(--text-secondary);
      max-width: 680px;
      margin: 0 auto 32px;
      line-height: 1.6;
    }

    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      max-width: 960px;
      margin: 0 auto;
    }

    .stat-card {
      background: var(--bg-card);
      background-image: var(--gradient-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 16px 20px;
      text-align: left;
      backdrop-filter: blur(12px);
      transition: all 0.2s ease;
    }

    .stat-card:hover {
      border-color: var(--border-glow);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }

    .stat-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .stat-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Grid Section */
    .section-title {
      font-size: 22px;
      font-weight: 700;
      margin: 48px 0 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
    }

    .service-card {
      background: var(--bg-card);
      background-image: var(--gradient-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 24px;
      backdrop-filter: blur(12px);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.25s ease;
    }

    .service-card:hover {
      border-color: rgba(59, 130, 246, 0.4);
      background: var(--bg-card-hover);
      transform: translateY(-3px);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
    }

    .service-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    .service-icon {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
    }

    .service-status {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .service-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 6px;
    }

    .service-desc {
      font-size: 13.5px;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    /* Live API Test & Endpoints */
    .interactive-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 32px;
    }

    @media (max-width: 860px) {
      .interactive-grid {
        grid-template-columns: 1fr;
      }
    }

    .console-card {
      background: #060913;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .console-header {
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .console-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: 'JetBrains Mono', monospace;
    }

    .btn-ping {
      background: var(--accent-blue);
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }

    .btn-ping:hover {
      background: #2563eb;
      box-shadow: 0 0 12px rgba(59, 130, 246, 0.5);
    }

    .console-body {
      padding: 18px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: #38bdf8;
      overflow-x: auto;
      flex-grow: 1;
      white-space: pre-wrap;
      line-height: 1.5;
    }

    .endpoints-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .endpoint-item {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      transition: all 0.2s ease;
    }

    .endpoint-item:hover {
      border-color: var(--border-glow);
      background: var(--bg-card-hover);
    }

    .method-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px;
    }

    .method-get {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .method-post {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    .endpoint-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: var(--text-primary);
      flex-grow: 1;
    }

    .endpoint-desc {
      font-size: 12px;
      color: var(--text-muted);
    }

    .btn-copy {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      transition: all 0.2s;
    }

    .btn-copy:hover {
      color: var(--text-primary);
      border-color: var(--text-secondary);
    }

    /* Footer */
    footer {
      margin-top: auto;
      border-top: 1px solid var(--border-color);
      padding: 32px 0;
      background: rgba(9, 13, 22, 0.9);
      margin-top: 60px;
    }

    .footer-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .footer-links {
      display: flex;
      gap: 20px;
    }

    .footer-link {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.2s;
    }

    .footer-link:hover {
      color: var(--accent-blue);
    }
  </style>
</head>
<body>
  <div class="ambient-glow-1"></div>
  <div class="ambient-glow-2"></div>

  <header>
    <div class="container header-inner">
      <a href="/" class="logo-container">
        <div class="logo-icon">M</div>
        <div>
          <span class="logo-text">MarketingKart</span>
          <span class="logo-badge">Core Engine</span>
        </div>
      </a>
      <div class="header-actions">
        <div class="status-pill">
          <div class="status-dot"></div>
          <span>All Systems Operational</span>
        </div>
      </div>
    </div>
  </header>

  <main class="container">
    <section class="hero">
      <div class="badge-sub">
        <span>⚡ High Performance API Gateway</span>
        <span>•</span>
        <span id="liveClock">Loading Server Time...</span>
      </div>
      <h1 class="hero-title">
        Enterprise Marketing & <br/>
        <span class="gradient-text">Automation Cloud Gateway</span>
      </h1>
      <p class="hero-desc">
        Welcome to the core backend infrastructure powering MarketingKart. Orchestrating omnichannel ad campaigns, WhatsApp Cloud Business messaging, lead routing, and billing engines.
      </p>

      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">API Health</div>
          <div class="stat-value" style="color: #34d399;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            200 OK
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Environment</div>
          <div class="stat-value" style="color: #60a5fa;">Production</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Engine Uptime</div>
          <div class="stat-value">99.98%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Realtime Gateways</div>
          <div class="stat-value" style="color: #c084fc;">Socket.io Ready</div>
        </div>
      </div>
    </section>

    <h2 class="section-title">
      <span>Microservices & Engines</span>
    </h2>

    <div class="services-grid">
      <div class="service-card">
        <div>
          <div class="service-header">
            <div class="service-icon" style="color: #22c55e;">💬</div>
            <span class="service-status">Connected</span>
          </div>
          <h3 class="service-title">WhatsApp Cloud API</h3>
          <p class="service-desc">Official Meta Graph API messaging pipeline, interactive template sync, webhook events, and multi-agent inbox.</p>
        </div>
      </div>

      <div class="service-card">
        <div>
          <div class="service-header">
            <div class="service-icon" style="color: #3b82f6;">🎯</div>
            <span class="service-status">Active</span>
          </div>
          <h3 class="service-title">Ad Automation & AI</h3>
          <p class="service-desc">Multi-channel campaign deployment, AI poster & creative generations, budget tracking, and real-time CTR analytics.</p>
        </div>
      </div>

      <div class="service-card">
        <div>
          <div class="service-header">
            <div class="service-icon" style="color: #f59e0b;">👥</div>
            <span class="service-status">Operational</span>
          </div>
          <h3 class="service-title">Lead Assignment Engine</h3>
          <p class="service-desc">Smart auto-assignment algorithms, CRM pipeline management, follow-up scheduler, and role-based staff permissions.</p>
        </div>
      </div>

      <div class="service-card">
        <div>
          <div class="service-header">
            <div class="service-icon" style="color: #ec4899;">💳</div>
            <span class="service-status">Operational</span>
          </div>
          <h3 class="service-title">Billing & Wallet Gateway</h3>
          <p class="service-desc">Instant payment reconciliation, automated GST invoice generation, Razorpay/PhonePe integrations, and wallet top-ups.</p>
        </div>
      </div>

      <div class="service-card">
        <div>
          <div class="service-header">
            <div class="service-icon" style="color: #a855f7;">⚡</div>
            <span class="service-status">Live</span>
          </div>
          <h3 class="service-title">Socket.io Push Stream</h3>
          <p class="service-desc">Bidirectional real-time event distribution for live campaign stats, WhatsApp incoming messages, and urgent alerts.</p>
        </div>
      </div>

      <div class="service-card">
        <div>
          <div class="service-header">
            <div class="service-icon" style="color: #06b6d4;">🛡️</div>
            <span class="service-status">Protected</span>
          </div>
          <h3 class="service-title">Security & Rate Limiting</h3>
          <p class="service-desc">JWT session validation, CORS isolation, payload encryption, automated crash recovery, and health probes.</p>
        </div>
      </div>
    </div>

    <h2 class="section-title">
      <span>Live Health & Endpoints Explorer</span>
    </h2>

    <div class="interactive-grid">
      <div class="console-card">
        <div class="console-header">
          <div class="console-title">
            <span>GET /health</span>
          </div>
          <button class="btn-ping" id="btnPing" onclick="triggerPing()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Live Ping
          </button>
        </div>
        <div class="console-body" id="consoleOutput">{
  "status": "ok",
  "message": "MarketingKart API Gateway is running",
  "version": "1.0.0",
  "environment": "production",
  "timestamp": "${new Date().toISOString()}"
}</div>
      </div>

      <div class="endpoints-list">
        <div class="endpoint-item">
          <span class="method-tag method-get">GET</span>
          <span class="endpoint-path">/</span>
          <span class="endpoint-desc">Landing & API Gateway</span>
          <button class="btn-copy" onclick="copyPath('/')">Copy</button>
        </div>
        <div class="endpoint-item">
          <span class="method-tag method-get">GET</span>
          <span class="endpoint-path">/?format=json</span>
          <span class="endpoint-desc">JSON Health Payload</span>
          <button class="btn-copy" onclick="copyPath('/?format=json')">Copy</button>
        </div>
        <div class="endpoint-item">
          <span class="method-tag method-post">POST</span>
          <span class="endpoint-path">/api/user-login</span>
          <span class="endpoint-desc">Authentication Gateway</span>
          <button class="btn-copy" onclick="copyPath('/api/user-login')">Copy</button>
        </div>
        <div class="endpoint-item">
          <span class="method-tag method-get">GET</span>
          <span class="endpoint-path">/api/all-business</span>
          <span class="endpoint-desc">Business Directory</span>
          <button class="btn-copy" onclick="copyPath('/api/all-business')">Copy</button>
        </div>
        <div class="endpoint-item">
          <span class="method-tag method-post">POST</span>
          <span class="endpoint-path">/api/whatsapp/send</span>
          <span class="endpoint-desc">WhatsApp Messaging</span>
          <button class="btn-copy" onclick="copyPath('/api/whatsapp/send')">Copy</button>
        </div>
      </div>
    </div>
  </main>

  <footer>
    <div class="container footer-inner">
      <div>
        © ${new Date().getFullYear()} MarketingKart Technologies. All rights reserved.
      </div>
      <div class="footer-links">
        <a href="/?format=json" class="footer-link">JSON Status</a>
        <a href="https://github.com/prince62058/MarketingKart-BAckend" target="_blank" class="footer-link">GitHub Repository</a>
      </div>
    </div>
  </footer>

  <script>
    function updateClock() {
      const now = new Date();
      const istTime = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      document.getElementById('liveClock').textContent = 'IST ' + istTime;
    }
    updateClock();
    setInterval(updateClock, 1000);

    async function triggerPing() {
      const btn = document.getElementById('btnPing');
      const out = document.getElementById('consoleOutput');
      btn.textContent = 'Pinging...';
      const t0 = performance.now();
      try {
        const res = await fetch('/?format=json');
        const json = await res.json();
        const t1 = performance.now();
        json.latency = Math.round(t1 - t0) + 'ms';
        out.textContent = JSON.stringify(json, null, 2);
      } catch (err) {
        out.textContent = JSON.stringify({ status: 'error', message: err.message }, null, 2);
      } finally {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Live Ping';
      }
    }

    function copyPath(path) {
      navigator.clipboard.writeText(window.location.origin + path);
      alert('Copied: ' + window.location.origin + path);
    }
  </script>
</body>
</html>`;
}

module.exports = { getLandingHtml };
