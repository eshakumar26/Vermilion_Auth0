# Vermilion

Vermilion is an art marketplace made up of two applications: 
1. **Studio**, where artists showcase their work, and 
2. **Payouts**, where they manage their earnings. Both run on one Auth0 tenant. An artist logs in once, moves between the apps without logging in again, and has to prove it's really them before changing where their money goes.

## The problem

On creator platforms, account takeovers often don't steal money directly. Attackers redirect payouts: they change the payout bank account so the next payout lands with them, usually by riding a session the artist is already logged into (for example, cookies copied by malware). The change itself moves no money, so nobody notices until payday. Platforms treat this as high-risk; Patreon, for example, holds payouts for 5 days after payout details change.

The product question I designed around: **how do we keep everyday work frictionless, while making sure a stolen session alone can never redirect an artist's money?**

## Why an art marketplace

The brief asked for a Baseline App and a Sensitive App sharing one login, with one operation that requires step-up. I wanted a scenario where the two apps genuinely differ in risk, and where the sensitive operation is a real attack pattern.

| Scenario | Sensitive operation | Why I didn't pick it |
|---|---|---|
| Bank | Send money to a new payee | The clearest risk, but the default choice, and it only covers money movement |
| Smart home | Unlock a door remotely | Vivid, but a separate locks app is less standard, and the risk is physical rather than account-based |
| Airline loyalty / gaming | Transfer miles / trade a rare item | The risk is less clear-cut and can feel trivial |
| Software company | Change MFA settings | A whole separate security app doesn't fit the two-app structure naturally |
| **Creator marketplace** | **Change the payout bank account** | **Picked** |

The trade-off I accepted: payout redirection needs one sentence of setup to explain, where a bank transfer explains itself, and the harm is delayed rather than immediate. That delay is exactly what makes it dangerous, and it makes for a stronger story about protecting the moment of change.

## Users

I used one rule to decide who's in scope: **a user type earns a spot only if it changes the authentication design the brief asks for.**

**Primary user: the artist.** They sign up on their own (B2C), spend most of their time in Studio managing artworks and sales, and occasionally visit Payouts. Their needs pull in two directions: everyday work should be fast, with one login across both apps, while their money should be hard to touch for anyone but them. They're the only person who goes through every flow in the brief: login, SSO and step-up.

**Anti-persona: an attacker holding the artist's session.** They have stolen cookies, and possibly the artist's password, phished or reused from another site. They can browse anything the artist can. Their goal is to change the payout account. Designing against them drove my most important decisions: where step-up happens, which factor is used, and never offering MFA setup at the moment of step-up.

**Out of scope:**
- **Buyers and collectors** use a storefront, not Studio or Payouts.
- **Studio assistants** would upload art without touching payouts. That's a roles-and-permissions problem (authorization, not authentication), and Role Management isn't on the Free plan.
- **Vermilion staff** would need a separate admin app with a stricter login.

## Assumptions

1. **Studio is low-risk.** It shows artworks, views and sales. Nothing in it moves money or changes security settings. If it ever did, that action would move to Payouts or get its own step-up.
2. **Payouts is "sensitive" because of one operation, not every screen.** Viewing earnings and the masked account is read-only; changing the account is the risk.
3. **The main threat is a stolen session, not just a stolen password.** A second password prompt wouldn't stop session theft; a different factor at the moment of risk does.
4. **Payout changes are rare.** Asking for a code on every change is acceptable friction.
5. **Artists have a smartphone** and can use an authenticator app.
6. **Sign-up is the one moment we're sure it's really the artist**, because they just created their credentials.
7. **Some artists' devices can't use passkeys**, so passwords stay available.
8. **Payouts go out weekly, on Mondays.**
9. **This is a demo environment:** `localhost`, test accounts, and a free Auth0 tenant on its trial.

## Goals

**From the brief:**
- Artists can log in with a passkey **or** a password.
- Moving between Studio and Payouts never asks them to log in again (SSO, both directions).
- Changing the payout account requires a step-up challenge, even with an active session, using any MFA factor except email.

**Product principles I held myself to:**
- **Extra proof at the moment of risk, not at the door.** One login gets you in; money needs fresh proof.
- **The server is the bouncer.** Buttons and dialogs are just screens; the real check happens on the server when the change is saved.
- **Never hand the enrollment screen to someone we can't confirm.** MFA setup happens at sign-up, never at step-up.
- **Make it visible.** A Developer view in each app shows how you logged in and when, so SSO and step-up can be seen, not just claimed.

## Out of scope (non-goals)

