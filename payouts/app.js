/* =====================================================================
   VERMILION PAYOUTS  ·  the Sensitive App  ·  http://localhost:3001
   Where the artist sees their next payout and the bank account it goes
   to. One operation is sensitive: "Change payout account". It
   represents protecting where the artist's money goes: if an attacker
   changes it, the next payout goes to them (payout redirection).

   How the pieces fit:
   - Getting IN to Payouts needs one factor (password or passkey), and
     usually happens through SSO from Studio with no login screen.
   - "Change payout account" needs STEP-UP: a fresh 6-digit code from
     the artist's authenticator app, every time, even with an active
     session (the brief). Payouts asks Auth0 for MFA with the standard
     OpenID Connect parameter acr_values; the Auth0 Action ("Vermilion
     login rules") sees it and requires the code.
   - Idle lock (D-038): after 15 minutes with no activity in Payouts,
     Payouts' session ends and the artist must enter their password or
     passkey again. SSO can't quietly log them back in (Block 4b).
     Studio is not affected.
   - Payouts keeps its OWN record of each verification: single-use,
     valid for 10 minutes (D-020, D-026), recorded only when the token
     answers Payouts' own step-up request (D-033), and checked again on
     the server when Save is pressed (D-025).
   ===================================================================== */


/* Block 1: Load settings and libraries
   - dotenv reads the .env file into process.env (secrets stay out of
     the code and out of GitHub).
   - express is the web server.
   - auth plugs Auth0 login into the app (Block 4); requiresAuth()
     guards a page: no session -> sent to Auth0's login page first.
   - escape-html makes any text safe before it goes into a page (so a
     name like <script> shows as text instead of running).
   - crypto (built into Node) makes a random ID for each step-up
     request (Block 11). */
require('dotenv').config();
const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');
const escape = require('escape-html');
const crypto = require('crypto');


/* Block 2: Create the web app
   express.urlencoded() lets the app read submitted forms (the change
   form and the dialog's Continue button). */
const app = express();
app.use(express.urlencoded({ extended: false }));


/* Block 3: Settings used across the app
   - STEP_UP_ACR: the standard value that means "this login must include
     multi-factor proof". Auth0's step-up guide uses exactly this value,
     and the Auth0 Action looks for it.
   - CLAIM_NAMESPACE: custom claims the Action adds to the ID token
     (here: how the artist logged in). Same name Studio reads.
   - STEP_UP_MAX_AGE_MINUTES: how long a verification stays usable
     (D-020: 10 minutes; it only needs to cover filling in the form).
   - STUDIO_URL: where "Back to Studio" goes.
   - PAYOUT_HOLD_DAYS: after the payout account changes, payouts pause
     for this many days (D-037; Patreon holds payouts for 5 days).
   - PAYOUTS_IDLE_MINUTES: how long Payouts can sit with no activity
     before the artist must log in again (D-038: 15 minutes). Set it to 1
     in .env to test without waiting. */
const STEP_UP_ACR = 'http://schemas.openid.net/pape/policies/2007/06/multi-factor';
const CLAIM_NAMESPACE = 'https://vermilion.demo/';
const STEP_UP_MAX_AGE_MINUTES = Number(process.env.STEP_UP_MAX_AGE_MINUTES || 10);
const STEP_UP_MAX_AGE_MS = STEP_UP_MAX_AGE_MINUTES * 60 * 1000;
const STUDIO_URL = process.env.STUDIO_URL || 'http://localhost:3000';
const PAYOUT_HOLD_DAYS = Number(process.env.PAYOUT_HOLD_DAYS || 5);
const PAYOUTS_IDLE_MINUTES = Number(process.env.PAYOUTS_IDLE_MINUTES || 15);
const IDLE_MS = PAYOUTS_IDLE_MINUTES * 60 * 1000;

/* Where Payouts' session lives: the SDK keeps each app's session on the
   request under the app's own cookie name (req.payoutsSession here, not
   the SDK's default req.appSession). sessionOf() is the one place that
   knows this, so every page reads the same session. */
const SESSION_NAME = 'payoutsSession';
function sessionOf(req) {
  return req[SESSION_NAME];
}


