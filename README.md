# Vermilion

Vermilion is an art marketplace made up of two applications: **Studio**, where artists showcase their work, and **Payouts**, where they manage their earnings. Both run on one Auth0 tenant. An artist logs in once with a passkey or a password, moves between the apps without logging in again, and has to prove it's really them before changing where their money goes.

**Quick links**
- [Tenant setup guide](docs/tenant-setup.md): every Auth0 setting, step by step, and why
- [The Auth0 Action](auth0/actions/vermilion-login-rules.js): all of the MFA logic

**Contents**
1. The problem, and why an art marketplace
2. Users, assumptions and scope
3. What I built
4. Key decisions
5. Trade-offs
6. What I'd do differently
7. How I used AI

---

## 1. The problem, and why an art marketplace

### The problem
On creator platforms, account takeovers often don't steal money directly. Attackers redirect payouts: they change the payout bank account so the next payout lands with them, usually by riding a session the artist is already logged into (for example, cookies copied by malware). The change itself moves no money, so nobody notices until payday. Platforms treat this as high-risk.

The product question I designed around: **how do we keep everyday work frictionless, while making sure a stolen session alone can never redirect an artist's money?**

### Why an art marketplace
The brief asked for a Baseline App and a Sensitive App sharing one login, with one operation that requires step-up. I wanted a scenario where the two apps genuinely differ in risk, and where the sensitive operation is a real attack pattern.

| Scenario | Sensitive operation | Why I didn't pick it |
|---|---|---|
| Bank | Send money to a new payee | The clearest risk, but the default choice, and it only covers money movement |
| Airline loyalty / gaming | Transfer miles / trade a rare item | The risk is less clear-cut and can feel trivial |
| Software company | Change MFA settings | A whole separate security app doesn't fit the two-app structure naturally |
| **Creator marketplace** | **Change the payout bank account** | **Picked** |

---

## 2. Users, assumptions and scope

### Users
I used one rule to decide who's in scope: **a user type earns a spot only if it changes the authentication design the brief asks for.**

**Primary user: the artist.** They sign up on their own, spend most of their time in Studio managing artworks and sales, and occasionally visit Payouts. Their needs pull in two directions: everyday work should be fast, with one login across both apps, while their money should be hard to touch for anyone but them. They're the only person who goes through every flow in the brief: login, SSO and step-up.

**Anti-persona: an attacker holding the artist's session.** They have stolen cookies, and possibly the artist's password, phished or reused from another site. They can browse anything the artist can. Their goal is to change the payout account.

**Out of scope:**
- **Buyers and collectors** use a storefront, not Studio or Payouts.
- **Studio assistants** would upload art without touching payouts. That's a roles-and-permissions problem (authorization, not authentication)
- **Vermilion staff** would need a separate admin app with a stricter login.

### Assumptions
1. **Studio is low-risk.** It shows artworks, views and sales. Nothing in it moves money or changes security settings. If it ever did, that action would move to Payouts or get its own step-up.
2. **Payouts is "sensitive" because of one operation, not every screen.** Viewing earnings and the masked account is read-only; changing the account is the risk.
3. **The main threat is a stolen session, not just a stolen password.** A second password prompt wouldn't stop session theft; a different factor at the moment of risk does.
4. **Payout changes are rare,** so asking for a code on every change is acceptable friction.
5. **Artists have a smartphone** and can use an authenticator app.
6. **Sign-up is the one moment we're sure it's really the artist,** because they just created their credentials.
7. **Some artists' devices can't use passkeys,** so passwords stay available.
8. **Payouts go out weekly.**
9. **This is a demo environment:** `localhost`, test accounts, and a free Auth0 tenant on its trial.

### Goals
**From the brief:**
- Artists can log in with a passkey **or** a password.
- Moving between Studio and Payouts never asks them to log in again (SSO, both directions).
- Changing the payout account requires a step-up challenge, even with an active session, using any MFA factor except email.

