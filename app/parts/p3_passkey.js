'use strict';
/* Sagu - passkeys i browseren.
 *
 * Selve verifikationen ligger i app/webauthn.js paa serveren; her er kun
 * base64url-oversaettelsen og de to kald til navigator.credentials.
 *
 * Passkeys er et TILLAEG, aldrig en erstatning: panelet tilgaas paa IP:port
 * over ren http, hvor WebAuthn slet ikke findes. Et passkey-only login ville
 * laase Andreas ude af sin egen server (RUNE-ERFARINGER, Tilmeld). */

const kanPasskeys = () => !!(window.PublicKeyCredential && window.isSecureContext);

const fraB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')
  .padEnd(Math.ceil(String(s).length / 4) * 4, '=')), (c) => c.charCodeAt(0));

const tilB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Opretter en passkey paa denne enhed. */
async function tilfoejPasskey() {
  if (!kanPasskeys()) throw new Error('This browser cannot use passkeys, or the page is not on https.');
  const o = await api('POST', '/api/passkey/register-options', {});
  const pk = o.publicKey;
  pk.challenge = fraB64u(pk.challenge);
  pk.user.id = fraB64u(pk.user.id);
  pk.excludeCredentials = (pk.excludeCredentials || [])
    .map((c) => ({ type: 'public-key', id: fraB64u(c.id) }));
  const cred = await navigator.credentials.create({ publicKey: pk });
  return api('POST', '/api/passkey/register', {
    challengeId: o.challengeId,
    name: String(navigator.platform || 'This device').slice(0, 60),
    attestationObject: tilB64u(cred.response.attestationObject),
    clientDataJSON: tilB64u(cred.response.clientDataJSON),
  });
}

/** Logger ind UDEN brugernavn - noeglen ved selv, hvem den hoerer til, og
    login-siden roeber dermed ikke, hvilke konti der findes. */
async function loginMedPasskey() {
  if (!kanPasskeys()) throw new Error('This browser cannot use passkeys, or the page is not on https.');
  const o = await api('POST', '/api/passkey/login-options', {});
  const pk = o.publicKey;
  pk.challenge = fraB64u(pk.challenge);
  pk.allowCredentials = [];
  const cred = await navigator.credentials.get({ publicKey: pk });
  return api('POST', '/api/passkey/login', {
    challengeId: o.challengeId,
    id: tilB64u(cred.rawId),
    authenticatorData: tilB64u(cred.response.authenticatorData),
    clientDataJSON: tilB64u(cred.response.clientDataJSON),
    signature: tilB64u(cred.response.signature),
  });
}
