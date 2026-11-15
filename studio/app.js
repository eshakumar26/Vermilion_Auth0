/* =====================================================================
   VERMILION STUDIO  (the Baseline App)  ·  app.js
   Runs on http://localhost:3000

   What this app does:
   - Every page needs login, except the Signed out page and the error
     page (so SSO works when you arrive from Payouts, and an error can
     never get stuck in a loop).
   - Dashboard: header, sample artworks, recent sales, Developer view.
   - Logout ends Studio's session AND Auth0's, then lands on
     /signed-out.
   ===================================================================== */


/* Block 1: Load settings and libraries
   - dotenv reads the .env file and makes each line available as
     process.env.NAME (tenant address, client ID, session secret, port,
     Payouts' address). It runs first because everything below needs
     those values. Keeping them in .env keeps secrets out of the code.
   - express is the web server: it listens on a port and matches web
     addresses (like /signed-out) to the code that answers them.
   - From Auth0's SDK (express-openid-connect) we take two tools:
       auth         -> plugs Auth0 login into the whole app (Block 4)
       requiresAuth -> a "bouncer" for one page: not logged in? go to
                       Auth0's login page first (Block 9)
   - escape-html makes any text safe to put in a page, so a name like
     <script>…</script> is shown as text instead of running (XSS).
   - path builds file paths that work on any computer (Block 3).
   What might fail: "Cannot find module 'x'" means that library isn't
   installed in this folder. Run: npm install express@4
   express-openid-connect dotenv escape-html */
require('dotenv').config();
const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');
const escape = require('escape-html');
const path = require('path');


/* Block 2: Create the web app
   express() builds the app object. Nothing runs yet: the server only
   starts at app.listen() at the very bottom.
     app.use()  -> runs on EVERY request
     app.get()  -> runs for ONE address
   Order matters: Express runs things top to bottom. */
const app = express();


/* Block 3: Serve image files (your artwork)
   Anything you put in the folder  studio/public/  can be loaded by the
   browser at  /public/<file name>.  Example: put morning-tide.jpg in
   studio/public/art/  and it is reachable at /public/art/morning-tide.jpg.
   This sits ABOVE Auth0 on purpose: images are not secret, so they
   don't need a login check on every image request.
   What might fail: a broken image means the file name in Block 6 doesn't
   match the real file name exactly (capital letters count). */
app.use('/public', express.static(path.join(__dirname, 'public')));