**Product principles I held myself to:**
- **Extra proof at the moment of risk, not at the door.** One login gets you in; money needs fresh proof.
- **The server is the bouncer.** Buttons and dialogs are just screens; the real check happens on the server when the change is saved.
- **Never hand the enrollment screen to someone we can't confirm.** MFA setup happens at sign-up, never at step-up.
- **Make it visible.** A Developer view in each app shows how you logged in and when, so SSO and step-up can be seen, not just claimed.

### Out of scope (non-goals)
- A recovery flow for artists who lose their passkey.
- Logging out of both apps at once.
- Roles and delegated access.
- Requiring a verified email before payout changes.
- Production hosting, custom domains and real payments.

---

## 3. What I built

| Component | What it is | Role |
|---|---|---|
| **Vermilion Studio** | Express app, `localhost:3000` | Baseline App: artworks, sales, one login |
| **Vermilion Payouts** | Express app, `localhost:3001` | Sensitive App: earnings, payout account, step-up on change |
| **Auth0 tenant** | Universal Login; one database connection with passkeys and passwords; authenticator-app MFA | Identity for both apps, and the SSO session between them |
| **Login rules (Auth0 Action)** | One post-login Action | Every MFA decision, in one place |
| **Testing** | A 45-case manual test plan; run during development | Evidence that the flows, and the attacks on them, behave as designed |

### How I worked
I treated this like a small product build rather than a coding exercise:
1. **Research:** what makes an app "baseline" or "sensitive", when SSO and MFA belong together, and how passwords and passkeys compare. I also checked that a free Auth0 tenant covers the brief.
2. **Users:** who uses these apps, and who attacks them.
3. **User states:** every situation an artist or attacker can be in, prioritized.
4. **Journeys:** what happens, screen by screen, in each state that matters.
5. **UI spec:** what each screen shows, locked before writing code.
6. **Build:** Studio first, then Payouts.
7. **Test:** A test plan, then fixes for what testing found.

Throughout, I kept four logs: a **work log** (every step), a **decision log** (each decision with the options, the trade-off, and what would change my mind), a **friction log** (everywhere Auth0 or its docs slowed me down), and an **AI usage log** (what I asked, what I got, and whether it was right).

### User states
I started by mapping 25 states across five groups: logging into Studio, getting into Payouts, using the sensitive action, leaving, and attacking. I gave each a priority, then refined the list into **18 states** to design in detail. 16 of them are built into the apps; 2 were inputs to decisions rather than features.

| # | State | What happens |
|---|---|---|
| **Getting in** | | |
| 1 | New artist, no account | Signs up on Auth0's page with a password or a passkey, sets up an authenticator app, lands in the app |
| 2 | Returning artist, no session anywhere | Sent to Auth0's login page, logs in, lands on the dashboard |
| 3 | Returning artist with a passkey | Chooses "Continue with a passkey", confirms with fingerprint or face, lands in the app |
| 4 | Logged into Payouts, opens Studio | SSO: no login screen, Studio creates its own session |
| 5 | Opens Payouts first, no session anywhere | Sent to Auth0's login page, then to Payouts |
| 6 | Logged into Studio, opens Payouts | SSO: no login screen, Payouts creates its own session |
| **The sensitive action** | | |
| 7 | MFA set up, no recent proof | Fresh code, then the change is allowed |
| 8 | Started verification, then cancelled or failed | Nothing changes, the artist stays logged in, and can try again |
| 9 | Already did MFA earlier (at sign-up, or a previous change) | Gets no free pass: a fresh code every time, but never the password again |
| 10 | Verified minutes ago, changes the account again | Asked again, because each verification covers one change |
| 11 | Never set up MFA | Prevented at sign-up, and asked again on the next real login if skipped. If an account still has no factor, payout changes are blocked, and step-up never offers setup |
| 12 | Logged in with a passkey | Same code step-up as password users |
| **Leaving** | | |
| 13 | Logs out of either app | Ends that app's session and Auth0's, then lands on that app's own Signed out page |
| **Attackers** | | |
| 14 | Stole all of the artist's cookies | Can browse both apps, but is blocked at the code |
| 15 | Stole cookies from an artist with no MFA | Blocked, with no setup offered |
| 16 | Skips the button: opens the form directly, or sends Save without verifying | The server refuses; "the check is on Save" |
| 17 | Has the artist's password | *Decision input:* can log in, but step-up blocks the change |
| 18 | Phishes a code in real time | *Decision input:* authenticator codes can be relayed by a fake site |

