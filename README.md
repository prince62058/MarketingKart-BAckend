# LeadKart Backend

Node.js / Express API — Meta Ads, WhatsApp Marketing, wallet, webhooks.

## Setup

```bash
npm install
cp env.example .env
# fill real values in .env

cp src/config/firebase.json.example src/config/firebase.json
# paste Firebase service-account JSON

npm start
```

- Entry: `src/server.js` (root `server.js` just requires it for Plesk-style hosts)
- Env keys: see `env.example`

## Structure

```
src/
  app.js server.js
  config/ controllers/ helpers/ middlewares/
  models/ queues/ routes/ services/
  startup/ utils/ workers/ Message/
```
