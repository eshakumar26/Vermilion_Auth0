# Auth0 tenant configuration

This document describes how I configured the Auth0 tenant behind **Vermilion**, an art marketplace made up of two apps: **Vermilion Studio** (the Baseline App, where artists show their work) and **Vermilion Payouts** (the Sensitive App, where they manage their earnings). I set everything up in the Auth0 dashboard. Following these steps in order recreates the tenant.

For each step I note where the setting is, what I set, the decision behind it, and anything I ran into along the way. The tenant name and URLs are from my tenant in Auth0.

## Contents
1. Before I started
2. Tenant
3. The two applications
4. Login: passkey or password
5. Multi-factor authentication (MFA)
6. The Action (my login rules)
7. Running the apps locally
8. How I checked it works
9. Problems I ran into
10. What I'd change for production

---

## 1. Before I started

- **Node.js and npm:** I used Node 20.12.1 and npm 10.5.0. Auth0's Express quickstart needs Node 18 or newer. Check with `node -v` and `npm -v`.
- **An authenticator app** on my phone (Auth0 Guardian) to test MFA.
- **Test email addresses** (for example `artist1@example.com`.

---

## 2. Tenant

### 2.1 Signing up
- **Where:** auth0.com, then Sign up
- **What I set:** Account type: Personal. Country and state: US, TN.
- **What I ran into:** later, I signed in to the dashboard with "Continue with Google" using the same email, and my apps had disappeared. Each sign-in method is a separate dashboard account, so I always sign in with **email and password**.

### 2.2 Creating the tenant
- **Where:** the sign-up screen
- **What I set:** I left "I need advanced settings" unchecked, so Auth0 assigned the name `dev-dbkz3kyytfvcym68`. Region: **US**. Environment tag: **Development**.
- **Decision:** I kept the auto-assigned name rather than choosing one. The name doesn't change how anything works, I only need one tenant, and no users or passkeys were tied to it yet. I chose the US region because I'm in the US and have no EU or UK data rules to meet. For a production tenant I'd choose the name deliberately and set up a custom domain before rolling out passkeys.
- **What I ran into:** the sign-up screen looked like a simple profile form, but it also created my tenant. Only afterwards did I learn that tenant names can never be changed.

### 2.3 Protecting my own dashboard login
- **What I set:** I turned on MFA for my own Auth0 dashboard account, using Auth0 Guardian.
- **Why:** whoever controls the dashboard controls every setting in this document.
- **In production:** In production, I'd definitely set-up MFA. In dev, I still wanted to use it to make my account secure.

### 2.4 Tenant domain
- **Where:** any application's **Settings** tab, under **Domain**
- **Value:** `dev-dbkz3kyytfvcym68.us.auth0.com`. Both apps use it as `ISSUER_BASE_URL=https://dev-dbkz3kyytfvcym68.us.auth0.com`.

### 2.5 Plan and trial
- **What I set:** nothing. The tenant is on a Free plan with 22-day trial of paid features.
- **Why it matters:** passkeys and passwords are included in the Free plan. Authenticator-app codes for step-up are a paid MFA feature, which works during the trial.
- **What I ran into:** before signing up, I checked whether the Free plan covers what the brief needs. The pricing table marks "Cross APP SSO" as not included on Free, while an Auth0 team answer in the community says SSO between two apps works on Free. The trial covered everything I needed either way.

### 2.6 Session lifetime
- **Where:** Settings > Advanced > Login Session Management
- **What I set:** I left the defaults.
- **Why:** in testing, I noticed both apps were still logged in after an hour of no activity. There isn't one session but three: each app's own cookie, Auth0's session, and any upstream identity provider. Shortening only Payouts' session wouldn't help, because Auth0 would log the artist straight back in through SSO. So Payouts enforces its own idle lock in code, and the tenant keeps its defaults.

---

## 3. The two applications

I registered two separate applications on the same tenant, so that SSO between them is real: Auth0 recognizes the artist across two different apps, each with its own client ID.

| | Vermilion Studio (Baseline App) | Vermilion Payouts (Sensitive App) |
|---|---|---|
| Runs at | `http://localhost:3000` | `http://localhost:3001` |
| Allowed Callback URLs | `http://localhost:3000/callback` | `http://localhost:3001/callback` |
| Allowed Logout URLs | `http://localhost:3000/signed-out` | `http://localhost:3001/signed-out` |

I did steps 3.1 to 3.6 once for each app.

### 3.1 Creating the application
- **Where:** Applications > Applications > **Create Application**
- **What I set:** Name: `Vermilion Studio` (then `Vermilion Payouts`). Type: **Regular Web Applications**. Technology: **Express**. When the quickstart asked for an application origin, I entered `http://localhost:3000` (Payouts: `http://localhost:3001`). I checked port 3000 was free with `lsof -i :3000`, and kept 3001 for Payouts so both apps can run side by side.
- **Decision (app type):** I chose a Regular Web Application for both apps over a single-page app or one of each. The server enforces step-up before the sensitive operation runs, so changing code in the browser can't bypass it. Tokens stay on the server, so the browser only holds a session cookie. It also meant no separate API to build. The trade-off: I need a running server, and it doesn't showcase checking an access token at an API.
- **Decision (stack):** Express with Auth0's stable Express SDK (`express-openid-connect`) for both apps. Each app can be one small file I can explain line by line, and the SDK creates the login, logout and callback routes for me. I chose the stable SDK over Auth0's newer beta Express SDK, trading the newest features for a reliable live demo.

### 3.2 URLs
- **Where:** the application's **URLs** tab
- **What I set:** the Callback and Logout URLs from the table above.
- **Decision:** both apps require login on their main pages, so neither has a public home page. A public page with a Log in button would never ask Auth0, so an artist already logged into the other app would still see a login prompt, which breaks SSO. Each app has a public **Signed out** page to land on after logout. Logging out of Payouts lands on Payouts' own page, not Studio's: Studio keeps its own session, and its Signed out page would send the artist straight back to the dashboard.
- **What I ran into:** Auth0's docs still say these settings are under Settings > Application URIs, but the dashboard had moved them to the URLs tab. For `localhost`, Auth0 also warned that it was turning off "Non-Verifiable Callback URI Confirmation", which is expected for local development.

### 3.3 Credentials
- **Where:** the application's **Credentials** tab
- **What I set:** Authentication Method: **Client Secret (Post)**. I copied the Client Secret into that app's `.env` as `CLIENT_SECRET` (section 7). It is never committed or shown on screen.
- **Decision:** I switched both apps from the quickstart's default flow to the **authorization code flow**, with a client secret per app. The quickstart's flow over `http` only works if a login finishes within about 2 minutes, and a live sign-up with QR scanning, or a step-up during panel questions, could take longer. The code flow removes that limit and is the flow Auth0 recommends for regular web apps. The trade-off: each app now has a client secret to protect. I chose this over running local `https` (certificates and new URLs everywhere) and over keeping the old flow and rehearsing fast logins.
- **What I ran into:** the SDK warned at startup about the old flow over `http`, which is how I found the 2-minute limit. Without `CLIENT_SECRET` the app refuses to start. If the method doesn't match what the app sends, login fails at `/callback` with 400 "Unauthorized".

### 3.4 Connections
- **Where:** the application's **Connections** tab
- **What I set:** `Username-Password-Authentication` **on**, `google-oauth2` **off**.
- **Decision:** I turned Google off for both apps. The brief asks for a password or a passkey, and with Google login, Google does the authenticating, which is neither. Google login on a new tenant also runs on Auth0's shared test keys, which Auth0's docs say are for testing only and can cause errors with MFA and redirects. Both apps use the **same** connection, which is what lets Auth0 recognize the artist in both (SSO).
- **What I ran into:** my very first test sign-up went through Google without me realizing it; the user ID started with `google-oauth2`. That's when I turned it off.

### 3.5 Client ID
- **Where:** the application's **Settings** tab
- **What I set:** I copied the Client ID into that app's `.env` as `CLIENT_ID`. It isn't secret.

### 3.6 Everything else
- **What I set:** I left the defaults. Under Settings > Advanced Settings > Grant Types, **Authorization Code** must stay ticked for the code flow.

---

## 4. Login: passkey or password

Passkeys on Auth0 have prerequisites: Universal Login, Identifier First, no custom login page, "Requires Username" off and "Use my own database" off. This section covers all of them.

**Decision:** the brief says users must be able to authenticate with "either a passkey or a password". That can be read two ways, so I offer **both** and let each artist choose. That satisfies either reading, covers artists whose devices can't use passkeys, and let me demo both. The trade-off: two paths to test, and password users can be phished, which is one more reason step-up matters.

### 4.1 Identifier First
- **Where:** Authentication > **Authentication Profile**
- **What I set:** **Identifier First**. The artist enters their email, then Auth0 offers a password or a passkey.
- **Why:** passkeys require it.

### 4.2 Universal Login, no custom login page
- **Where:** Branding > Universal Login > Manage Classic Login > Login
- **What I set:** **Custom Login Page** off (the default).
- **Why:** passkeys need Auth0's hosted login page, and it also keeps passwords and passkeys away from my apps entirely.

### 4.3 The database connection
- **Where:** Authentication > Database > `Username-Password-Authentication`
- **What I set:**
  - **Requires Username:** off
  - **Disable Sign Ups:** off, so artists can sign up
  - **Custom Database** tab > **Use my own database:** off
- **Why:** passkeys work on Auth0's own user store, with email as the identifier.

### 4.4 Passkeys
- **Where:** the same connection > **Authentication Methods** > **Passkey** > Configure
- **What I set:** Passkey **on**, and **Progressive Enrollment unticked**. Everything else is left at the defaults.
- **Decision:** I turned off Auth0's "offer a passkey after a password login" (progressive enrollment). The brief only requires that artists *can* use either factor, and both are available at sign-up. The extra prompt adds a screen to every password login, which adds noise to the flows I needed to prove first: SSO and step-up. The trade-off: password users aren't nudged toward the stronger, phishing-resistant option. With more time I'd turn it back on.
- **Decision (passkey recovery):** for an artist on a new device or without their passkey, I rely on what's built in: synced passkeys travel with the artist's Apple or Google account, and "use a phone" covers a nearby phone through a QR code. I didn't build a separate recovery flow; it's a significant piece of work and not part of the brief.
- **What I ran into:** Auth0 ticks progressive enrollment **by default** when you turn passkeys on. I only noticed when "Create a passkey" appeared during a password login. Also, after clicking "Continue without passkeys" at sign-up, there's no Back link to return to the passkey option.

### 4.5 Password stays on
- **What I set:** I left **Password** enabled on the same connection.
- **Why:** Auth0 requires a password option alongside passkeys, and the brief wants both.

### 4.6 Email verification
- **What I set:** nothing. Auth0 emails a verification link at sign-up by default, but doesn't block login if it isn't clicked.
- **Why:** the brief doesn't require it. In production I'd require a verified email before payout changes (section 10)

---

## 5. Multi-factor authentication (MFA)

Everything in this section is under **Security > Multi-factor Auth**, except 5.5.

### 5.1 Factors
- **What I set:**
  - **One-time Password: on**
  - **Recovery Code: on**
  - **Email: off**
  - All other factors: off
- **Decision (which factor):** I chose an **authenticator-app code** for step-up, with **recovery codes** as the backup if an artist loses their phone. I compared every factor Auth0 supports on brief compliance, security, independence from the first factor, demo reliability and effort:
  - **Authenticator app:** runs on a separate device (the artist's phone) for both password and passkey users, works offline, needs no hardware, and setup is a single QR scan. Its weakness: a code can be phished in real time.
  - **Device biometrics:** phishing-resistant, but for a passkey user it's the same laptop and the same fingerprint as the login, so it isn't meaningful extra proof.
  - **Security key:** the strongest option, but it needs hardware.
  - **Push:** risks "MFA fatigue" (approving prompts without looking) and depends on notifications arriving during a live demo.
  - **SMS and voice:** vulnerable to SIM swapping.
  - **Email:** excluded by the brief.
- **Why email stays off:** besides the brief, my Action asks Auth0 for "any" enrolled factor, so turning Email on here could let it be offered at step-up.

### 5.2 Policy
- **What I set:** Require Multi-factor Auth: **Never**
- **Decision:** I don't ask for MFA when logging in to either app.
  - **Studio** is low-risk: someone with a stolen password can see artworks and sales, but can't move money.
  - **Payouts** is entered with one factor too. An MFA prompt when arriving from Studio would be a login prompt, which breaks SSO. MFA at the door also doesn't stop someone who steals the session after the door.
  - Instead, the extra proof goes **at the moment of risk**: changing the payout account. Turning MFA to "Always" would ask for a code on every login and still not protect that moment.
- **How MFA does happen:** through Auth0's documented step-up pattern. Payouts asks Auth0 for MFA with a standard OpenID Connect request (`acr_values`), my Action sees the request and requires the code, and Payouts checks the signed ID token to confirm MFA happened. The only other MFA moment is setting up the authenticator at sign-up.

### 5.3 Additional Settings
- **What I set:** **Customize MFA Factors using Actions: on**
- **Why:** my Action needs this to set up the authenticator app and to see which factors an artist has. Without it, the Action can't see anyone's authenticator, and every payout change is refused.

### 5.4 Remember browser
- **What I set:** the option to skip MFA on trusted or remembered browsers is **off**.
- **Decision:** every payout change asks for a **fresh** code, even if the artist already did MFA earlier in the session, and there's no "remember this browser" option. The brief says step-up applies "even for a user with an already-active session", and a stolen remember-me cookie could otherwise skip the code. My Action also turns this off for step-up (`allowRememberBrowser: false`).
- **What I ran into:** Auth0's docs don't say plainly whether step-up asks again when the session already has MFA, so I turned it into a test instead of assuming. The test confirmed that Auth0 asks for a new code on every step-up.

---

## 6. The Action (my login rules)

All of my MFA logic lives in one post-login Action. It runs **inside Auth0** after every login for both apps: a real login, an SSO visit, and step-up. The apps only ask; the Action decides. The code is in `auth0/actions/vermilion-login-rules.js` in this repo.

### 6.1 Creating it
- **Where:** Actions > Library > **Create Action** > Build from scratch
- **What I set:** Name: `Vermilion Login rules`. Trigger: **Login / Post Login**. Runtime: **Node 22**. Auth0 recommends Node 22, and Node 18 is end of life.

### 6.2 Code and deploy
- **What I did:** pasted the contents of `auth0/actions/vermilion-login-rules.js` and clicked **Deploy**. It needs no secrets and no extra packages.

### 6.3 Attaching it to the login flow
- **Where:** Actions > Triggers > **post-login**
- **What I did:** dragged `Vermilion Login rules` between **Start** and **Complete**, then clicked **Apply**.
- **What I ran into:** this cost me about 15 minutes. I deployed the Action and assumed it was running, but deploying alone doesn't attach it. Logins still worked, so nothing looked broken. Then Studio's Developer view said "not available yet", and new artists weren't asked to set up an authenticator. Nothing on the Action's page said it wasn't attached to any trigger. It only ran after I attached it here.

### 6.4 What it decides

The Action makes three checks, **in this order**:

1. **Payouts asks for step-up, and the artist has no authenticator → deny.** Payouts then shows: "For your security, payout changes require two-step verification, which isn't set up on this account. Please contact support."
   - **Decision:** step-up never offers setup. Offering it there opens an "enrollment hijack": someone with a stolen session clicks "Change payout account", gets offered setup, scans the QR code with *their own* phone, and passes. Artists set up their authenticator at sign-up instead, the one moment we're sure it's really them. The trade-off is one extra sign-up step of about 30 to 60 seconds.
2. **Payouts asks for step-up → ask for a fresh code**, with no "remember this browser" option.
   - **Decision:** passkey users also enter the code. The brief makes no exception for them, a passkey protects the login but not the session cookie afterwards, and Auth0 doesn't treat a passkey as an independent MFA factor.
3. **The artist has no authenticator yet, and typed a password or used a passkey in the last 60 seconds → set up the authenticator now** (the QR screen).
   - **Decision:** this covers sign-up, and it **repeats on every fresh login until setup is done**. It never happens on an SSO visit, because there the password or passkey was entered long ago, and an SSO visit is exactly what someone with stolen cookies could trigger.
   - **What I ran into:** my first version only offered setup on the account's *first* login. When I tested closing the tab at the QR screen, the next login skipped setup entirely, because Auth0 had already counted the abandoned login. That artist could never have changed their payouts. I changed the rule to "any fresh login until setup is done", tested it against 12 simulated logins, then re-tested it live.

**Anything else** (a normal login or an SSO visit): nothing extra. One factor is enough for everyday screens.

On every login, the Action also adds **how the artist logged in** (password or passkey) to the ID token, which both apps show in their Developer view.

**One related rule in Payouts:** setting up the authenticator at sign-up already marks the artist's Auth0 session as "MFA done". So Payouts only counts a step-up when the token answers **its own** step-up request, and records its own time. Otherwise, a brand-new artist could skip step-up.

### 6.5 Checking it's running
- **Where:** Monitoring > Logs > newest **Success Login** > **Action Details**
- **What I see:** one line per login, like `{"decision":"enroll_authenticator", ...}`.
- **Decision:** I log one line per login with the decision and the login facts (method names and true/false values), and never emails, names or tokens. It gives me evidence for each decision and fast debugging, without personal data in the logs. The Free plan keeps logs for a short time, so I screenshot evidence I want to keep.

---

## 7. Running the apps locally

### 7.1 Install
```
cd studio && npm install
cd ../payouts && npm install
```
- **Decision:** `package.json` lists every library the code uses (`express`, `express-openid-connect`, `dotenv`, `escape-html`), pinned to **Express 4**. Express 4 is the version the Auth0 SDK's own tests run on and the version in Auth0's docs example, so I removed one unknown before building SSO and step-up. The trade-off: production would eventually need an upgrade to Express 5.
- **What I ran into:** following the quickstart exactly, my first run crashed with `Cannot find module 'dotenv'`. The quickstart's install step installs only the SDK, but its own code uses four libraries, and Express 5 had arrived only as a side effect of installing the SDK.

### 7.2 Each app's `.env`
In **each** of `studio/` and `payouts/`:
```
cp .env.example .env
```
Then fill in:

| Key | Where it comes from |
|---|---|
| `ISSUER_BASE_URL` | `https://` plus the tenant domain (2.4) |
| `CLIENT_ID` | that app's Settings tab (3.5) |
| `CLIENT_SECRET` | that app's Credentials tab (3.3). **Secret** |
| `SECRET` | a random key that encrypts the app's own session cookie: `openssl rand -hex 32`, a **different** one per app |
| `BASE_URL`, `PORT` | already filled in: `3000` for Studio, `3001` for Payouts |
| `PAYOUTS_URL` (Studio), `STUDIO_URL` (Payouts) | already filled in: where "Go to Payouts" and "Back to Studio" point |

- **Decision:** each app has its **own session cookie name** (`studioSession` and `payoutsSession`) and its **own `SECRET`**. Browsers share cookies across ports on the same host, and the SDK gives every app the same cookie name by default, so the two apps would overwrite each other's sessions. Separate names and keys keep them apart, and SSO comes from Auth0's session, not a shared cookie.
- **What I ran into:** I first assumed the quickstart's `SECRET` was my Auth0 client secret. It isn't. `SECRET` is a key only my app knows, for its own cookie, while `CLIENT_SECRET` comes from Auth0 and was only needed once I switched to the code flow. `.env` is git-ignored and never committed.

### 7.3 Payouts settings (optional, defaults shown)

| Key | Default | What it controls |
|---|---|---|
| `STEP_UP_MAX_AGE_MINUTES` | `10` | how long a verification stays usable |
| `PAYOUT_HOLD_DAYS` | `5` | how long payouts pause after the payout account changes |
| `PAYOUTS_IDLE_MINUTES` | `15` | how long Payouts can sit idle before asking for a password or passkey again |

- **Decision (one change per verification, within 10 minutes):** without a rule, the proof would last as long as the session (up to a day of activity), so a stolen session hours later could change payouts with no prompt. Each verification covers **one** change, which leaves nothing for an attacker to ride. The 10 minutes only needs to cover filling in the form. **Cancel** throws the verification away, so the next change asks for a new code. The server checks the verification both when the form opens and when Save is submitted, because buttons and dialogs are just screens: someone could type the form's address or send the Save request directly.
- **Decision (5-day payout hold):** if an attacker still gets one change through, for example by phishing a code in real time, payouts pause for 5 days and the artist is told: "Not you? Contact support." No money leaves before the artist notices, and they can still change the account back. Patreon holds payouts for 5 days after payout details change. I chose a hold over locking further changes, because a lock would block the real artist from undoing an attacker's change.
- **Decision (15-minute idle lock, Payouts only):** an unattended laptop still showed earnings and the payout account, so the sensitive app is stricter than the baseline app. To stop SSO from quietly logging the artist back in, Payouts compares the login time in Auth0's signed ID token with the artist's last activity, which it keeps on the server. If there's been no password or passkey since then, Payouts sends the artist to Auth0's login screen. The trade-off: coming back to an idle Payouts from Studio shows a login screen, which can look like SSO broke.

### 7.4 Starting both apps (two Terminal windows)
```
cd studio && node app.js     # prints: Vermilion Studio on http://localhost:3000
cd payouts && node app.js    # prints: Vermilion Payouts on http://localhost:3001
```

---

## 8. How I checked it works

I wrote and ran a 48-case test plan. This 5-minute check covers the core of the brief:

| # | What I did | What I saw | What it proves |
|---|---|---|---|
| 1 | Opened `http://localhost:3000` in a private window | Email box and "Continue with a passkey", no Google | Login settings |
| 2 | Signed up with a new test email (once with a password, once with a passkey) | QR setup screen, then the Studio dashboard. Developer view: "Logged in with: password" (or "passkey") | First factor, and the Action at sign-up |
| 3 | Clicked **Go to Payouts** | No login screen, and the **same** "Logged in at" in both apps | SSO |
| 4 | Clicked **Change payout account**, then Continue | Auth0 asked for the 6-digit code, with no email option and no "remember this browser" | Step-up, no email |
| 5 | Entered the code, then routing `021000021` and account `000123459921`, and saved | Success page, with payouts on hold for 5 days | Server check on Save, and the payout hold |
| 6 | Clicked Change again straight away | Asked for a new code | One change per verification |
| 7 | Monitoring > Logs > Action Details | One decision line per login | The Action's audit trail |

---

## 9. Problems I ran into

| What I saw | Cause | Fix |
|---|---|---|
| My apps "disappeared" from the dashboard | I'd signed in with Google instead of email and password | 2.1 |
| "Create a passkey" after every password login | Progressive enrollment is on by default | 4.4 |
| Developer view: "not available yet"; no QR at sign-up | The Action was deployed but not attached | 6.3 |
| An artist who closed the QR screen was never asked again | My first version of the Action | 6.4 |
| App crashed: `Cannot find module 'dotenv'` | The quickstart's install step misses libraries its own code uses | 7.1 |
| SDK warning about the login flow over `http` | The quickstart's default flow has a ~2-minute limit over `http` | 3.3 |
| "Callback URL mismatch" | URL doesn't match exactly (port, `/callback`, a stray `/`) | 3.2 |
| App won't start, or 400 "Unauthorized" at `/callback` | Client secret missing, or the method isn't Client Secret (Post) | 3.3 |
| Every payout change: "contact support", despite an authenticator | "Customize MFA Factors using Actions" is off | 5.3 |
| Still logged in after an hour of no activity | Three separate session layers, all with long defaults | 7.3 |

**Resetting an artist's authenticator** for testing: User Management > Users > the artist > Multi-factor, then remove it. Their next fresh login shows the QR setup again.

---

## 10. What I'd change for production

- **A custom domain, set before passkeys,** since passkeys are tied to the login domain.
- **Real `https` URLs**, with the `localhost` URLs removed from both applications.
- **Tenant configuration as code** (Auth0 Deploy CLI or Terraform), so the dashboard and the repo can't drift apart. My repo copy of the Action did drift once.
- **A paid plan with Pro MFA**, so authenticator-app step-up keeps working after the trial.
- **A verified email required before payout changes**, so the "Not you?" alert reaches an inbox the artist has proven they own.
- **Progressive enrollment back on**, to move password users toward passkeys.
- **Secrets in a secrets manager**, rotated regularly, with fresh cookie keys for every environment.