**States I deliberately didn't build as separate flows:**

| State | Why |
|---|---|
| Studio session still active | The SDK lets the artist straight in; nothing to design |
| Studio session expired, Auth0 session still alive | SSO handles it (same as states 4 and 6) |
| Wrong or forgotten password | Auth0's hosted page handles the error and the reset email |
| Auth0 session expired, Payouts never opened | A normal login (state 5) |
| Walks away, browser left open | Sessions expire by default. Testing later showed that wasn't strict enough for Payouts |
| Cookies stolen right after step-up | Contained by design: each verification works once, within 10 minutes |
| Cookies stolen, then the artist logs out | The copied app cookie still works until it expires (a production item), but step-up still blocks payout changes |
| Push-notification fatigue | Doesn't apply: I didn't use push |

### Key journeys
**Sign-up.** The artist opens Studio (or Payouts) and is sent to Auth0's page, which asks for an email first. They create a password or a passkey, then set up an authenticator app by scanning a QR code and confirming one code. Then they land in the app. If they abandon the QR screen, they're asked again on their next real login, until setup is done.

**SSO, both directions.** The artist clicks Go to Payouts (or Back to Studio). There's a brief flash and no login screen: the other app finds no session of its own, asks Auth0, and Auth0 recognizes its own session. Both Developer views show the same "Logged in at", which is the proof that no second login happened.

**Changing the payout account (step-up).**
1. The artist clicks Change payout account. The server finds no unused verification, so a dialog explains that this needs extra verification.
2. They click Continue. Auth0 asks only for the 6-digit code: no password, no email option, no "remember this browser".
3. The change form opens. On Save, the server checks the verification again, saves the new account, and marks the verification used.
4. The success page confirms the change and shows when payouts resume. Back on the dashboard, the next payout shows "On hold until…" with a "Not you? Contact support" note.

**When things go wrong.**
- **Cancelled or failed code:** "Verification wasn't completed. Your payout account wasn't changed." The artist stays logged in.
- **No authenticator on the account:** "Please contact support", with no setup offered.
- **Verification expired or already used at Save:** "Your verification expired. Please verify again."

**Leaving.** Logging out ends that app's session and Auth0's, and lands on that app's own Signed out page. The other app stays viewable until its own session expires, but a payout change there needs a full login plus the code. Payouts also asks for a password or passkey again after 15 minutes of inactivity.

### UI spec
I wrote and locked the UI spec for both apps before building, so the code had a clear target and any deviation would be visible.

**Vermilion Studio** (Baseline App)
- Header: "Vermilion Studio", "Signed in as …", Go to Payouts, Log out
- The artist's artworks, and a short Recent sales list
- A collapsible **Developer view:** how you logged in, when, and step-up status (always "not done yet" in Studio)
- A public Signed out page (Log in / Sign up), and a friendly public error page

**Vermilion Payouts** (Sensitive App)
- A visibly different look (a vermilion header), so the switch between apps is obvious in a demo
- Next payout amount and date (weekly, on Mondays). After a change, this shows "On hold until …", "Was scheduled for …", and the "Not you? Contact support" note
- The payout account, masked to the last four digits
- **Change payout account**, the sensitive button, which opens a dialog explaining the extra verification
- The change form: account holder, routing number, and account number (masked)
- Four result messages: success (with the hold), verification not completed, no authenticator set up, and expired or already used
- A **Developer view:** how you logged in, when, and the step-up status
- Its own public Signed out page ("You're signed out of Payouts"), and a friendly public error page