- A recovery flow for artists who lose their passkey. Synced passkeys and "use a phone" cover most cases.
- Logging out of both apps at once. Each app ends its own session and Auth0's.
- Roles and delegated access, such as studio assistants.
- Requiring a verified email before payout changes. I'd add it in production.
- Storing users outside Auth0 (the optional external user store).
- Production hosting, custom domains and real payments.


## What I built

| Component | What it is | Role |
|---|---|---|
| **Vermilion Studio** | Express app, `localhost:3000` | Baseline App: artworks, sales, one login |
| **Vermilion Payouts** | Express app, `localhost:3001` | Sensitive App: earnings, payout account, step-up on change |
| **Auth0 tenant** | Universal Login; one database connection with passkeys and passwords; authenticator-app MFA | Identity for both apps, and the SSO session between them |
| **Login rules (Auth0 Action)** | One post-login Action | Every MFA decision, in one place |
| **Testing** | A 45-case manual test plan; run during development | Evidence that the flows, and the attacks on them, behave as designed |

Every Auth0 setting, and the reason for it, is in the [tenant setup guide](docs/tenant-setup.md).

### How I worked

I treated this like a small product build rather than a coding exercise:

1. **Research:** what makes an app "baseline" or "sensitive", when SSO and MFA belong together, and how passwords and passkeys compare. I also checked that a free Auth0 tenant covers the brief.
2. **Users:** who uses these apps, and who attacks them.
3. **User states:** every situation an artist or attacker can be in, prioritized.
4. **Journeys:** what happens, screen by screen, in each state that matters.
5. **UI spec:** what each screen shows, locked before writing code.
6. **Build:** Studio first, then Payouts.
7. **Test:** a 45-case test plan, then fixes for what testing found.

Throughout, I kept four logs: a **work log** (every step), a **decision log** (each decision with the options, the trade-off, and what would change my mind), a **friction log** (everywhere Auth0 or its docs slowed me down), and an **AI usage log**.

**Decision: build Studio first, end to end.** The tenant settings and the Action are shared by both apps, so proving them on the simpler app first meant any later bug would be Payouts-only. It paid off. Two serious issues were caught before Payouts existed: an Action that was deployed but never running, and artists who could end up with no MFA at all.

---

### 1. User states: analyzed, prioritized, deferred

I started by mapping 25 states across five groups: logging into Studio, getting into Payouts, using the sensitive action, leaving, and attacking. I gave each a priority, then refined the list into **18 states** to design in detail: some merged, and I added one attacker who skips the UI entirely. 16 of them are built into the apps; 2 were inputs to decisions rather than features.

#### The 18 states I carried forward

| # | State | What happens |
|---|---|---|
| **Getting in** | | |
| 1 | New artist, no account | Signs up on Auth0's page with a password or a passkey, sets up an authenticator app, lands in the app (Studio or Payouts) |
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
| 17 | Has the artist's password | *Decision input:* can log in, but step-up blocks the change. Led me to offer passkeys alongside passwords |
| 18 | Phishes a code in real time | *Decision input:* authenticator codes can be relayed by a fake site. Led to the payout hold, and to security keys as the production answer |

#### What I deliberately didn't build as separate flows

| State | Why |
|---|---|
| Studio session still active | The SDK lets the artist straight in; nothing to design |
| Studio session expired, Auth0 session still alive | SSO handles it (same as states 4 and 6) |
| Wrong or forgotten password | Auth0's hosted page handles the error and the reset email |
| Auth0 session expired, Payouts never opened | A normal login (state 5) |
| Walks away, browser left open | Sessions expire by default. Testing later showed that wasn't strict enough for Payouts (see section 4) |
| Cookies stolen right after step-up | Contained by design: each verification works once, within 10 minutes |
| Cookies stolen, then the artist logs out | The copied app cookie still works until it expires (a production item), but step-up still blocks payout changes |
| Push-notification fatigue | Doesn't apply: I didn't use push |

#### Decisions made at this stage

- **Ask for a fresh code even if MFA already happened in the session.** That's the heart of "step-up even with an active session". Auth0's docs don't say plainly whether it re-asks, so I made it a test, and the test confirmed it does.
- **One change per verification, within 10 minutes.** A time window would let a stolen session ride a fresh proof. Single-use leaves nothing to ride, and payout changes are rare, so the friction is minimal.
- **Set up MFA at sign-up, never at step-up.** Offering setup at step-up lets an attacker enroll their own phone. Sign-up is the one moment we're sure it's really the artist.
- **Passkey users still step up.** A passkey protects the login, not the session cookie afterwards.
- **Offer both passkeys and passwords,** with the stolen-password state as the argument for passkeys.
- **Accept that codes can be phished in this demo,** and contain it with a payout hold.

