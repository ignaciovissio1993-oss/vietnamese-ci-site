# Patreon Members-Only Setup (Cloudflare Pages)

This project uses Cloudflare Pages Functions to require a Patreon login for anything under `/members/`.

## 1) Create a Patreon OAuth app
1. Log in to Patreon with the creator account that owns your campaign.
2. Open the Patreon developer portal and go to **Clients & API Keys**.
3. Create a new client (OAuth app).
4. Copy the **Client ID** and **Client Secret**.

## 2) Redirect URL to use
Use this exact redirect URL in the Patreon app settings:

```
https://YOUR_SITE_DOMAIN/auth/callback
```

Replace `YOUR_SITE_DOMAIN` with your Cloudflare Pages domain (or your custom domain).

## 3) Environment variables in Cloudflare Pages
In your Cloudflare Pages project settings, add these environment variables (Production + Preview):

```
PATREON_CLIENT_ID=
PATREON_CLIENT_SECRET=
PATREON_REDIRECT_URI=https://YOUR_SITE_DOMAIN/auth/callback
PATREON_CAMPAIGN_ID=
SESSION_SECRET=
MEMBER_CACHE_SECONDS=300
```

Notes:
- `PATREON_CAMPAIGN_ID` is your Patreon campaign ID. You can find it in the Patreon API tools or by checking your campaign in the developer portal.
- `SESSION_SECRET` should be a long random string (32+ characters). This is used to sign the session cookie.
- `MEMBER_CACHE_SECONDS` controls how long membership status is cached in the session cookie before another Patreon membership API check (default `300`).

## 4) Deploy
1. Commit the new files.
2. Push to your repo.
3. Cloudflare Pages will build and deploy automatically.

## 5) Test
1. Open `https://YOUR_SITE_DOMAIN/members/` in a private/incognito window.
2. You should be redirected to `/auth/login` and then to Patreon.
3. After you approve access, you should land back on `/members/`.
4. If your Patreon account is not an active paying member, you will land on `/not-a-member.html`.
5. Visit `/auth/logout` to clear your session.

## Optional: Update the Not-a-member page
Edit `not-a-member.html` and change the Patreon link to your real campaign URL.