### What testing changed
My first full run of the test plan surfaced one real defect and about a dozen product questions. From those, I built:
- **A 15-minute idle lock on Payouts.** Both apps were still logged in after an hour of no activity. Payouts now asks for a password or passkey again after 15 minutes, in a way SSO can't quietly bypass. Studio is unchanged.
- **The verification's lifecycle in the Developer view:** when it was used for a change, or thrown away by Cancel, not just "not done yet".
- **A note in the step-up dialog** pointing to the browser's Back button, because Auth0's code screen has no Cancel link.

The defect itself: the payout hold was missing on my machine. The code was right, but an older copy of the file had been saved over it. Re-testing after restoring it passed.

---

## 4. Key decisions

Where the brief was open-ended, this is what I chose and why. The full reasoning, the options considered and what would change my mind are in my decision log.

### Scenario and users
- **A creator marketplace, with "change payout account" as the sensitive operation.** It's a real attack pattern (payout redirection), and the two apps genuinely differ in risk. See section 1.
- **One user and one anti-persona:** the artist, and an attacker holding their session. Buyers, assistants and staff don't change the authentication design.
- **I prioritized the user states** and designed 18 in detail, instead of trying to build every possible case.

### Login and SSO
- **Passkey *and* password, and the artist chooses.** "Either a passkey or a password" can be read two ways; offering both satisfies either reading and covers devices that can't use passkeys.
- **Google login off.** With Google login, Google does the authenticating, which is neither a password nor a passkey. On a new tenant it also runs on Auth0's shared test keys, which are for testing only.
- **No MFA when logging in to either app.** Studio is low-risk, and an MFA prompt when arriving at Payouts would be a login prompt, which breaks SSO. MFA at the door doesn't stop someone who steals the session afterwards anyway.
- **Both apps require login on every main page, with a public Signed out page each.** A public home page with a Log in button never asks Auth0, so it would break SSO in one direction.
- **Progressive enrollment off.** Offering a passkey after every password login added a screen to the flows I needed to prove first.
- **Passkey recovery relies on what's built in:** synced passkeys and "use a phone". A recovery flow is its own project.
- **"Signed in as" shows the part before the @,** which identifies the account with less personal data on screen.
- **Email verification left at Auth0's default:** a link is sent, but login isn't blocked. The brief doesn't require it.

### Step-up
- **Auth0's documented step-up pattern.** Payouts asks Auth0 for MFA with a standard OpenID Connect request (`acr_values`), my Action requires the code, and Payouts checks the signed ID token.
- **Payouts only counts a step-up when the token answers its own request,** and records its own time. Setting up the authenticator at sign-up already marks the session as "MFA done", so the token alone isn't proof.
- **A fresh code every time, with no "remember this browser".** Even if MFA happened earlier in the session. Auth0's docs don't say plainly whether it re-asks, so I made it a test, and it does.
- **One change per verification, within 10 minutes.** Single-use leaves nothing for a stolen session to ride. Cancel throws the verification away.
- **The server checks the verification when the form opens *and* when Save is submitted.** Buttons and dialogs can be skipped; the server can't.
- **Passkey users still step up.** A passkey protects the login, not the session cookie afterwards, and Auth0 doesn't treat a passkey as an independent MFA factor.
- **When verification fails, the artist stays logged in,** with one of three messages depending on the cause. Logging them out would punish typos and add no protection.
- **A 5-day payout hold after any change,** with a "Not you?" note. If an attacker ever gets one change through, no money leaves before the artist notices. I chose a hold over locking further changes, because a lock would stop the real artist from undoing an attacker's change.