/* Block 4: Plug Auth0 into the app
   auth() runs on EVERY request. It reads Studio's own session cookie
   and fills in req.oidc (who is logged in, their ID token). It also
   creates three routes we never write ourselves:
     /login    -> sends the browser to Auth0's hosted login page
     /callback -> receives the signed ID token, checks it (signed by
                  Auth0, meant for Studio, not expired, matches this
                  login), then starts Studio's session
     /logout   -> ends Studio's session, then Auth0's (see auth0Logout)

   Each setting:
   - authRequired: false
       Don't lock every page automatically. We lock pages one by one
       with requiresAuth() instead, because two pages must stay public:
       the Signed out page and the error page.
   - auth0Logout: true
       Log out of Auth0 too, not just Studio. Without this, Auth0's
       session would stay alive and the next visit would log the artist
       straight back in through SSO.
   - secret: encrypts Studio's session cookie (Studio's own secret,
       different from Payouts' secret).
   - baseURL: Studio's own address. Must match the Allowed Callback
       URL in Auth0 (http://localhost:3000/callback).
   - clientID: tells Auth0 "this is Vermilion Studio" (safe to show;
       it is not a secret).
   - clientSecret: Studio's Auth0 client secret (Settings or
       Credentials tab in Auth0). A real secret: only in .env, never in
       chat, screenshots or GitHub. Needed because of the code flow
       below: Studio's server uses it to swap the login code for tokens.
       Don't confuse it with SECRET (the cookie key above).
   - clientAuthMethod: 'client_secret_post'
       HOW the server proves it knows the client secret: inside the
       request body ("Post"). It must match Studio's Credentials tab in
       Auth0, which says "Client Secret (Post)". The SDK's default is
       "Basic" (a header); a mismatch makes the login fail at /callback
       with a 400 (Auth0's logs say "Failed Exchange: Unauthorized").
   - issuerBaseURL: your Auth0 tenant's address.
   - session.name: 'studioSession'
       Studio's cookie name. Both apps run on localhost, and browsers
       share localhost cookies across ports. The SDK names every app's
       cookie "appSession" by default, so Studio and Payouts would
       overwrite each other. Unique names fix that.
   - transactionCookie.name: 'studio_auth_verification'
       A short-lived cookie the SDK uses during each login to check
       the reply really belongs to the login it started. Same
       collision problem, same fix: Studio gets its own name.
   - routes.postLogoutRedirect: '/signed-out'
       Where Auth0 sends the browser after logout. This full address
       (http://localhost:3000/signed-out) must be listed in Auth0 under
       Allowed Logout URLs, or Auth0 shows an error page.
   - authorizationParams.max_age: 604800 (7 days, in seconds)
       Why it's here: the Developer view shows WHEN the artist really
       logged in (auth_time). Auth0 only puts auth_time in the ID token
       when the app sends max_age (OpenID Connect rule; Auth0's docs
       say the same). max_age also means "if the last real login is
       older than this, ask again". 7 days is longer than any session
       here, so it never forces an extra login; it just makes
       auth_time appear. The SDK also checks auth_time against it.
       Payouts will use the same setting, so both apps can show the
       same login time (the on-screen proof of SSO).
   - authorizationParams.response_type: 'code' and response_mode:
       'query' (decision D-036: the authorization code flow)
       Before: Auth0 posted the ID token back to Studio as a cross-site
       form (form_post). Over http, Chrome only allows that if the
       login finishes within about 2 minutes (the SDK's FAQ), which a
       live sign-up with QR scanning could exceed. Now: Auth0 sends back
       a one-time code as a normal redirect (?code=...), and Studio's
       server swaps it for the tokens directly with Auth0, proving
       itself with the client secret. Normal redirects work with
       ordinary cookies over http, so the 2-minute limit is gone, and
       the tokens never pass through the browser. The SDK also adds
       PKCE (a one-time proof that the code was requested by this same
       login), so a stolen code is useless on its own.
   What might fail:
   - A 400 at /callback with "Failed Exchange" in Auth0's logs:
     CLIENT_SECRET is missing or wrong in .env, or the Credentials tab
     isn't "Client Secret (Post)".
   - A startup error '"clientSecret" is required': CLIENT_SECRET is
     missing from .env.
   - "callback URL mismatch" on Auth0's page: BASE_URL in .env and
     the Allowed Callback URL in Auth0 don't match exactly.
   - An Auth0 error after logout: /signed-out isn't in Allowed
     Logout URLs.
   - A startup error mentioning "secret": SECRET is missing in .env. */
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
    session: { name: 'studioSession' },
    transactionCookie: { name: 'studio_auth_verification' },
    routes: { postLogoutRedirect: '/signed-out' },
    authorizationParams: {
      response_type: 'code',
      response_mode: 'query',
      max_age: 604800,
    },
  })
);


/* Block 5: Sign-up shortcut
   /signup starts the normal Auth0 login, but adds an instruction
   (screen_hint: 'signup') so Auth0's page opens on the Sign up tab.
   authorizationParams is how the app steers Auth0 at login. Payouts
   uses the same mechanism later to ask Auth0 for MFA (step-up).
   returnTo: '/' -> after sign-up, come back to the dashboard. */
app.get('/signup', (req, res) =>
  res.oidc.login({
    returnTo: '/',
    authorizationParams: { screen_hint: 'signup' },
  })
);


/* Block 6: Sample data (demo only, no database)
   The artworks and sales shown on the dashboard: Esha's own pieces.
   Each image file lives in studio/public/art/ and is loaded from
   /public/art/<file name> (see Block 3).
   - Rename a title: change the text in quotes.
   - Add a piece: copy one line, change the values, put the image in
     studio/public/art/.
   - year: null hides the year. image: null shows a coloured tile
     with the title instead of a picture.
   The sales are made-up demo numbers. */
const artworks = [
  { title: 'Old Man in a Beanie', medium: 'Charcoal on paper',   year: 2018, image: '/public/art/old-man-in-a-beanie.jpg', tile: '#8C8C8C' },
  { title: 'Abandoned Car',       medium: 'Charcoal on paper',   year: 2017, image: '/public/art/abandoned-car.jpg',       tile: '#3A3A3A' },
  { title: 'Tesla (mural)',       medium: 'Acrylic on canvas',   year: null, image: '/public/art/tesla-mural.jpg',         tile: '#1F3B2B' },
];

const recentSales = [
  { title: 'Old Man in a Beanie', price: '$260', date: 'Nov 2, 2026' },
  { title: 'Abandoned Car',       price: '$420', date: 'Oct 28, 2026' },
];

const PAYOUTS_URL = process.env.PAYOUTS_URL || 'http://localhost:3001';