/* Block 4: Plug Auth0 into the app
   Same settings as Studio, with Payouts' own values:
   - session.name 'payoutsSession' and transactionCookie.name
     'payouts_auth_verification': both apps run on localhost and
     browsers share localhost cookies across ports, so each app needs
     its own cookie names or they overwrite each other (D-016).
   - secret: Payouts' OWN cookie-encryption key (not Studio's).
   - clientSecret + clientAuthMethod 'client_secret_post' +
     response_type 'code' / response_mode 'query': the authorization
     code flow (D-036). Auth0 sends back a one-time code as a normal
     redirect, and Payouts' server swaps it for tokens, proving itself
     with the client secret in the request body ("Post", matching the
     Credentials tab in Auth0). No 2-minute http limit.
   - max_age: same as Studio, so the ID token carries auth_time and
     both apps can show the same "Logged in at" (the SSO proof).
   - routes.postLogoutRedirect '/signed-out': Payouts' OWN signed-out
     page (D-031). It must be in Payouts' Allowed Logout URLs.
   - session rolling + rollingDuration (D-038): every request to Payouts
     pushes the session's end out by PAYOUTS_IDLE_MINUTES. With no
     requests for that long, the session ends (the SDK refuses it and the
     browser drops the cookie). absoluteDuration: 7 days at most, however
     active the artist is (the SDK's default, written out here).
     Studio keeps the SDK's defaults (1 day idle, 7 days max).

   getLoginState (runs when Payouts sends the browser to Auth0):
     The SDK stores a little "state" with each login and gets it back
     at /callback. By default it holds only returnTo. Here, a step-up
     request also gets a random stepUpId. The SDK ties the state to a
     short-lived cookie it checks at /callback, so it can't be swapped
     by someone else's login.

   afterCallback (runs at /callback, after the SDK has checked the ID
   token: Auth0's signature, issuer, audience, expiry, nonce):
     This is where Payouts decides whether a step-up just happened.
     It counts ONLY if all of these are true (D-033):
       1. Payouts started a step-up in this session (stepUpPending),
       2. this callback carries that same stepUpId (it answers OUR
          request, not a normal or SSO login),
       3. the token is for the same artist who is logged in,
       4. the token's amr list contains "mfa" (Auth0 adds it only after
          an MFA challenge).
     Why not just check amr: setting up the authenticator at sign-up
     already puts "mfa" into the artist's Auth0 session, so a normal SSO
     token into Payouts can say "mfa" too. Trusting that alone would
     give a free pass right after sign-up.
     If it counts: Payouts records its own time (verifiedAt) and marks
     the verification unused. If Payouts asked but the token has no
     "mfa": recorded as "not completed" (shown at /change).
     The SDK merges what we return into the existing session, so a key
     set to undefined is removed.
     Every OTHER login (a normal login or an SSO visit) goes through the
     idle-lock check (Block 4b) before it's let in.

   What might fail:
   - A 400 at /callback with "Failed Exchange" in Auth0's logs:
     CLIENT_SECRET wrong or missing, or the Credentials tab isn't
     "Client Secret (Post)".
   - "callback URL mismatch" on Auth0's page: Allowed Callback URLs in
     Auth0 must contain http://localhost:3001/callback exactly.
   - Every step-up says "Verification wasn't completed": the token has
     no "mfa" (is the Action attached to post-login and deployed?). */
function readIdTokenClaims(idToken) {
  // The SDK has already verified this token; this only reads its middle part.
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
  } catch (e) {
    return {};
  }
}

app.use(
  auth({
    authRequired: false,
    auth0Logout: true,
    secret: process.env.SECRET,
    baseURL: process.env.BASE_URL,
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    clientAuthMethod: 'client_secret_post',
    issuerBaseURL: process.env.ISSUER_BASE_URL,
    session: {
      name: SESSION_NAME,
      rolling: true,
      rollingDuration: PAYOUTS_IDLE_MINUTES * 60, // seconds (D-038)
      absoluteDuration: 7 * 24 * 60 * 60, // seconds: 7 days
    },
    transactionCookie: { name: 'payouts_auth_verification' },
    routes: { postLogoutRedirect: '/signed-out' },
    authorizationParams: {
      response_type: 'code',
      response_mode: 'query',
      max_age: 604800,
    },
    getLoginState: (req, options) => {
      const state = { returnTo: options.returnTo || req.originalUrl };
      if (options.stepUpId) state.stepUpId = options.stepUpId;
      return state;
    },
    afterCallback: (req, res, session, state) => {
      const current = sessionOf(req);
      const pending = current && current.stepUpPending;
      const answersOurStepUp = Boolean(
        pending && state && state.stepUpId && state.stepUpId === pending.id
      );
      if (!answersOurStepUp) {
        // A normal login or an SSO visit: never counts as step-up.
        // Idle lock (D-038, Block 4b): if Payouts went idle and this login
        // didn't involve a password or passkey since, it must be redone.
        const claims = readIdTokenClaims(session.id_token);
        session.reauthRequired = needsFreshLogin(claims) ? true : undefined;
        return session;
      }
      const claims = readIdTokenClaims(session.id_token);
      const sameArtist = req.oidc.isAuthenticated() && req.oidc.user.sub === claims.sub;
      const mfaHappened = Array.isArray(claims.amr) && claims.amr.includes('mfa');
      if (sameArtist && mfaHappened) {
        session.stepUp = { verifiedAt: Date.now(), used: false };
        session.stepUpProblem = undefined;
      } else {
        session.stepUp = undefined;
        session.stepUpProblem = 'not_completed';
      }
      session.stepUpPending = undefined;
      return session;
    },
  })
);


