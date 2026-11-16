# Vermilion

Vermilion is an art marketplace for independent artists, made up of two web applications that share one Auth0 tenant: 
**Vermilion Studio**
**Vermilion Payouts**

Picture a painter who sells her work through Vermilion. Most days, she's in Vermilion Studio. She signed up once, with a passkey or a password, and set up an authenticator app on her phone at the same time. Studio is where she shows her artworks and keeps an eye on recent sales: which piece sold, for how much, and when. Nothing in Studio moves money, so getting in is quick and nothing asks her for extra proof.

Every so often, she checks on her earnings. One click on Go to Payouts takes her to Vermilion Payouts without logging in again. There she sees her next payout, the date it's paid (payouts go out weekly), and the bank account it's going to, masked to the last four digits. Going back to Studio is just as seamless.

The one thing that slows her down is the one thing that should: changing her payout account. It's exactly what someone holding her session would want to do, because her next payout would land with them. So before the change form even opens, Payouts asks for a fresh 6-digit code from her authenticator app, even though she's already logged in. Each code covers one change and lasts 10 minutes. After the change, her payouts pause for 5 days, so no money leaves before she'd notice a change she didn't make. And if she leaves Payouts idle for 15 minutes, it asks for her password or passkey again.

For this demo, both apps also have a collapsible Developer view. It shows how she logged in, when, and where her step-up verification stands, so SSO and step-up can be seen on screen.

**Quick links**
- [Tenant setup guide](docs/tenant-setup.md): every Auth0 setting, step by step, and why
- [The Auth0 Action](auth0/actions/vermilion-login-rules.js): all of the MFA logic