/* Block 7: Small helpers that read the ID token
   req.oidc.user          = the artist's profile (email, nickname...)
   req.oidc.idTokenClaims = the WHOLE ID token, including technical
                            claims the SDK hides from .user, such as
                            auth_time (when they actually logged in).

   displayName(): "Signed in as" shows the part of the email before the
     @ (decision: less personal data on screen while demoing).

   loginMethod(): password or passkey. Auth0 doesn't put this in the
     ID token by default; the Auth0 Action ("Vermilion login rules")
     adds it as a custom claim. Custom claims need a namespace that looks like a
     web address, so the Action must use exactly this name:
     https://vermilion.demo/login_method
     Until the Action exists, the page says so honestly.

   loginTime(): auth_time is when the artist last really logged in at
     Auth0. After SSO, Studio and Payouts show the SAME time: proof that
     no new login happened. auth_time is in seconds; JavaScript dates
     use milliseconds, hence * 1000.
   What might fail: "Logged in at: not in the token" after a NEW login
   means auth_time still isn't in the ID token (check max_age in
   Block 4). A session from before this change won't have it: log out
   and log in again. */
function displayName(user) {
  if (user.email) return user.email.split('@')[0];
  return user.nickname || user.name || 'artist';
}

function loginMethod(claims) {
  const method = claims['https://vermilion.demo/login_method'];
  return method ? method : 'not available yet (needs the Auth0 Action)';
}

function loginTime(claims) {
  if (!claims.auth_time) return 'not in the token (verify)';
  return new Date(claims.auth_time * 1000).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}


/* Block 8: Page shell (shared look for every page)
   pageShell() wraps any page body in the same <head> and styles, so
   each page only writes its own content. The CSS lives in one place:
   change a colour here and every page follows.
   Studio's look: light ivory background, black header, gold wordmark
   (Payouts will look darker and distinct, but share the brand). */