/* Block 4b: The idle lock (D-038)
   Goal: after 15 minutes with no activity in Payouts, the artist must
   enter their password or passkey again. Studio is not affected.

   Why ending the session isn't enough on its own: when Payouts' session
   ends, Payouts sends the browser to Auth0, and Auth0 still has its own
   session (from Studio or an earlier login). So Auth0 would log the
   artist straight back in through SSO, with no login screen.

   How it works:
   1. lastActive: the server remembers, per artist, the time of their
      last request to Payouts. It's kept on the SERVER, so deleting
      cookies in the browser can't erase it.
   2. When a login comes back to Payouts (Block 4, afterCallback),
      needsFreshLogin() checks: did Payouts go idle, and has the artist
      NOT entered a password or passkey since their last activity?
      The proof is auth_time in the ID token: the time of their last
      real login, signed by Auth0, so the browser can't change it.
      A quiet SSO login carries the OLD auth_time.
   3. If so, the session is marked reauthRequired, and the middleware
      below sends the artist to Auth0 with prompt=login: the standard
      OpenID Connect way to say "show the login screen even if you
      already have a session". The next login carries a NEW auth_time,
      so it passes.
   While locked, requests don't count as activity, so waiting doesn't
   unlock it.

   Not idle (for example a cookie lost for another reason) or the first
   visit to Payouts (no record yet): normal SSO, no login screen.

   Known limits (demo):
   - lastActive is per artist, not per browser: activity in Payouts on
     one device keeps the lock from firing on another.
   - It's in memory: restarting Payouts forgets it (like the demo data).
   - Someone at the unlocked computer can still use Studio, which keeps
     its own (longer) session. The lock protects the sensitive app.

   CLOCK_ALLOWANCE_MS: auth_time comes from Auth0's clock, lastActive
   from this computer's. A small allowance stops a tiny clock difference
   from making an old login look new. */
const lastActive = new Map();
const CLOCK_ALLOWANCE_MS = Math.min(60 * 1000, IDLE_MS / 2);

function needsFreshLogin(claims, now = Date.now()) {
  const last = claims && lastActive.get(claims.sub);
  if (!last) return false; // first visit to Payouts: normal SSO
  if (now - last < IDLE_MS) return false; // not idle
  const loggedInAt = Number(claims.auth_time) * 1000; // NaN if missing -> needs a fresh login
  const passwordOrPasskeySince = loggedInAt > last + CLOCK_ALLOWANCE_MS;
  return !passwordOrPasskeySince;
}

app.use((req, res, next) => {
  if (!req.oidc.isAuthenticated()) return next();
  if (sessionOf(req).reauthRequired) {
    // A form submit can't be replayed after login, so anything but a GET
    // returns to the dashboard.
    return res.oidc.login({
      returnTo: req.method === 'GET' ? req.originalUrl : '/',
      authorizationParams: { prompt: 'login' },
    });
  }
  lastActive.set(req.oidc.user.sub, Date.now());
  next();
});