**Contents**
1. [The problem, and why an art marketplace](#1-the-problem-and-why-an-art-marketplace)
2. [Users, assumptions and scope](#2-users-assumptions-and-scope)
3. [What I built](#3-what-i-built)
4. [Key decisions](#4-key-decisions)
5. [Trade-offs](#5-trade-offs)
6. [What I'd do differently](#6-what-id-do-differently)
7. [How I used AI](#7-how-i-used-ai)
8. [Run it locally](#9-run-it-locally)
9. [Testing](#10-testing)
10. [Repo layout](#11-repo-layout)

---
## 1. The problem, and why an art marketplace

### The problem: payout redirection
When attackers take over an account on a platform that pays people, they often don't try to move money out. They change where the money goes. They swap the payout bank account for their own, and the platform sends the next payout to them. Nothing looks wrong at the moment of the change, because no money moves. The artist finds out on payday, when the money doesn't arrive.

### How common it is
- **It's a known pattern in payroll.** The FBI has warned that criminals use stolen employee logins to get into payroll accounts, swap the direct deposit for an account they control, and even set up rules so the employee doesn't see the change alerts. It asks companies to take a closer look at any direct deposit change. A creator's payout account is the same target under a different name.
- **Creators are targeted specifically, through stolen sessions.** In 2021, Google's Threat Analysis Group reported a campaign, running since 2019, that infected YouTube creators with malware to steal their browser cookies and take over their channels. Google restored about 4,000 accounts. It also noted that this technique may be making a comeback because more people use MFA: a stolen session skips the login, so it skips MFA too.
- **Session theft is growing.** Recorded Future found that 276 million stolen credentials it indexed in 2025 came with active session cookies, almost a third of everything stolen by malware. 
- **Marketplaces see it.** Etsy's seller forums have threads from sellers whose payout bank details were swapped by someone who got into their account.
- **Platforms already treat it as high-risk.** Patreon automatically locks payouts for 5 days whenever a creator adds or changes a payout method.
- **The money at stake is growing.** Goldman Sachs expects the creator economy to roughly double to $480 billion by 2027, with platform payouts among the main drivers.

### Why it's worth solving
Asking for MFA at login doesn't stop this attack, because a stolen session has already passed the login. The protection has to sit at the moment of the change: fresh proof from the artist, checked by the server, and a safety net (a payout hold) in case something still gets through. That's exactly what the brief asks for: step-up on a sensitive operation, even with an active session. In this scenario, the threat explains every design decision I made.

The product question I designed around: **how do we keep everyday work frictionless, while making sure a stolen session alone can never redirect an artist's money?**

### The scenarios I considered
The brief needed two apps sharing one login: a low-risk Baseline App and a Sensitive App with one operation that requires step-up.

| Scenario | Baseline App | Sensitive App | Sensitive operation | Why I didn't pick it |
|---|---|---|---|---|
| Bank | Account overview | Payments | Add a new payee and send money | The obvious example, and nothing in a bank is truly low-risk: balances and transactions are sensitive too. A frictionless "baseline" app would be hard to justify |
| Airline loyalty | Book and manage trips | Miles wallet | Transfer miles to another member | Real fraud, but miles feel like a perk, not someone's income, so the harm is harder to feel |
| **Art marketplace** | **Studio: artworks and sales** | **Payouts: earnings** | **Change the payout bank account** | **Picked** |

### Why I chose the art marketplace
1. **The threat is real, current and documented.** Payout redirection happens to payroll accounts, creators and marketplace sellers.
2. **It's exactly the brief's hard case.** The attacker already has a session. MFA at login wouldn't stop them; step-up at the moment of the change does. The scenario makes "step-up even with an active session" necessary, not decorative.
3. **The two apps genuinely differ in risk.** Making art and getting paid are different jobs. Studio holds nothing that moves money, so it can stay frictionless. Payouts holds one dangerous action, so the extra proof goes there and nowhere else. A bank can't make that split honestly.
4. **There's a real benchmark to design against.** Patreon's 5-day payout lock is a proven mitigation, so I adopted it (the payout hold) rather than inventing my own.
   
---
## 2. Users, assumptions and scope

### Users
I used one rule to decide who's in scope: **a user type earns a spot only if it changes how login and step-up need to work.**

**The artist (primary user)**
An independent artist who signs up on their own. They spend most of their time in Vermilion Studio, managing artworks and checking sales, and visit Vermilion Payouts now and then to check their earnings. They need two things that pull in opposite directions:
- **Everyday work should be fast:** one login, and moving between the two apps without logging in again.
- **Their money should be hard to touch** for anyone but them.

The artist is the only user who goes through every flow in the brief: login, SSO and step-up.

**The attacker (anti-persona)**
Someone who has stolen the artist's session cookies, for example with malware, and possibly their password too. With those, they can browse both apps as the artist. What they want is to change the payout account, so the next payout goes to them. Designing against this person shaped how step-up works.

**Users I left out**

| User | Why they're out |
|---|---|
| Buyers and collectors | They shop in a storefront, not in Studio or Payouts |
| Studio assistants | They'd upload art without touching payouts. That's a question of what someone is allowed to do (authorization), not how they log in (authentication) |
| Vermilion staff | They'd need a separate admin app with a stricter login |

### Assumptions
Each assumption shaped a specific part of the design.

| # | Assumption | What it changed in the design |
|---|---|---|
| 1 | **Studio is low-risk.** It shows artworks and sales. Nothing in it moves money or changes security settings | One login is enough for Studio, with no extra proof. If Studio ever gained a risky action, that action would get its own step-up |
| 2 | **Payouts is sensitive because of one action, not every screen.** Viewing earnings and the masked account is read-only | No extra proof to open Payouts. Step-up happens only on "Change payout account" |
| 3 | **The main threat is a stolen session.** Malware that steals cookies often takes saved passwords too | Asking for the password again isn't enough. Step-up asks for a code from the artist's phone, which the malware doesn't have |
| 4 | **Payout changes are rare** | Asking for a fresh code on every change is acceptable friction |
| 5 | **Artists have a smartphone** | An authenticator app works as the step-up factor |
| 6 | **At sign-up, the person creating the account really is the artist.** Later on, the person clicking might be someone holding a stolen session | The authenticator is set up at sign-up, and never offered during step-up |
| 7 | **Some artists' devices can't use passkeys** | Passwords stay available alongside passkeys |
| 8 | **Payouts go out weekly** | The 5-day payout hold is shown against a real next-payout date |

### Goals
**What the brief requires:**
- Artists can log in with a passkey **or** a password.
- Moving between Studio and Payouts, in either direction, never asks them to log in again (SSO).
- Changing the payout account needs extra verification (step-up), even when the artist is already logged in, using any MFA method except email.

**The principles I held myself to:**
- **Ask for extra proof at the moment of risk, not at the door.** One login gets you into both apps; changing where money goes needs fresh proof.
- **The server makes the final check.** Buttons and dialogs only guide the artist. The real check happens on the server when the change is saved, so skipping the screens doesn't help an attacker.
- **Only set up MFA when we know it's the artist.** That means at sign-up, never in the middle of a step-up, where an attacker could register their own phone.
- **Make the invisible visible.** A Developer view in each app shows how you logged in and when, so SSO and step-up can be seen in the demo, not just claimed.

### What I didn't build (non-goals)
- Account recovery for an artist who loses their passkey
- Logging out of both apps at once
- Roles, so an assistant could work in Studio without touching money
- Requiring a verified email before payout changes
- Email alerts when the payout account changes
- Letting artists add or remove their own sign-in methods
- Production hosting, custom domains and real payments

---

## 3. What I built

Vermilion is made up of five pieces that work together.

**Vermilion Studio** is the Baseline App. It's a small Express web app that runs at `localhost:3000`, where artists see their artworks and recent sales. It only needs one login, and it never asks for extra proof, because nothing in it can move money.

**Vermilion Payouts** is the Sensitive App. It's a second Express web app, at `localhost:3001`, where artists see their next payout and the account it's paid to. It's the only place that asks for extra proof (step-up), and only when the artist tries to change the payout account.

**The Auth0 tenant** handles identity for both apps. Both apps use Auth0's hosted login page (Universal Login), one user database that supports both passkeys and passwords, and an authenticator app as the second factor. Auth0's own session is what lets an artist move between the two apps without logging in again (SSO).

**The login rules** are a single Auth0 Action that runs after every login, for both apps. Every MFA decision lives here: when to ask an artist to set up their authenticator, when to require a code, and when to refuse.

**The test plan** is 45 test cases covering every flow in the brief, and the attacks against it. 

### How I worked
I treated this like a small product build rather than a coding exercise, and worked in this order:

1. **Research.** I looked at what makes an app "baseline" or "sensitive", when SSO and MFA belong together, and how passwords and passkeys compare. I also checked that a free Auth0 tenant covers everything the brief asks for.
2. **Users.** I decided who uses these apps, and who would attack them.
3. **User states.** I listed every situation an artist or an attacker can be in, and prioritized them.
4. **Journeys.** For each state that mattered, I wrote down what happens, screen by screen.
5. **UI spec.** I wrote down exactly what each screen shows, and locked it before writing any code.
6. **Build.** I built Studio first, end to end, and then Payouts and integrated them as required.
7. **Test.** I wrote a test plan, ran it, and fixed what it found.

Throughout the project, I kept four logs:
- a **work log** of every step I took
- a **decision log** with each decision, the options I considered, the trade-off, what would change my mind and what i would do better in production.
- a **friction log** of everywhere Auth0 or its documentation slowed me down
- an **AI usage log** of what I asked AI tools, what I got back, and whether it was right

### User states
A user state is a situation someone can be in when they arrive at an app: for example, logged into one app but not the other, or already verified for a payout change. Listing them is how I made sure every path had a designed answer, not just the happy path.

I started with 25 states across five groups: logging into Studio, getting into Payouts, using the sensitive action, leaving, and attacking. I gave each one a priority, merged the ones that behaved the same way, and ended up with **18 states** to design in detail.

| # | Situation | What happens |
|---|---|---|
| **Getting in** | | |
| 1 | A new artist, with no account yet | They sign up on Auth0's page with a password or a passkey. Before reaching the app, they set up an authenticator app by scanning a QR code. Then they land in whichever app they started from. |
| 2 | A returning artist, not logged in anywhere | The app sends them to Auth0's login page. They log in and land on the app's dashboard. |
| 3 | A returning artist who uses a passkey | On Auth0's page, they choose "Continue with a passkey" and confirm with their fingerprint or face. They land in the app, with no password and no code. |
| 4 | Logged into Payouts, then opens Studio | There's no login screen. Studio asks Auth0, Auth0 recognizes the artist, and Studio starts its own session. This is SSO. |
| 5 | Opens Payouts first, not logged in anywhere | Payouts sends them to the same Auth0 login page Studio uses. After logging in, they land on the Payouts dashboard. |
| 6 | Logged into Studio, then opens Payouts | There's no login screen. Payouts asks Auth0, Auth0 recognizes the artist, and Payouts starts its own session. |
| **Changing the payout account** | | |
| 7 | Has an authenticator, and hasn't verified recently | Payouts asks for a fresh 6-digit code. Once the code is accepted, the artist can make the change. |
| 8 | Started verifying, then cancelled or got the code wrong | Nothing changes. The artist stays logged in, and can try again whenever they want. |
| 9 | Already did MFA earlier in the session, at sign-up or for a previous change | Earlier MFA gives no free pass. Every payout change asks for a fresh
| 10 | Verified a few minutes ago, and wants to change the account again | Asked for a new code. Each verification covers exactly one change. |
| 11 | Never set up an authenticator | Prevented by design: setup is part of sign-up. If the artist skips it, they're asked again the next time they actually log in. If an account still has no authenticator, payout changes are blocked, and step-up never offers setup. |
| 12 | Logged in with a passkey | Passkey users get the same code step-up as password users. Logging in with a passkey doesn't skip it. |
| **Leaving** | | |
| 13 | Logs out of either app | That app's session and Auth0's session both end, and the artist lands on that app's own signed-out page. |
| **Attackers** | | |
| 14 | Stole all of the artist's cookies | They can browse both apps as the artist. When they try to change the payout account, they're asked for a code from the artist's phone, and they're stuck. |
| 15 | Stole the cookies of an artist who has no authenticator | Blocked. Step-up never offers "set up MFA now", so an attacker can't register their own phone. |
| 16 | Skips the button: opens the change form's address directly, or sends the Save request without verifying | The server refuses, because it checks for a valid verification when the form opens and again when Save is submitted. |
| 17 | Has the artist's password (phished, or reused from another site) | *Not built; used as a decision input.* They can log in, but step-up still blocks the payout change. This is why passkeys are offered alongside passwords: a passkey has no password to steal. |
| 18 | Tricks the artist into typing a code on a fake site, and relays it in real time | *Not built; used as a decision input.* Authenticator codes can be relayed this way; passkeys and security keys can't. This is why every change starts a 5-day payout hold, and why I'd use security keys in production. |

### Key journeys

**Signing up.** The artist opens Studio (or Payouts) and is sent to Auth0's page, which asks for their email first. They create a password or a passkey. Before they reach the app, Auth0 asks them to set up two-step verification: they scan a QR code with an authenticator app and type one code to confirm it works. Then they land in the app, logged in. If they close the page at the QR step, they're asked to finish setup the next time they log in, until it's done.

**Logging in.** Auth0's page shows an email box and a "Continue with a passkey" button. An artist with a passkey confirms with their fingerprint or face; an artist with a password types it after their email. Neither is asked for a code at login.

**Moving between the apps (SSO).** The artist clicks Go to Payouts in Studio, or Back to Studio in Payouts. The screen flashes briefly, and the other app opens with no login screen. Behind the scenes, the app has no session of its own yet, so it asks Auth0, and Auth0 recognizes its own session and confirms who the artist is. Both apps' Developer views then show the same "Logged in at" time, which proves no second login happened.

**Changing the payout account (step-up).**
1. The artist clicks Change payout account. The server checks for an unused verification from the last 10 minutes, finds none, and shows a dialog explaining that this change needs extra verification.
2. They click Continue. Auth0 asks for the 6-digit code from their authenticator app, and nothing else: no password, no email option, and no "remember this browser" checkbox.
3. The change form opens. It shows when they verified, with hints under the fields: 9 digits for the routing number and 12 for the account number.
4. They click Save. The server checks the verification again, saves the new account, and marks the verification as used, so it can't be reused.
5. A success page confirms the new account's last four digits. Back on the dashboard, the next payout shows "On hold until…" with the date it was originally scheduled for, and a "Not you? Contact support" note.

**When step-up doesn't succeed.** The artist always stays logged in, and sees one of three messages, depending on what happened:
- **They cancelled, or the code failed:** "Verification wasn't completed. Your payout account wasn't changed." They can try again.
- **Their account has no authenticator:** they're asked to contact support. Step-up never offers setup.
- **Their verification expired or was already used by the time they clicked Save:** "Your verification expired. Please verify again."

**Leaving.** Logging out of either app ends that app's session and Auth0's session, and lands on that app's own signed-out page. The other app stays open until its own session expires, but a payout change there would need a full login plus the code. Payouts also locks itself after 15 minutes without activity, and asks for the password or passkey again.

### UI spec
I wrote the UI spec for both apps and locked it before building, so the code had a clear target and any difference from the plan would be easy to spot.

**Vermilion Studio** (Baseline App)
- The header shows "Vermilion Studio" on the left, and "Signed in as …", Go to Payouts and Log out on the right. "Signed in as" shows the part of the email before the @, to keep personal data off the screen.
- The page shows the artist's artworks, and a short list of recent sales: which artwork sold, for how much, and when.
- A collapsible Developer view shows how the artist logged in (password or passkey), when, and the step-up status, which is always "not done yet" in Studio, because step-up only happens in Payouts.
- A public signed-out page shows "Vermilion Studio" with Log in and Sign up buttons. A public error page explains if a login goes wrong, without showing any code details.

**Vermilion Payouts** (Sensitive App)
- It has a visibly different look, with a vermilion header, so it's obvious in a demo that you've switched apps. The header shows "Vermilion Payouts", "Signed in as …", Back to Studio and Log out.
- It shows the next payout amount and its date. Payouts go out weekly, on Mondays. After a payout account change, the date reads "On hold until …", with "Was scheduled for …" underneath, and a note saying when the account was changed, followed by "Not you? Contact support."
- It shows the payout account, masked to the last four digits.
- The Change payout account button is the sensitive action. Clicking it opens a dialog explaining that the change needs extra verification. The dialog also mentions that Auth0's next screen has no Cancel button, so to back out, the artist uses the browser's Back button.
- After verification, the change form asks for the account holder, the routing number and the account number (masked), with Save and Cancel buttons. Cancel returns to the dashboard and throws the verification away, so the next change asks again.
- After Save, the artist sees one of four messages: success (with the payout hold), verification not completed, no authenticator set up, or verification expired or already used.
- A collapsible Developer view shows how the artist logged in, when, and exactly where their step-up verification stands: not done yet, done and unused (with when it expires), used for a payout change (and when), thrown away with Cancel (and when), or expired before it was used.
- Payouts has its own public signed-out page ("You're signed out of Payouts", with Log in and Back to Studio buttons), and its own public error page.

### What testing changed
My first run of the test plan found one real defect and raised about a dozen product questions. From those, I built four changes:
- **A 15-minute idle lock on Payouts.** Both apps stayed logged in after an hour of no activity, which is too relaxed for the app that controls money. Payouts now asks for a password or passkey again after 15 minutes without activity, in a way SSO can't quietly skip. Studio is unchanged.
- **The verification's full history in the Developer view.** Before, it only showed "not done yet" or "used". Now it also shows when a verification was used for a change, and when it was thrown away with Cancel.
- **A note in the step-up dialog** pointing to the browser's Back button, because Auth0's code screen has no Cancel link.
- **Hints under the form fields,** showing that the routing number is 9 digits and the account number is 12, matching what the server accepts.

---
## 4. Key decisions

Where the brief was open-ended, I had to make a choice. This section lists every decision I made, grouped by topic. Each row shows the question I had to answer, the options I considered, what I chose, why I chose it, and why I didn't choose the others. I logged each decision as I made it, along with the trade-off I accepted. Section 5 sums up those trade-offs.

### 4.1 Tenant, tech stack and build

| Decision | Options I considered | What I chose | Why | Why not the others |
|---|---|---|---|---|
| Which application type should each app be in Auth0? | Single-page app for both · Regular web app for both · One of each | Regular web app for both | The server checks step-up before the change runs, so nothing in the browser can skip it. Tokens stay on the server, and there's no separate API to build. | A single-page app would need a separate API to enforce step-up properly, and relies on background session checks that browsers blocking third-party cookies can break. One of each doubles the work and proves nothing extra. SSO works the same either way. |
| Which framework? | All 21 options on Auth0's quickstart list for regular web apps (Express, Next.js, Flask, Django, Spring Boot, ASP.NET, Rails and others) | Express (Node.js) for both apps | Auth0's Express SDK is mature and handles login, logout and sessions, and protecting a page takes one line. | I narrowed the list in steps. Apache and NGINX are web servers, not app frameworks. I dropped languages I can't explain line by line (Java, .NET, Go, PHP, Ruby). Next.js, Nuxt and Django spread login logic over many files. Fastify, Hono and FastAPI have fewer examples or are built for APIs. Flask's Auth0 SDK is still in beta. |
| How should the apps connect to Auth0? | Auth0's stable Express SDK · Auth0's newer beta Express SDK · A generic OpenID Connect library · Writing the login flow by hand | The stable Express SDK (`express-openid-connect`) | Token checks and session security are easy to get wrong. A maintained, open-source SDK that Auth0's own quickstart uses is safer and faster, so my time went into page protection and step-up. | The beta SDK isn't generally available yet, which is a risk in a live demo. A generic library means more setup and no Auth0 quickstart. Writing it by hand is where security bugs come from. |
| The quickstart was missing libraries and crashed. Which fix, and which Express version? | Install only the missing library · Install every library the code uses, on Express 4 · Install every library, on Express 5 | Every library listed, on Express 4 | The project now lists every library it uses. Express 4 is what the Auth0 SDK's own tests run on, and it's still supported. | Installing only the missing library leaves two others working by accident. Express 5 handled the basics, but login with this SDK on Express 5 was untested, and I didn't want an extra unknown while building SSO and step-up. |
| How should the apps receive the login result from Auth0 on `http://localhost`? | The authorization code flow, with a client secret per app · Run local https · Keep the quickstart's setting and log in quickly | The authorization code flow, with a client secret per app | Over http, the quickstart's setting only works if a login finishes within about 2 minutes (a browser limit). A sign-up with a QR scan, or a step-up during panel questions, could take longer. The code flow is Auth0's recommended flow for web apps, and switching was a small change. | Local https means certificates, and new URLs everywhere in Auth0. Rushing logins means a login could fail mid-demo. |
| How do I stop the two apps' sessions colliding on `localhost`? | A different session cookie name per app · Different hostnames (`localhost` and `127.0.0.1`) | A different cookie name, and a different secret key, for each app | Browsers share cookies across ports on the same host, and the SDK gives every app the same cookie name by default, so the apps would overwrite each other. One setting per app fixes it. SSO comes from Auth0's session, not a shared cookie. | Two hostnames works, but means two addresses to remember and to register in Auth0. |
| What do I build first? | Studio, the tenant settings and the Action first, then Payouts · Payouts first, then connect the two | Studio, end to end, first | The tenant settings and the Action are shared, so proving them on the simpler app meant any later bug was Payouts-only. It caught two serious issues before Payouts existed: the Action wasn't running, and artists could end up with no MFA. | Building Payouts first means two unknowns at once, so it's harder to tell what broke. |

### 4.3 Logging in and SSO

| Decision | Options I considered | What I chose | Why | Why not the others |
|---|---|---|---|---|
| Passkey, password, or both? | Both, and the artist chooses at sign-up · Passkey only · Password only | Both | "A passkey or a password" can be read two ways, and offering both satisfies either reading. It also covers devices that can't use passkeys, and lets me demo both. | Passkey only shuts out some devices. Password only ignores passkeys. |
| Keep "Continue with Google", which new tenants have by default? | Keep it · Turn it off | Off, for both apps | With Google login, Google does the authenticating, which is neither a password nor a passkey. On a new tenant, it also runs on Auth0's shared test keys, which Auth0 says are for testing only and can cause problems with MFA. My own first test login went through Google by accident. | Keeping it adds a third login method the brief didn't ask for, on test-only keys. |
| Should Studio ask for MFA at login? | No MFA · MFA only for password users · MFA for everyone | No MFA: one factor (a password or passkey) gets you in | Studio is low-risk. With a stolen password, someone can see artworks and sales, but can't touch money. The extra proof goes where the risk is. | MFA for password users needs extra rules, and makes them do MFA twice (at login and at step-up). MFA for everyone adds the most friction and double-prompts passkey users. |
| Should opening Payouts require MFA? | One factor to open it, with step-up only on the change · MFA to open it, plus step-up on the change · MFA to open it, and nothing more | One factor to open it, with step-up only on "Change payout account" | An MFA prompt when arriving from Studio is a login prompt, which breaks SSO. MFA at the door also doesn't stop someone who steals the session afterwards. Viewing earnings is read-only; changing the account is the risk. | MFA at the door plus step-up adds friction and still needs step-up. MFA at the door alone fails the brief, because once you're in, the change wouldn't ask again. |
| Should either app have a public home page with a Log in button? | Login required on every main page, plus a public signed-out page · A public home page with a Log in button · A public page that silently checks Auth0 for a session | Login required on every main page, with a public signed-out page for each app | A public page never asks Auth0, so an artist already logged into the other app would still see a Log in button. That's a login prompt, which breaks SSO. Requiring login makes SSO work in both directions with no extra code. | A public home page breaks SSO in one direction. A silent check is extra code, and the SDK's helper only tries once per browser session. |
| Should Auth0 offer a passkey after a password login ("progressive enrollment")? | Turn it on · Leave it off for now | Off, for now | Both options are already available at sign-up. The offer adds a screen to every password login, which gets in the way of the flows I needed to prove first. | It's a good feature for getting more people onto passkeys, and I'd turn it on in production. |
| What happens if a passkey artist changes or loses their device? | Rely on synced passkeys and "use a phone" · Require a password as a fallback · Build a recovery flow | Rely on what's built in | Synced passkeys travel with the artist's Apple or Google account, and "use a phone" covers a nearby phone through a QR code. The brief doesn't ask for recovery. | A required password defeats the point of passkeys, since passwords are the part that can be phished. A recovery flow is the right production answer, but it's a project of its own and easy to get wrong in a rush. |
| What should "Signed in as" show? | The full email · The part before the @ · A display name collected at sign-up | The part before the @ | It identifies the account with less personal data on screen, which matters when screen-sharing. Auth0 already provides it, and it's the same in both apps, which helps show SSO. | The full email shows more personal data than needed. A display name needs extra setup for a cosmetic gain. |
| Should a verified email be required? | Block login until it's verified · Require it before payout changes · Keep Auth0's default (a link is sent, but login isn't blocked) | Auth0's default | The brief doesn't require it, and blocking would add a step to every sign-up in the demo. | It means email ownership isn't proven. In production, I'd require it before payout changes, because that's where "Not you?" alerts would go. |

### 4.4 The MFA factor and setting it up

| Decision | Options I considered | What I chose | Why | Why not the others |
|---|---|---|---|---|
| Which MFA factor for step-up? | Authenticator app code · Push notification · SMS · Voice call · Security key · Device fingerprint or face · Cisco Duo · Email (excluded by the brief) | An authenticator app code, with recovery codes as a backup | I scored each factor on the brief, security, independence from the first factor, demo reliability and effort. The code comes from a separate device, the artist's phone, for password and passkey users alike. It works offline, needs no hardware, and setup is one QR scan. | Device fingerprint: for passkey users, it's the same laptop and fingerprint as the login, so it isn't real extra proof. Security key: the strongest, but it needs hardware. Push: risks "MFA fatigue" and depends on notifications arriving live. SMS and voice: SIM-swap risk. Duo: needs a Duo account. Email: excluded. |
| When do artists set up their authenticator, and what if they never did? | At sign-up, and block payout changes without one · Later, at their first payout change, after a fresh login · On the spot at step-up (Auth0's default) | At sign-up. Step-up never offers setup, and an account without an authenticator can't change payouts | Sign-up is the one moment we're sure it's really the artist. Offering setup at step-up would let an attacker with a stolen session scan the QR code with their own phone and pass (an "enrollment hijack"). | Setting up at the first payout change is strong, but harder to build correctly. Setup at step-up defeats step-up entirely. |
| If an artist skips setup, when are they asked again? | On any login where they actually typed their password or used their passkey, until setup is done · Only on their first login | On every real login, until setup is done | Testing showed that an artist who closed the QR screen was never asked again, because Auth0 counted the abandoned login as their first. They'd then be blocked at Payouts with no way forward. | First login only strands artists. Asking on SSO visits too would let a cookie thief register their own phone. |
| How is "no email as an MFA factor" enforced? | Turn Email off in the tenant · Also restrict the Action to the authenticator code | Email is off in the tenant, and the Action asks Auth0 for any enrolled factor | With Email off, Auth0 can't offer it. It's one clear setting, documented in the setup guide. | Restricting the Action as well would protect against someone turning Email back on. It's on my production list. |
| Should Studio's Developer view show that MFA happened at sign-up? | Show "MFA in this login: yes" · Show only the step-up status | Only the step-up status ("not done yet") | Setting up the authenticator isn't step-up. Showing "MFA: yes" in Studio would suggest step-up had already happened. | It would be misleading in the demo. |

### 4.5 Step-up on the payout change

| Decision | Options I considered | What I chose | Why | Why not the others |
|---|---|---|---|---|
| How does Payouts ask for step-up, and how does it know it happened? | Auth0's documented step-up pattern · Turn on MFA for every login · Make the artist log in again | Auth0's documented pattern: Payouts asks Auth0 for MFA with a standard OpenID Connect request (`acr_values`), my Action requires the code, and Payouts checks the signed ID token to confirm MFA happened | It's Auth0's own pattern for web apps, and it asks for MFA only at the risky moment. The proof is a token signed by Auth0, so nothing in the browser can fake it. | MFA on every login adds friction everywhere. Logging in again repeats the first factor, which isn't MFA, so it fails the brief. |
| When does Payouts count a step-up as done? | Whenever the token says MFA happened · Only when the token answers Payouts' own step-up request | Only when it answers Payouts' own request. Payouts then records its own time | Setting up the authenticator at sign-up already marks Auth0's session as "MFA done", so an ordinary SSO login into Payouts can carry that too. | Trusting any "MFA" in the token would give a fresh sign-up a free pass. |
| If the artist did MFA earlier in the session, should step-up ask again? | Always ask for a fresh code · Accept the earlier MFA · Make them log in fully again | Always a fresh code, with no password or passkey prompt and no "remember this browser" | The brief says step-up applies even with an active session. MFA from sign-up could be days old, and someone who stole all the cookies, including Auth0's, still needs the artist's phone. Auth0's docs don't say plainly whether it asks again, so I tested it, and it does. | Accepting earlier MFA lets a stolen session through. A full login asks for the password again, but doesn't force the code. |
| How long does a verification count? | One change, within a time limit · Any number of changes for a few minutes · The rest of the session | One change, within 10 minutes | Single-use leaves nothing for a stolen session to ride, and payout changes are rare. Ten minutes covers filling in the form, with room for a slow artist or a live demo. | A time window lets someone who grabs the session right after step-up make changes. Once per session is MFA at the door again. |
| If the artist verifies and then clicks Cancel on the form, does the verification still count? | Cancel throws it away · Keep it until the 10 minutes run out | Cancel throws it away | One verification per change attempt is simple to explain and test, and leaves no ready-to-use proof sitting in the session. | Keeping it leaves a usable verification in the session for up to 10 minutes. |
| Where is step-up enforced? | On the server, when the form opens and when Save is submitted · On the button and dialog | On the server, at both points | Buttons and dialogs are just screens. Someone can type the form's address, or send the Save request directly. | The button alone can be skipped with a single request. |
| Do passkey users step up too? | The same code for everyone · Skip it for passkey users · Ask for the passkey again | The same code for everyone | The brief makes no exception for passkeys. A passkey protects the login, not the session cookie afterwards, and malware steals cookies either way. Auth0 doesn't treat a passkey as a separate MFA factor. | Skipping it leaves stolen sessions open. Asking for the passkey again means the same laptop and fingerprint as the login. |
| What happens when verification is cancelled or fails? | Stay logged in, and nothing changes · Log the artist out · Show a separate message for every reason | Stay logged in, nothing changes, and the artist can try again | Failures are usually typos. Logging out punishes the real artist and adds no protection, because an attacker can't pass the code anyway. Verification happens before the form, so there's never a half-made change. | Logging out punishes typos. A message for every reason reveals why it failed, and Auth0 doesn't send most reasons back anyway. |
| What does the artist see when something goes wrong? | One error page for everything · A different outcome for each kind of failure | A different outcome for each: a failed login gets a public error page; a failed step-up keeps the artist logged in with "Verification wasn't completed"; an account with no authenticator is asked to contact support; an expired verification asks them to verify again | Each case needs a different next step. A step-up failure shouldn't look like being logged out, and "Try again" can't fix a missing authenticator. | One page for everything is confusing, and its Try again would loop forever for an artist with no authenticator. |
| How do I stop money going straight to a changed account? | Lock further changes for a while · Pause payouts for 5 days after any change, and tell the artist · Leave it as a production idea | A 5-day payout hold, with a "Not you? Contact support" note, on weekly Monday payouts | If an attacker ever gets one change through, for example by phishing a code in real time, no money leaves before the artist notices, and the artist can still change the account back. Patreon uses the same 5-day hold. | A lock would stop the real artist from undoing an attacker's change. Leaving it out would drop the strongest part of the story. |

### 4.6 Sessions and logging out

| Decision | Options I considered | What I chose | Why | Why not the others |
|---|---|---|---|---|
| When the artist logs out of one app, what happens to the other? | End this app's session and Auth0's · Log out of both by chaining both apps' logout pages · Have Auth0 tell each app's server to end the session (back-channel logout) | End this app's session and Auth0's. The other app stays open until its own session ends | The brief doesn't ask for logging out everywhere, and this is the least code and the least likely to break live. With Auth0's session gone, neither app can log anyone back in silently, and payout changes still need step-up. | Chaining is more code, and more to break in a demo. Back-channel logout is an Enterprise feature and needs a public server address. |
| Where does logging out of Payouts land? | Payouts' own signed-out page · Chain through Studio's logout · Studio's signed-out page (my original spec) | Payouts' own signed-out page | Studio keeps its own session, so landing on Studio's page would show "Signed in as…" right after clicking Log out. | Chaining has more moving parts. Studio's page would be confusing on screen. |
| How long can Payouts sit idle? | Keep the defaults (sessions last a day or more) and rely on step-up · A 15-minute idle lock on Payouts only · Shorten Auth0's session and both apps' sessions | 15 minutes without activity, then the password or passkey again. Studio is unchanged | Testing showed both apps still logged in after an hour idle. Money already needs a fresh code, but an unattended laptop still showed earnings and the payout account. Shortening Payouts' session alone wouldn't work, because SSO would log the artist straight back in. So Payouts also checks when the artist last actually logged in, using a time signed by Auth0. | The defaults leave an idle Payouts open for hours. Shortening Auth0's session affects both apps, and an artist busy in Studio would be asked to log in when switching to Payouts. |

### 4.7 Making it visible

| Decision | Options I considered | What I chose | Why | Why not the others |
|---|---|---|---|---|
| How do I prove what the Action decided on each login? | No logging · One line per login with the decision, and no personal data · Log the whole login event | One line per login, with no emails, names or tokens | It gives evidence for testing (for example, spotting an abandoned setup) and speeds up debugging, without personal data in the logs. | No logging gives no evidence. Logging everything puts personal data in the logs. |
| How do I make SSO and step-up visible in the demo? | Nothing on screen, and explain it out loud · A Developer view in each app | A collapsible Developer view in each app, for the demo only | SSO and step-up are invisible by nature. The same "Logged in at" time in both apps proves no second login happened. | Without it, the panel would have to take my word for it. I'd remove it in production. |

### 4.8 Documentation and delivery

| Decision | Options I considered | What I chose | Why | Why not the others |
|---|---|---|---|---|
| How do I deliver the tenant configuration? | An exported config (Auth0 Deploy CLI) · A setup script · Infrastructure as code (Terraform) · Step-by-step written instructions | A written step-by-step guide ([tenant setup](docs/tenant-setup.md)) | I set everything up by hand in the dashboard while learning, and a guide puts the reason next to every setting. Reviewers don't need to install anything to read it. | The CLI and Terraform need an extra app with Management API access, and don't explain why each setting is there. In production, I'd manage the tenant as code. |
| Which copy of the Action is the real one? | The copy in the repo · The deployed copy in Auth0 | The deployed copy | It's what actually runs. When my repo copy fell behind, I copied the deployed version into the repo and re-tested it. | Trusting the repo copy risks documenting code that isn't running. |
| Public or private repository? | Public · Private, with reviewers invited | Public | Reviewers can open it without an invite. No secrets are committed, and my commits use a private noreply email. | Private means inviting every reviewer. |
| How can an artist back out of Auth0's code screen? | Add a Cancel link to Auth0's page · Point to the browser's Back button in the step-up dialog | A note in the dialog about the Back button | Auth0's code screen has no Cancel link, and changing its page template needs a custom domain. | A custom domain is a production item, not something for a `localhost` demo. |
| What format does the account number take? | Any length · Exactly 12 digits | Exactly 12 digits, with a hint under the field | It's a simple, testable rule for the demo. | Real US account numbers vary in length, so production would accept a range. |
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


# 9. Run it locally

Every Auth0 setting, and the full run steps, are in the [tenant setup guide](docs/tenant-setup.md#7-running-the-apps-locally). The short version, once the tenant is set up (Node 18 or newer):

```bash
cd studio && npm install      # then create .env from .env.example
cd ../payouts && npm install  # then create .env from .env.example
```

Then start each app in its own Terminal window, and open http://localhost:3000:

```bash
cd studio && node app.js      # Vermilion Studio on http://localhost:3000
cd payouts && node app.js     # Vermilion Payouts on http://localhost:3001
```

---


