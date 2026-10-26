# DragonExchange

A simple starter for a Drexel student auction marketplace, using Express and plain HTML, CSS, and JavaScript.

## Run locally

```bash
npm install
npm start
```

Open **http://localhost:3000**. Press Ctrl+C to stop. Use `npm run dev` to restart automatically when server files change.

## Pages

- Home: `public/index.html`
- Sell: `public/auctions/create.html`
- Dashboard: `public/account/dashboard.html`
- Profile: `public/account/profile.html`
- Login: `public/auth/login.html`
- Registration (linked from Login): `public/auth/register.html`

Shared styles and JavaScript live in `public/assets/`. Express serves `public/` as the website root and uses `public/404.html` for missing pages. Backend files stay outside `public/`.

Listings and profile details are sample data. The sell, login, and registration forms show placeholder messages; they do not submit or save anything. Authentication, bidding, and payments still need implementation.

The pages run without a database or `.env` file. To enable the existing database and session setup later, copy `.env.example` to `.env` and fill in `DATABASE_URL` and `SESSION_SECRET`. `PORT` defaults to `3000`.

`/health` checks the server. `/health/db` checks the database when configured.