/* Block 5: Sample payout data (demo only, no database)
   Kept in the server's memory, one record per artist (keyed by their
   Auth0 user ID, "sub"). Restarting the server resets it.
   Only the account holder and the LAST FOUR digits are kept: the full
   account and routing numbers are checked, then thrown away (data
   minimization). The next payout ($680) matches Studio's two recent
   sales ($260 + $420).

   Payouts go out weekly, every Monday (nextMonday()).

   The payout hold (D-037): every change of payout account sets
   holdUntil = now + PAYOUT_HOLD_DAYS. Until then, payouts pause, and
   the dashboard says so. Why a hold and not a lock on further changes:
   step-up already makes every change need the code from the artist's
   phone. If an attacker still gets one change through (for example by
   phishing a code in real time), the hold means no money leaves before
   the artist notices, and the artist can still change the account back.
   A lock would block the real artist from undoing it.
   payoutStatus() works out what the dashboard shows: the scheduled
   Monday, and whether the hold pushes it later. */
const payoutAccounts = new Map();

function accountFor(sub) {
  if (!payoutAccounts.has(sub)) {
    payoutAccounts.set(sub, { holder: 'Studio artist', last4: '3821', bank: 'First Demo Bank', changedAt: null, holdUntil: null });
  }
  return payoutAccounts.get(sub);
}

const PAYOUT_AMOUNT = '$680.00';

function nextMonday(from) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const daysAhead = (8 - d.getDay()) % 7 || 7; // getDay(): Sunday 0 ... Saturday 6
  d.setDate(d.getDate() + daysAhead);
  return d;
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function payoutStatus(account, now = Date.now()) {
  const scheduled = nextMonday(now).getTime();
  const held = Boolean(account.holdUntil && account.holdUntil > now && account.holdUntil > scheduled);
  return { scheduled, held, holdUntil: account.holdUntil };
}


/* Block 6: Small helpers
   displayName / loginMethod / loginTime: the same as Studio's, so the
   two Developer views can be compared side by side (same login time =
   SSO, no new login).
   timeOf(): a short clock time for verification moments.
   verificationState(): reads Payouts' own step-up record and answers
   one question: is there an UNUSED verification from the last 10
   minutes? ("usable"), or one that ran out ("expired"), or one that was
   already used ("used"), or none at all ("none").
   stepUpLine(): the Developer view's "Step-up verification" text. */
function displayName(user) {
  if (user.email) return user.email.split('@')[0];
  return user.nickname || user.name || 'artist';
}

function loginMethod(claims) {
  const method = claims[CLAIM_NAMESPACE + 'login_method'];
  return method ? method : 'not available yet (needs the Auth0 Action)';
}