### MFA factor and enrollment
- **An authenticator-app code, with recovery codes as backup.** I compared every factor Auth0 supports. Device biometrics would be the same laptop and fingerprint as a passkey login, security keys need hardware, push risks "MFA fatigue", SMS can be SIM-swapped, and email is excluded.
- **MFA setup at sign-up, never at step-up.** Offering setup at step-up would let an attacker with a stolen session enroll their own phone.
- **Setup is offered on any fresh login until it's done.** My first version only offered it on the first login; testing showed an artist who closed the QR screen was stranded for good.
- **"No email factor" is enforced by the tenant setting.** The Action asks Auth0 for "any" enrolled factor, and Email is off.
- **No MFA line in Studio's Developer view.** Setup at sign-up isn't step-up, and showing "MFA: yes" in Studio would be misleading.

### Sessions and logout
- **Separate session cookie names and keys per app.** Browsers share cookies across ports on `localhost`, so without this the two apps would overwrite each other's sessions. SSO comes from Auth0's session, not a shared cookie.
- **Logging out ends that app's session and Auth0's,** and lands on that app's own Signed out page. I didn't build "log out everywhere".
- **A 15-minute idle lock on Payouts only,** kept even though coming back to it from Studio shows a login screen. SSO between the apps works exactly as the brief describes; the idle lock is a deliberate extra rule for the sensitive app.

### App architecture
- **Regular Web Applications for both apps.** The server enforces step-up, and tokens never reach the browser.
- **Express, with Auth0's stable Express SDK,** over the newer beta SDK. One small file per app that I can explain line by line, and reliability for a live demo.
- **Express 4, with every library declared.** The quickstart left libraries out, and Express 4 is what the SDK's own tests run on.
- **The authorization code flow, with a client secret per app.** The quickstart's flow over `http` only works if a login finishes within about 2 minutes.
- **All MFA logic in one Action,** with one log line per login and no personal data in it.
- **Studio first, end to end,** so the shared tenant settings and the Action were proven on the simpler app. It caught two serious issues before Payouts existed.
- **A Developer view, for the demo only,** to make SSO and step-up visible.