---

### 2. Key journeys

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

**Leaving.** Logging out ends that app's session and Auth0's, and lands on that app's own Signed out page. The other app stays viewable until its own session expires. On a shared computer, someone could still look at it, but a payout change there needs a full login plus the code.

---

### 3. UI spec

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

#### Decisions made at this stage

- **Both apps require login on every main page.** A public home page with a Log in button would never ask Auth0, so an artist already logged into the other app would still see a login prompt. That breaks SSO.
- **"Signed in as" shows the part before the @.** It identifies the account while putting less personal data on screen during screen-sharing.
- **A Developer view, for the demo only.** SSO and step-up are invisible by nature; matching login times across both apps make SSO visible. A real artist doesn't need this, and I wouldn't ship it (data minimization).
- **No MFA line in Studio.** Setting up the authenticator at sign-up isn't step-up, and showing "MFA: yes" in Studio would suggest step-up had already happened.
- **Separate failure messages by cause.** A step-up failure shouldn't look like being logged out, and "Try again" can't fix a missing authenticator.
- **Payouts gets its own Signed out page.** Landing on Studio's page after logging out of Payouts would show "Signed in as…", because Studio keeps its own session.
- **A friendly, public error page.** It never shows code details, and because it doesn't require login, an error can't loop.
- **Payout hold, decided while building Payouts.** If an attacker ever gets one change through, payouts pause for 5 days so no money leaves before the artist notices, and the artist can still change the account back.

---

### 4. What testing changed

My first full run of the test plan surfaced one real defect and about a dozen product questions. From those, I built:
- **A 15-minute idle lock on Payouts.** Both apps were still logged in after an hour of no activity. Payouts now asks for a password or passkey again after 15 minutes, in a way SSO can't quietly bypass. Studio is unchanged.
- **The verification's lifecycle in the Developer view:** when it was used for a change, or thrown away by Cancel, not just "not done yet".
- **A note in the step-up dialog** pointing to the browser's Back button, because Auth0's code screen has no Cancel link.
- **Field hints** on the change form: a 9-digit routing number and a 12-digit account number, matching what the server accepts.

The defect itself: the payout hold was missing on my machine. The code was right, but an older copy of the file had been saved over it. Re-testing after restoring it passed.

### For a production version

**Security**
- **Phishing-resistant step-up.** Offer security keys or device passkeys as MFA factors, and tie the payout hold to how strong the proof was.
- **Real alerts.** Email the artist whenever their payout account changes, with a one-click "this wasn't me" path. Today, the note only appears on the dashboard.
- **Require a verified email** before payout changes.
- **Server-side sessions,** so logging out or revoking a session kills stolen cookies too. Today, each app's session lives in its own cookie, so a copied cookie works until it expires.
- **Log out everywhere** from either app, through Auth0's back-channel logout or by chaining the two logouts.
- **Self-service factor management behind step-up,** with alerts.
- **Progressive enrollment back on,** to move password users toward passkeys.
- **CSRF tokens on the forms,** as defense in depth. Today they rely on the session cookie's SameSite default.
- **A per-device idle lock,** using a shared store instead of memory.
- **Enforce "no email factor" in code,** not only in the dashboard.

**Platform**
- **A custom domain, set before passkeys,** since passkeys are tied to the login domain.
- **Real `https` domains,** with `localhost` removed from both applications.
- **The tenant as code** (Auth0 Deploy CLI or Terraform), with separate, deliberately named development, staging and production tenants.
- **A paid plan with Pro MFA,** so authenticator-app step-up keeps working.
- **A real database** for payout accounts, holds and verifications. Today they live in memory and reset on restart.
- **Secrets in a secrets manager,** rotated regularly, with fresh cookie keys per environment.
- **Auth0 logs streamed** to a monitoring tool, with alerts on payout changes and repeated step-up failures. The Free plan keeps logs only briefly.
- **The Developer view removed.** It's a demo tool, and real artists don't need to see their own authentication details.
- **Express 5, or Auth0's newer Express SDK** once it's generally available.

**Product**
- **Roles,** so studio assistants can upload art without touching payouts.
- **International payouts** (IBAN and other formats) instead of US-only routing and account numbers.
- **Metrics I'd track:**
  - authenticator setup completion at sign-up (where artists drop off)
  - step-up success and abandonment rates
  - how often artists hit "contact support" for a missing authenticator
  - how often a payout hold is disputed or reversed
  - the share of artists using passkeys over time