function loginTime(claims) {
  if (!claims.auth_time) return 'not in the token (verify)';
  return new Date(claims.auth_time * 1000).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

function timeOf(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

/* "discarded": the artist clicked Cancel on the form. The verification
   is thrown away (D-026) and can never be used, but Payouts keeps the
   two times so the Developer view can show what happened. */
function verificationState(session) {
  const v = session && session.stepUp;
  if (!v) return 'none';
  if (v.discardedAt) return 'discarded';
  if (v.used) return 'used';
  if (Date.now() - v.verifiedAt > STEP_UP_MAX_AGE_MS) return 'expired';
  return 'usable';
}

function stepUpLine(session) {
  const v = session.stepUp;
  switch (verificationState(session)) {
    case 'usable':
      return `done at ${timeOf(v.verifiedAt)}, unused (expires at ${timeOf(v.verifiedAt + STEP_UP_MAX_AGE_MS)})`;
    case 'expired':
      return `done at ${timeOf(v.verifiedAt)}, expired before it was used`;
    case 'used':
      return `done at ${timeOf(v.verifiedAt)}, used for a payout change at ${timeOf(v.usedAt || v.verifiedAt)}`;
    case 'discarded':
      return `done at ${timeOf(v.verifiedAt)}, thrown away (Cancel) at ${timeOf(v.discardedAt)}`;
    default:
      return 'not done yet';
  }
}


/* Block 7: Page shell (shared look for every Payouts page)
   Payouts looks deliberately different from Studio, so it's obvious in
   the demo that we're in another app: a vermilion header with a white
   wordmark on a cool grey page (Studio is black, gold and ivory). The
   brand stays the same: VERMILION, serif wordmark.
   The dialog is drawn by the server (no JavaScript needed): when the
   dashboard is opened with ?verify=..., the dialog is already open. */
function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <style>
    :root { --ink:#16181D; --page:#EEF0F3; --vermilion:#C43B2E; --line:#D7DBE2; --muted:#59606C; --ok:#1E6B45; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--page); color:var(--ink);
           font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    header { background:var(--vermilion); color:#fff; display:flex; flex-wrap:wrap;
             align-items:center; justify-content:space-between; gap:16px; padding:16px 32px; }
    .wordmark { font-family: Georgia, "Times New Roman", serif; letter-spacing:.25em; font-size:20px; }
    .nav { display:flex; flex-wrap:wrap; align-items:center; gap:20px; font-size:15px; }
    .nav a { color:#fff; text-decoration:none; padding:8px 0; border-bottom:1px solid transparent; }
    .nav a:hover { border-bottom-color:#fff; }
    main { max-width:880px; margin:0 auto; padding:32px; display:flex; flex-direction:column; gap:28px; }
    h1, h2 { font-family: Georgia, "Times New Roman", serif; font-weight:normal; margin:0; }
    .card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:24px; }
    .row { display:flex; flex-wrap:wrap; gap:16px; justify-content:space-between; align-items:center; }
    .label { font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
    .big { font-size:34px; font-family: Georgia, serif; }
    .acct { font-family: ui-monospace, Menlo, monospace; font-size:20px; }
    .btn { display:inline-block; padding:12px 22px; min-height:44px; border:1px solid var(--ink);
           border-radius:6px; background:#fff; color:var(--ink); text-decoration:none; font-size:15px; cursor:pointer; }
    .btn.primary { background:var(--ink); color:#fff; }
    .btn.sensitive { border-color:var(--vermilion); color:var(--vermilion); font-weight:600; }
    .actions { display:flex; flex-wrap:wrap; gap:12px; }
    form.inline { display:inline; margin:0; }
    .field { display:flex; flex-direction:column; gap:6px; margin-bottom:16px; }
    .field input { padding:12px; font-size:16px; border:1px solid var(--line); border-radius:6px; }
    .error { color:var(--vermilion); }
    .success { color:var(--ok); }
    .hold { display:inline-block; background:#FFF1E6; color:#8A3A00; border:1px solid #F2C9A8; border-radius:999px; padding:4px 12px; font-weight:600; }
    details { background:#fff; border:1px dashed #9AA2AE; border-radius:8px; padding:16px; }
    summary { cursor:pointer; font-weight:600; }
    dl { display:grid; grid-template-columns:max-content 1fr; gap:8px 24px; margin:16px 0 0; }
    dt { color:var(--muted); }
    dd { margin:0; font-family: ui-monospace, Menlo, monospace; }
    .note { font-size:13px; color:var(--muted); }
    .overlay { position:fixed; inset:0; background:rgba(22,24,29,.55); display:flex;
               align-items:center; justify-content:center; padding:24px; }
    .dialog { background:#fff; border-radius:10px; max-width:440px; width:100%; padding:28px;
              display:flex; flex-direction:column; gap:16px; border-top:6px solid var(--vermilion); }
    .center { min-height:100vh; display:flex; flex-direction:column; align-items:center;
              justify-content:center; gap:20px; padding:32px; text-align:center; }
    .center .wordmark { color:var(--vermilion); }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function header(user) {
  return `<header>
    <div class="wordmark">VERMILION PAYOUTS</div>
    <nav class="nav">
      <span>Signed in as <strong>${escape(displayName(user))}</strong></span>
      <a href="${escape(STUDIO_URL)}">Back to Studio</a>
      <a href="/logout">Log out</a>
    </nav>
  </header>`;
}

function developerView(req) {
  const claims = req.oidc.idTokenClaims || {};
  return `<details>
    <summary>Developer view (demo only)</summary>
    <dl>
      <dt>Logged in with</dt><dd>${escape(loginMethod(claims))}</dd>
      <dt>Logged in at</dt><dd>${escape(loginTime(claims))}</dd>
      <dt>Step-up verification</dt><dd>${escape(stepUpLine(sessionOf(req)))}</dd>
    </dl>
    <p class="note">Same "Logged in at" time in Studio and Payouts = no new login happened. That's SSO.
    Step-up only counts when it answers Payouts' own request, never from a normal or SSO login.</p>
  </details>`;
}

// One page for every step-up outcome that isn't success (D-032).
function stepUpResultPage(req, kind) {
  const text = {
    not_completed: {
      title: "Verification wasn't completed.",
      body: "Your payout account wasn't changed.",
      tryAgain: true,
    },
    no_factor: {
      title: 'Two-step verification required',
      body: "For your security, payout changes require two-step verification, which isn't set up on this account. Please contact support.",
      tryAgain: false,
    },
  }[kind];
  return pageShell('Payouts', `
  ${header(req.oidc.user)}
  <main>
    <section class="card">
      <h1>${escape(text.title)}</h1>
      <p>${escape(text.body)}</p>
      <div class="actions">
        ${text.tryAgain ? '<form class="inline" method="post" action="/step-up"><button class="btn primary" type="submit">Try again</button></form>' : ''}
        <a class="btn" href="/">Go back</a>
      </div>
    </section>
    ${developerView(req)}
  </main>`);
}


/* Block 8: Signed out page (PUBLIC: no login needed) (D-031)
   Where Payouts' Log out lands. If you're still logged in to Payouts,
   it sends you to the dashboard instead.
   Back to Studio may still open Studio logged in: Studio keeps its own
   session until it expires (D-024). Auth0's session is gone, so any
   payout change would need the password or passkey again, then the code. */
app.get('/signed-out', (req, res) => {
  if (req.oidc.isAuthenticated()) return res.redirect('/');
  res.send(pageShell('Signed out · Vermilion Payouts', `
  <div class="center">
    <div class="wordmark">VERMILION PAYOUTS</div>
    <h1>You're signed out of Payouts.</h1>
    <div class="actions">
      <a class="btn primary" href="/login">Log in</a>
      <a class="btn" href="${escape(STUDIO_URL)}">Back to Studio</a>
    </div>
  </div>`));
});


/* Block 9: The dashboard (LOGIN REQUIRED)
   requiresAuth(): no Payouts session -> off to Auth0. If Auth0 already
   has a session (the artist logged into Studio), Auth0 skips its login
   page and sends a new token straight back: SSO, no login screen.
   Shows: next payout amount and date, the payout account (last four
   digits only), and the sensitive button.
   "Change payout account" goes to /change, and the SERVER decides what
   happens (Block 10). If there's no usable verification, the server
   sends the artist back here with ?verify=..., which draws the
   "This requires additional verification" dialog:
     Continue -> POST /step-up (off to Auth0 for the code)
     Cancel   -> just the dashboard; nothing is sent to Auth0. */
app.get('/', requiresAuth(), (req, res) => {
  const user = req.oidc.user;
  const account = accountFor(user.sub);
  const payout = payoutStatus(account);
  const verify = req.query.verify;
  const dialog = verify ? `
  <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="verify-title">
    <div class="dialog">
      <h2 id="verify-title">This requires additional verification</h2>
      ${verify === 'expired' ? '<p class="error">Your verification expired. Please verify again.</p>' : ''}
      <p>Changing your payout account controls where your money goes. Confirm it's you with the 6-digit code from your authenticator app.</p>
      <p class="note">The next screen has no Cancel button. Changed your mind? Use your browser's Back button.</p>
      <div class="actions">
        <form class="inline" method="post" action="/step-up"><button class="btn primary" type="submit">Continue</button></form>
        <a class="btn" href="/">Cancel</a>
      </div>
    </div>
  </div>` : '';

  res.send(pageShell('Vermilion Payouts', `
  ${header(user)}
  <main>
    <section class="card">
      <div class="label">Next payout</div>
      <div class="row">
        <div class="big">${escape(PAYOUT_AMOUNT)}</div>
        ${payout.held
          ? `<div><span class="hold">On hold until ${escape(formatDate(payout.holdUntil))}</span><br><span class="note">Was scheduled for ${escape(formatDate(payout.scheduled))}</span></div>`
          : `<div><span class="label">Date</span><br>${escape(formatDate(payout.scheduled))}</div>`}
      </div>
      ${payout.held ? `<p class="note">Your payout account was changed on ${escape(formatDateTime(account.changedAt))}. For your security, payouts pause for ${PAYOUT_HOLD_DAYS} days after a change. Not you? Contact support.</p>` : ''}
    </section>
    <section class="card">
      <div class="label">Payout account</div>
      <div class="row">
        <div>
          <div class="acct">•••• ${escape(account.last4)}</div>
          <div class="note">${escape(account.holder)} · ${escape(account.bank)}</div>
        </div>
        <a class="btn sensitive" href="/change">Change payout account</a>
      </div>
    </section>
    ${developerView(req)}
  </main>
  ${dialog}`));
});


/* Block 10: The change form (LOGIN REQUIRED + server check)
   The server decides, every time (D-025):
   - The last step-up didn't complete -> "Verification wasn't
     completed" page (D-032).
   - An unused verification from the last 10 minutes -> show the form.
   - One that ran out -> back to the dialog, with "Your verification
     expired. Please verify again."
   - None, or one already used -> back to the dialog.
   So typing /change directly, without verifying, only ever gets the
   dialog (state 16). */
function changeFormPage(req, errorText) {
  return pageShell('Change payout account · Vermilion Payouts', `
  ${header(req.oidc.user)}
  <main>
    <section class="card">
      <h1>Change payout account</h1>
      <p class="note">Verified with MFA at ${escape(timeOf(sessionOf(req).stepUp.verifiedAt))}. This verification covers one change and expires at ${escape(timeOf(sessionOf(req).stepUp.verifiedAt + STEP_UP_MAX_AGE_MS))}.</p>
      ${errorText ? `<p class="error">${escape(errorText)}</p>` : ''}
      <form method="post" action="/change" autocomplete="off">
        <div class="field"><label for="holder">Account holder</label>
          <input id="holder" name="holder" required maxlength="80"></div>
        <div class="field"><label for="routing">Routing number</label>
          <input id="routing" name="routing" required inputmode="numeric" pattern="[0-9]{9}" maxlength="9" aria-describedby="routing-hint">
          <span id="routing-hint" class="note">9 digits</span></div>
        <div class="field"><label for="account">Account number</label>
          <input id="account" name="account" type="password" required inputmode="numeric" pattern="[0-9]{12}" maxlength="12" aria-describedby="account-hint">
          <span id="account-hint" class="note">12 digits</span></div>
        <div class="actions">
          <button class="btn primary" type="submit">Save</button>
        </div>
      </form>
      <form method="post" action="/change/cancel" style="margin-top:12px">
        <button class="btn" type="submit">Cancel</button>
      </form>
    </section>
    ${developerView(req)}
  </main>`);
}

app.get('/change', requiresAuth(), (req, res) => {
  const s = sessionOf(req);
  if (s.stepUpProblem) {
    s.stepUpProblem = undefined;
    return res.send(stepUpResultPage(req, 'not_completed'));
  }
  const state = verificationState(s);
  if (state === 'usable') return res.send(changeFormPage(req));
  if (state === 'expired') return res.redirect('/?verify=expired');
  return res.redirect('/?verify=1');
});


/* Block 11: Start step-up (the dialog's Continue, or Try again)
   1. Make a random ID for this request and remember it in Payouts'
      session (stepUpPending), so the answer can be matched (Block 4).
   2. Send the browser to Auth0 with acr_values = multi-factor, asking
      to come back to /change.
   At Auth0: there's no password or passkey screen (Auth0's session
   covers the first factor; after a logout it asks for those first).
   The Action sees the MFA request and requires the 6-digit code with
   "remember this browser" off. If the artist has no authenticator,
   the Action denies the request with the reason no_mfa_factor, and
   Block 13 shows the support message (it never offers setup here).
   Note: a POST, so a link on another website can't start it with the
   artist's cookies (the SDK's session cookie is SameSite=Lax, which
   browsers don't send on cross-site form posts). */
app.post('/step-up', requiresAuth(), (req, res) => {
  const id = crypto.randomUUID();
  sessionOf(req).stepUpPending = { id, startedAt: Date.now() };
  sessionOf(req).stepUpProblem = undefined;
  res.oidc.login({
    returnTo: '/change',
    stepUpId: id,
    authorizationParams: { acr_values: STEP_UP_ACR },
  });
});


/* Block 12: Save and Cancel
   Save (POST /change): THE real security check (D-025). The dialog and
   the button are just screens; someone could send this request
   directly. The server checks again: is there an unused verification
   from the last 10 minutes?
   - No -> nothing is saved; back to the dialog (or "expired").
   - Yes -> check the fields, save the holder and last four digits,
     start the payout hold (D-037), mark the verification USED
     (single-use, D-020), show success.
     Replaying the same Save later fails, because it's already used.
   A typo in the form (for example an 8-digit routing number) shows the
   form again; the verification stays unused.
   Cancel (POST /change/cancel): throws the unused verification away,
   so the next change asks for a new code (D-026). Only its two times
   are kept, so the Developer view can say "thrown away (Cancel) at...". */
app.post('/change', requiresAuth(), (req, res) => {
  const s = sessionOf(req);
  const state = verificationState(s);
  if (state === 'expired') return res.redirect('/?verify=expired');
  if (state !== 'usable') return res.redirect('/?verify=1');

  const holder = String(req.body.holder || '').trim();
  const routing = String(req.body.routing || '').trim();
  const accountNumber = String(req.body.account || '').trim();
  if (!holder || holder.length > 80) return res.send(changeFormPage(req, 'Enter the account holder name.'));
  if (!/^\d{9}$/.test(routing)) return res.send(changeFormPage(req, 'The routing number must be 9 digits.'));
  if (!/^\d{12}$/.test(accountNumber)) return res.send(changeFormPage(req, 'The account number must be 12 digits.'));

  const account = accountFor(req.oidc.user.sub);
  account.holder = holder;
  account.last4 = accountNumber.slice(-4);
  account.bank = 'Bank (routing ending ' + routing.slice(-4) + ')';
  account.changedAt = Date.now();
  account.holdUntil = account.changedAt + PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000; // D-037

  s.stepUp.used = true;
  s.stepUp.usedAt = Date.now();
  s.lastChange = { last4: account.last4, verifiedAt: s.stepUp.verifiedAt, holdUntil: account.holdUntil };
  res.redirect('/done');
});

app.post('/change/cancel', requiresAuth(), (req, res) => {
  const s = sessionOf(req);
  const state = verificationState(s);
  if (state === 'usable' || state === 'expired') {
    // Thrown away for good (D-026); only the two times are kept for the Developer view.
    s.stepUp = { verifiedAt: s.stepUp.verifiedAt, discardedAt: Date.now() };
  }
  res.redirect('/');
});

app.get('/done', requiresAuth(), (req, res) => {
  const change = sessionOf(req).lastChange;
  if (!change) return res.redirect('/');
  res.send(pageShell('Payout account updated · Vermilion Payouts', `
  ${header(req.oidc.user)}
  <main>
    <section class="card">
      <h1 class="success">Payout account updated to •••• ${escape(change.last4)}</h1>
      <p>Verified with MFA at ${escape(timeOf(change.verifiedAt))}.</p>
      ${change.holdUntil ? `<p class="note">For your security, payouts are on hold until ${escape(formatDate(change.holdUntil))} (${PAYOUT_HOLD_DAYS} days after a change).</p>` : ''}
      <div class="actions"><a class="btn primary" href="/">Back to dashboard</a></div>
    </section>
    ${developerView(req)}
  </main>`));
});


/* Block 13: When something goes wrong (D-032)
   Errors at /callback (Auth0 sent an error back, a missing login
   cookie, etc.) arrive here. The SDK leaves the existing session
   untouched, so the artist is still logged in.
   Three outcomes:
   1. It was Payouts' own step-up (stepUpPending, still logged in):
      - the Action denied it with no_mfa_factor -> the support message;
      - anything else -> "Verification wasn't completed" + Try again.
   2. Anything else (a normal login went wrong) -> the public "Something
      went wrong signing in" page with Try again.
   The real details go to the Terminal (console.error) only, never the
   page. */
app.use((err, req, res, next) => {
  console.error('Payouts error:', err.error || '', err.error_description || err.message);
  const s = sessionOf(req);
  const pending = s && s.stepUpPending;
  const recentStepUp = pending && Date.now() - pending.startedAt < STEP_UP_MAX_AGE_MS + 5 * 60 * 1000;
  if (recentStepUp && req.oidc && req.oidc.isAuthenticated()) {
    s.stepUpPending = undefined;
    const kind = err.error_description === 'no_mfa_factor' ? 'no_factor' : 'not_completed';
    return res.status(kind === 'no_factor' ? 403 : 400).send(stepUpResultPage(req, kind));
  }
  const message = err.error_description || err.message || 'Unknown error';
  res.status(err.status || 500).send(pageShell('Sign-in problem · Vermilion Payouts', `
  <div class="center">
    <div class="wordmark">VERMILION PAYOUTS</div>
    <h1>Something went wrong signing in.</h1>
    <p>${escape(message)}</p>
    <a class="btn primary" href="/">Try again</a>
  </div>`));
});


/* Block 14: Start the server
   PORT from .env (3001), so it can run next to Studio (3000). */
const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Vermilion Payouts on http://localhost:${port}`));
