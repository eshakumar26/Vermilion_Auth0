/* VERMILION LOGIN RULES · Auth0 Post-Login Action
   Job A · Tell the apps HOW the artist logged in (password or passkey).
   Job B · MFA decisions, IN THIS ORDER:
     1. Step-up asked + no MFA factor → DENY (never offer setup)
     2. Step-up asked → require a fresh code
     3. No MFA factor + password/passkey typed in THIS login → set up
        the authenticator app (repeats until done; never on SSO visits)
   Nov 14 change: Check 3 was "first login only". Test showed an artist
   who closes the tab at the QR screen was never offered setup again. */

const STEP_UP_ACR = 'http://schemas.openid.net/pape/policies/2007/06/multi-factor';
const CLAIM_NAMESPACE = 'https://vermilion.demo/';

// Real login: Action runs seconds after the password/passkey.
// SSO visit: the timestamp is from the ORIGINAL login, so it fails this.
const FRESH_LOGIN_SECONDS = 60;

// Unreadable timestamp → "no" (safe: never offer setup if unsure).
function typedCredentialJustNow(event) {
  const now = Date.now();
  return (event.authentication?.methods || []).some((m) => {
    if (m.name !== 'pwd' && m.name !== 'passkey') return false;
    const completedAt = Date.parse(m.timestamp);
    if (Number.isNaN(completedAt)) return false;
    return now - completedAt <= FRESH_LOGIN_SECONDS * 1000;
  });
}

exports.onExecutePostLogin = async (event, api) => {

  // Job A · How did the artist log in? (shown in the Developer view)
  const methodNames = (event.authentication?.methods || []).map((m) => m.name);
  let loginMethod = 'unknown';
  if (methodNames.includes('passkey')) loginMethod = 'passkey';
  else if (methodNames.includes('pwd')) loginMethod = 'password';
  else if (methodNames.includes('federated')) loginMethod = 'social login';
  api.idToken.setCustomClaim(CLAIM_NAMESPACE + 'login_method', loginMethod);

  // Job B · ignore 'email' (excluded by the brief) and 'recovery-code' (backup only)
  const factors = event.user.enrolledFactors || [];
  const hasMfaFactor = factors.some((f) => f.type !== 'email' && f.type !== 'recovery-code');
  const stepUpAsked = (event.transaction?.acr_values || []).includes(STEP_UP_ACR);
  const freshLogin = typedCredentialJustNow(event);

  // One line per login in Monitoring → Logs → Action Details. No emails or names.
  const note = (decision) => console.log(JSON.stringify({
    decision, methods: methodNames, freshLogin, hasMfaFactor, stepUpAsked,
    logins_count: event.stats?.logins_count,
  }));

  // Check 1 · Step-up + no factor → DENY (before Check 3: blocks enrollment hijack)
  if (stepUpAsked && !hasMfaFactor) {
    note('deny_step_up_no_factor');
    api.access.deny('no_mfa_factor');
    return;
  }

  // Check 2 · Step-up → fresh code, no "remember this browser".
  // VERIFY: if Auth0 skips the code when MFA was done earlier in this
  // session, use: api.authentication.challengeWith({ type: 'otp' });
  if (stepUpAsked) {
    note('step_up_challenge');
    api.multifactor.enable('any', { allowRememberBrowser: false });
    return;
  }

  // Check 3 · No factor + fresh password/passkey → authenticator setup.
  if (!hasMfaFactor && freshLogin) {
    note('enroll_authenticator');
    api.authentication.enrollWith({ type: 'otp' });
    return;
  }

  note('none'); // any other login: one factor is enough
};