### Documentation and delivery
- **Tenant configuration as a written step-by-step guide,** not an export, script or Terraform. It puts the *why* next to every setting.
- **The deployed Action is the source of truth.** When my repo copy drifted, I copied the deployed version into the repo.
- **A public repo,** with no secrets committed, and commits under a private noreply email.
- **Smaller ones:** a Back-button hint in the step-up dialog (adding a Cancel link to Auth0's page needs a custom domain); account numbers fixed at 12 digits for the demo; an auto-assigned tenant name in the US region.

---

## 5. Trade-offs

| Decision | What I gave up | Why that was acceptable |
|---|---|---|
| Regular Web Applications | A modern single-page feel, and showing token checks at an API | Step-up can't be bypassed from the browser, and there are fewer moving parts |
| Stable Express SDK over the beta | The newest SDK | Reliability for a live demo |
| Express 4 | The current major version | One less unknown while building auth flows; still supported |
| Authorization code flow | A client secret per app to protect | It removes the 2-minute login limit, and it's Auth0's recommended flow |
| Google login off | One-click social login | The brief asks for a password or passkey |
| Progressive enrollment off | Nudging password users toward passkeys | Fewer screens in the core flows; I'd turn it back on later |
| No MFA at login | A stolen password exposes sales and earnings (view only) | Money sits behind step-up; viewing is low-sensitivity |
| Authenticator-app codes | Phishing resistance | Reliable, no hardware needed, and the payout hold contains real-time phishing |
| MFA setup at sign-up | An extra 30 to 60 seconds at sign-up; old accounts without a factor need support | It closes the enrollment hijack |
| A fresh, single-use code per change | A code for every change, and again after an accidental Cancel | Payout changes are rare |
| Staying logged in after a failed code | An attacker who fails also stays logged in | They still can't change anything |
| 5-day payout hold | The artist waits longer for the next payout after a change | No money leaves before the artist can notice and react |
| Logout ends this app and Auth0 only | The other app stays viewable on a shared computer | A payout change there still needs a full login plus the code |
| 15-minute idle lock on Payouts | It can look like SSO broke; it's per artist, not per device, and kept in memory | The sensitive app should be stricter than the baseline app |
| Passkey recovery left to built-in options | A passkey-only artist who loses access has no designed recovery | Synced passkeys and "use a phone" cover most cases |
| Email verification at the default | Email ownership isn't proven | Not required by the brief; I'd require it in production |
| "No email" enforced by a setting | The rule lives in the dashboard, not in code | Documented; I'd enforce it in the Action in production |
| Developer view | Authentication details shown on screen | Demo only; it would be removed in production |
| Written tenant guide | It can drift from the live tenant | Readable, and it explains why; I'd manage the tenant as code in production |
| Auto-assigned tenant name | A random-looking domain in login URLs | Cosmetic only; a production tenant gets a deliberate name |

---

## 6. What I'd do differently

### With more time
- **Live tests for every state,** including logging out and a full stolen-cookie run in a second browser profile, plus the idle-lock tests.
- **The automated tests in the repo, running on every change,** not just during development.
- **The native app, external user store bonus**
- **An account recovery flow** for artists whosign up with only a passkey and lose access to it.
- **Self-service factor management:** letting artists add a passkey or remove a factor, behind its own step-up, with an email alert. Auth0's My Account API is designed for this.

### For a production version

**Security**
- **Phishing-resistant step-up.** Offer security keys or device passkeys as MFA factors, and shorten the payout hold when step-up used one.
- **Real alerts.** Email the artist whenever their payout account changes, with a one-click "this wasn't me" path. Today, the note only appears on the dashboard.
- **Require a verified email** before payout changes.
- **Server-side sessions,** so logging out or revoking a session kills stolen cookies too.
- **Log out everywhere** from either app.
- **Progressive enrollment back on,** to move password users toward passkeys.
- **CSRF tokens on the forms,** as defense in depth. Today they rely on the session cookie's SameSite default.
- **A per-device idle lock,** using a shared store instead of memory.
- **Enforce "no email factor" in the Action,** not only in the dashboard.

**Platform**
- **A custom domain, set before passkeys,** since passkeys are tied to the login domain.
- **Real `https` domains,** with `localhost` removed from both applications.
- **The tenant as code** (Auth0 Deploy CLI or Terraform), with separate, deliberately named development, staging and production tenants.
- **A paid plan with Pro MFA,** so authenticator-app step-up keeps working.
- **A real database** for payout accounts, holds and verifications, which today live in memory.
- **Secrets in a secrets manager,** rotated regularly, with fresh cookie keys per environment.
- **Auth0 logs streamed** to a monitoring tool, with alerts on payout changes and repeated step-up failures.
- **The Developer view removed.**
- **Express 5, or Auth0's newer Express SDK** once it's generally available.

**Product**
- **Roles,** so studio assistants can upload art without touching payouts.
- **International payouts** (IBAN and other formats).
- **Metrics I'd track:**
  - authenticator setup completion at sign-up
  - step-up success and abandonment rates
  - "contact support" hits for a missing authenticator
  - payout holds disputed or reversed
  - the share of artists using passkeys over time

---

## 7. How I used AI

I used Claude Opus 5.5 throughout, and kept an AI usage log of what I asked, what I got back, whether it was right, and how I checked.

### Where I used it
- **Research:** pricing and plan limits, Auth0 docs, and community answers. I always asked for the source, and checked who actually said it.
- **Design:** challenging my user states, journeys and UI spec, and arguing the other side of my decisions.
- **Code:** Claude wrote most of the application code and the Action from my specs and decisions. I went through it block by block, ran it, and tested every flow live.
- **Testing:** simulated logins for the Action before deploying it, automated tests for Payouts, and a written 45-case test plan that I ran myself.
- **Debugging:** diagnosing problems from my screenshots and error messages.


### What I kept for myself
Every decision in this README is mine: the scenario, the users, what to build and what to defer, and every trade-off. I verified Auth0 claims against the docs and my own dashboard, ran every test myself, and wrote my decision, friction and work logs. My rules for working with AI: ask for sources, check them, turn uncertainty into a test, never paste secrets, and log both what worked and what didn't.