function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <style>
    :root { --ink:#141414; --ivory:#FAF7F0; --gold:#D4AF63; --line:#E4DDCF; --muted:#5C564C; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--ivory); color:var(--ink);
           font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    header { background:#0A0A0A; color:var(--ivory); display:flex; flex-wrap:wrap;
             align-items:center; justify-content:space-between; gap:16px; padding:16px 32px; }
    .wordmark { font-family: Georgia, "Times New Roman", serif; color:var(--gold);
                letter-spacing:.25em; font-size:20px; }
    .nav { display:flex; flex-wrap:wrap; align-items:center; gap:20px; font-size:15px; }
    .nav a { color:var(--ivory); text-decoration:none; padding:8px 0; }
    .nav a:hover { color:var(--gold); }
    main { max-width:1100px; margin:0 auto; padding:32px; display:flex; flex-direction:column; gap:40px; }
    h1, h2 { font-family: Georgia, "Times New Roman", serif; font-weight:normal; margin:0; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:24px; }
    .art { background:#fff; border:1px solid var(--line); }
    .art img, .tile { width:100%; aspect-ratio:4/5; object-fit:contain; display:block; background:#0A0A0A; }
    .tile { display:flex; align-items:flex-end; padding:16px; color:#fff;
            font-family: Georgia, serif; font-size:20px; }
    .art p { margin:0; padding:12px 16px; font-size:14px; color:var(--muted); }
    .art strong { display:block; color:var(--ink); font-size:16px; }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); }
    th, td { text-align:left; padding:12px 16px; border-bottom:1px solid var(--line); }
    th { font-size:13px; color:var(--muted); font-weight:600; }
    details { background:#fff; border:1px dashed #B9A06A; padding:16px; }
    summary { cursor:pointer; font-weight:600; }
    dl { display:grid; grid-template-columns:max-content 1fr; gap:8px 24px; margin:16px 0 0; }
    dt { color:var(--muted); }
    dd { margin:0; font-family: ui-monospace, Menlo, monospace; }
    .center { min-height:100vh; display:flex; flex-direction:column; align-items:center;
              justify-content:center; gap:24px; padding:32px; text-align:center; }
    .btn { display:inline-block; padding:12px 24px; min-height:44px; border:1px solid var(--ink);
           color:var(--ink); text-decoration:none; }
    .btn.primary { background:var(--ink); color:var(--ivory); }
    .note { font-size:13px; color:var(--muted); }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}


/* Block 9: Signed out page (PUBLIC: no login needed)
   Where logout lands (see routes.postLogoutRedirect in Block 4).
   It must stay public: if it required login, logging out would bounce
   straight back to Auth0's login page.
   If someone who IS logged in opens it, send them to the dashboard.
   Log in -> /login (Block 4 route); Sign up -> /signup (Block 5). */
app.get('/signed-out', (req, res) => {
  if (req.oidc.isAuthenticated()) return res.redirect('/');
  res.send(
    pageShell(
      'Signed out · Vermilion Studio',
      `<div class="center">
        <h1>Vermilion Studio</h1>
        <p>You're signed out.</p>
        <div style="display:flex; gap:16px; flex-wrap:wrap; justify-content:center">
          <a class="btn primary" href="/login">Log in</a>
          <a class="btn" href="/signup">Sign up</a>
        </div>
      </div>`
    )
  );
});


/* Block 10: The dashboard (LOGIN REQUIRED)
   requiresAuth() is the bouncer: if Studio has no session, it sends the
   browser to Auth0's login page and brings it back here afterwards.
   If the artist is already logged in at Auth0 (for example they came
   from Payouts), Auth0 skips the login page and sends a new ID token
   for Studio straight away. That's SSO: the artist sees a brief flash,
   no login screen.

   The page has four parts, top to bottom:
   1. Header: wordmark, "Signed in as", Go to Payouts, Log out
   2. Artworks (from Block 6)
   3. Recent sales (from Block 6)
   4. Developer view (collapsible <details>, demo only): how and when
      the artist logged in. Only three lines, never the full profile:
      in production you wouldn't show any of it (data minimization).

   Every value that comes from the user or the token goes through
   escape() before it reaches the page (XSS protection). */
app.get('/', requiresAuth(), (req, res) => {
  const user = req.oidc.user;
  const claims = req.oidc.idTokenClaims;

  // Build the artwork cards: a real image if there is one, else a tile.
  const artCards = artworks
    .map(
      (a) => `<article class="art">
        ${
          a.image
            ? `<img src="${escape(a.image)}" alt="${escape(a.title)}">`
            : `<div class="tile" style="background:${escape(a.tile)}" role="img" aria-label="${escape(a.title)}">${escape(a.title)}</div>`
        }
        <p><strong>${escape(a.title)}</strong>${escape(a.medium)}${a.year ? ' · ' + escape(String(a.year)) : ''}</p>
      </article>`
    )
    .join('');

  // Build the sales table rows.
  const saleRows = recentSales
    .map(
      (s) => `<tr><td>${escape(s.title)}</td><td>${escape(s.price)}</td><td>${escape(s.date)}</td></tr>`
    )
    .join('');

  res.send(
    pageShell(
      'Dashboard · Vermilion Studio',
      `<header>
        <div class="wordmark">VERMILION STUDIO</div>
        <nav class="nav" aria-label="Account">
          <span>Signed in as <strong>${escape(displayName(user))}</strong></span>
          <a href="${escape(PAYOUTS_URL)}">Go to Payouts</a>
          <a href="/logout">Log out</a>
        </nav>
      </header>

      <main>
        <section style="display:flex; flex-direction:column; gap:16px">
          <h2>Artworks</h2>
          <div class="grid">${artCards}</div>
        </section>

        <section style="display:flex; flex-direction:column; gap:16px">
          <h2>Recent sales</h2>
          <table>
            <thead><tr><th>Artwork</th><th>Sold for</th><th>Date</th></tr></thead>
            <tbody>${saleRows}</tbody>
          </table>
        </section>

        <details>
          <summary>Developer view (demo only)</summary>
          <dl>
            <dt>Logged in with</dt><dd>${escape(loginMethod(claims))}</dd>
            <dt>Logged in at</dt><dd>${escape(loginTime(claims))}</dd>
            <dt>Step-up verification</dt><dd>not done yet (step-up only happens in Payouts)</dd>
          </dl>
          <p class="note">Same "Logged in at" time in Studio and Payouts = no new login happened. That's SSO.</p>
        </details>
      </main>`
    )
  );
});


/* Block 11: Friendly error page (PUBLIC)
   An error handler is a middleware with FOUR arguments (err, req, res,
   next); Express sends any error here instead of its default page,
   which can show code details (a security leak).
   When does this run? For example: Auth0 sends back an error during
   login, a callback URL mismatch, the login took longer than the
   http/2-minute limit, or the tenant can't be reached.
   It must be LAST, after every route, so it can catch their errors.
   The full error goes to the Terminal (for you); the page shows only a
   short message (for the artist). "Try again" goes to the dashboard,
   which restarts login.
   For production: show a reference ID instead of the message, and keep
   details only in server logs. */
app.use((err, req, res, next) => {
  console.error('Studio error:', err);
  const message = err.error_description || err.message || 'Unknown error';
  res.status(err.status || 500).send(
    pageShell(
      'Something went wrong · Vermilion Studio',
      `<div class="center">
        <h1>Something went wrong signing in.</h1>
        <p>${escape(message)}</p>
        <a class="btn primary" href="/">Try again</a>
      </div>`
    )
  );
});


/* Block 12: Start the server
   Use PORT from .env, or 3000 if it's missing ("||" means "or").
   app.listen() starts the server and keeps it running until Ctrl+C.
   PORT must match BASE_URL in .env AND the Allowed Callback / Logout
   URLs in Auth0, or login fails with a callback mismatch.
   What might fail: "EADDRINUSE" means something already uses port 3000
   (often an old copy of this app). Stop it with Ctrl+C in its window. */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Vermilion Studio on http://localhost:${port}`));
