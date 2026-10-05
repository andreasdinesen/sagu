/*
 * Sagu -> qlk (v98). Broen til kortlink-appen.
 *
 * ── Hvad den goer ─────────────────────────────────────────────────────────
 *
 * qlk laver korte links og QR-koder. Sagu beder qlk om ét kortlink pr. note
 * eller notesbog (»ref«), og kortlinket peger paa den OFFENTLIGE adresse, saa
 * laenge siden er udgivet - ellers paa den INTERNE (`#note-<id>`). Stoppes en
 * udgivelse, peger det samme kortlink paa den interne adresse igen, og
 * udgives den igen, paa den offentlige: en trykt QR-kode virker altid
 * (kontrakten qlk-sagu, beslutning 3).
 *
 * ── Samme form som doda.js ───────────────────────────────────────────────
 *
 * Adresse + noegle pr. BRUGER, noeglen forlader aldrig serveren, og et kald
 * svarer aldrig med en undtagelse, men med `{ok, kode, besked}`. Modulet
 * kender hverken database eller http-lag; det faar det, det skal bruge,
 * gennem `srv` - saa fejlstierne kan proeves uden en server.
 *
 * ── Ingen `[fejl]` i loggen ───────────────────────────────────────────────
 *
 * En qlk, der ikke svarer, er ikke en fejl i Sagu. Panelets watcher taeller
 * `[fejl]`-linjer og ringer til Andreas (docs/regler/faldgruber.md), saa
 * modulet logger gennem `srv.logAdvarsel`, der skriver `[qlk] advarsel: …`.
 */

'use strict';

/** En qlk, der ikke svarer, maa ikke kunne haenge Sagu. */
const TIMEOUT_MS = 10_000;

/*
 * Rensningen af en fanget adresse sker MENS brugeren venter paa sit bogmaerke.
 * Den er en tilgift: svarer qlk ikke hurtigt, gemmes adressen uaendret.
 */
const RENS_TIMEOUT_MS = 2_500;

/* Et svar stoerre end det her er ikke et svar fra qlk, men en fejl. */
const MAX_SVAR = 2 * 1024 * 1024;

/* En QR-kode er et par KB. Loftet holder proxyen fra at blive en vej til at
   hente noget stort gennem Sagu. */
const MAX_SVG = 512 * 1024;

/* Samme form som qlk's egen (`app/shared/parse.js`, KODE_RE). */
const KODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Laeser et svar med et loft.
 *
 * `res.json()` ville laese hvad som helst ind i hukommelsen; en forkert
 * adresse, der peger paa en stor fil, maa ikke kunne det.
 */
async function laesMedLoft(svar, loft) {
  if (!svar.body) return Buffer.alloc(0);
  const dele = [];
  let n = 0;
  for await (const bid of svar.body) {
    n += bid.length;
    if (n > loft) {
      throw Object.assign(new Error('svaret er for stort'), { forStort: true });
    }
    dele.push(Buffer.from(bid));
  }
  return Buffer.concat(dele);
}

function opret(srv) {
  /**
   * Opsaetningen for ÉN bruger. Noeglen forlader ALDRIG serveren - frontenden
   * faar `connected` og kortlinkenes vaert.
   */
  function opsaetning(userId) {
    const url = String(srv.hentIndstilling(userId, 'qlk_url') || '').replace(/\/+$/, '');
    const key = String(srv.hentIndstilling(userId, 'qlk_key') || '');
    const short = String(srv.hentIndstilling(userId, 'qlk_short') || '').replace(/\/+$/, '');
    return { url, key, short, connected: !!(url && key) };
  }

  /**
   * Ét kald til qlk. Svarer ALDRIG med en undtagelse.
   *
   * qlk's fejl er i18n-noegler (`{ error: 'err.404' }`) uden en saetning, saa
   * saetningen skrives her - til den, der skal handle paa den.
   */
  async function kald(userId, metode, sti, krop, opt) {
    const o = opt || {};
    const { url, key } = opsaetning(userId);
    if (!url || !key) {
      return { ok: false, kode: 'not_connected', besked: 'qlk is not connected yet.' };
    }
    let svar;
    let raa;
    try {
      svar = await fetch(`${url}${sti}`, {
        method: metode,
        headers: Object.assign(
          { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          krop === undefined ? {} : { 'Content-Type': 'application/json' },
        ),
        body: krop === undefined ? undefined : JSON.stringify(krop),
        signal: AbortSignal.timeout(o.timeout || TIMEOUT_MS),
      });
      raa = await laesMedLoft(svar, MAX_SVAR);
    } catch (ex) {
      srv.logAdvarsel(`${metode} ${sti}: ${ex && ex.message}`);
      return {
        ok: false,
        kode: 'unreachable',
        besked: 'qlk did not answer. Check the address, and that it is running.',
      };
    }
    let data = null;
    try { data = raa.length ? JSON.parse(raa.toString('utf8')) : null; } catch { /* ikke JSON */ }
    const fejlNoegle = data && typeof data.error === 'string' ? data.error : '';
    if (svar.status === 403 && fejlNoegle === 'err.key_scope') {
      // IKKE det samme som en forkert noegle - den er bare for smal.
      return {
        ok: false,
        kode: 'wrong_scope',
        status: 403,
        besked: 'The qlk key is too narrow. Create a "link" key in qlk and paste it again.',
      };
    }
    if (svar.status === 401 || svar.status === 403) {
      return {
        ok: false,
        kode: 'bad_key',
        status: svar.status,
        besked: 'qlk refused the key. Create a new one in qlk and paste it again.',
      };
    }
    if (svar.status === 404) {
      return { ok: false, kode: 'not_found', status: 404, besked: 'qlk does not know that link.' };
    }
    if (svar.status === 409 && fejlNoegle === 'err.code_taken') {
      return { ok: false, kode: 'code_taken', status: 409, besked: 'That short code is already taken in qlk. Pick another one.' };
    }
    if (!svar.ok) {
      return {
        ok: false,
        kode: 'qlk_error',
        status: svar.status,
        besked: `qlk answered ${svar.status}${fejlNoegle ? ` (${fejlNoegle})` : ''}.`,
      };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, kode: 'qlk_error', besked: 'qlk did not answer with JSON. Is that the right address?' };
    }
    return { ok: true, data };
  }

  /**
   * Proev forbindelsen: `GET /api/v1/me` kraever `read` og aendrer intet.
   * Svaret baerer `shortBase` - vaerten, kortlinkene skrives med - og den
   * gemmes, saa noten kan finde sine kortlinks uden at spoerge qlk.
   */
  async function proev(userId) {
    const r = await kald(userId, 'GET', '/api/v1/me');
    if (!r.ok) {
      if (r.kode === 'not_found') {
        return { ok: false, kode: 'qlk_error', besked: 'That address answers, but it is not qlk (no /api/v1/me).' };
      }
      return r;
    }
    const me = r.data.me || {};
    const shortBase = String(r.data.shortBase || '').replace(/\/+$/, '');
    const appBase = String(r.data.appBase || '').replace(/\/+$/, '');
    return {
      ok: true,
      navn: String(me.username || ''),
      shortBase,
      appBase,
      besked: `Connected to qlk${me.username ? ` as ${me.username}` : ''}.`,
    };
  }

  /**
   * Sikrer kortlinket for én ref - upsert i qlk.
   *
   * `create: false` er synkens form: findes linket ikke laengere, svarer qlk
   * 404, og saa skal Sagu rydde sin raekke - ikke lave et nyt link, ingen bad om.
   */
  async function sikrLink(userId, o) {
    const krop = {
      kind: o.kind,
      id: o.id,
      base: o.base,
      url: o.url,
      create: !!o.create,
    };
    if (o.title) krop.title = String(o.title).slice(0, 300);
    if (o.code) krop.code = o.code;
    const r = await kald(userId, 'POST', '/api/v1/links/sagu', krop);
    if (!r.ok) return r;
    const link = r.data.link;
    if (!link || !link.code) return { ok: false, kode: 'qlk_error', besked: 'qlk did not return a link.' };
    return { ok: true, link, created: !!r.data.created, updated: !!r.data.updated };
  }

  /** Brugerens egne links for en liste af refs (`note:<id>,notebook:<id>`). */
  async function hentLinks(userId, refs) {
    const liste = (refs || []).slice(0, 200).map((x) => `${x.kind}:${x.id}`).join(',');
    if (!liste) return { ok: true, links: [] };
    const r = await kald(userId, 'GET', `/api/v1/links/sagu?refs=${encodeURIComponent(liste)}`);
    if (!r.ok) return r;
    return { ok: true, links: Array.isArray(r.data.links) ? r.data.links : [] };
  }

  /** Klik og scanninger for op til 100 koder - ÉT kald. */
  async function stats(userId, koder) {
    const liste = [...new Set((koder || []).filter((k) => KODE_RE.test(k)))].slice(0, 100);
    if (!liste.length) return { ok: true, links: [] };
    const r = await kald(userId, 'GET', `/api/v1/links/stats?codes=${liste.map(encodeURIComponent).join(',')}`);
    if (!r.ok) return r;
    return { ok: true, links: Array.isArray(r.data.links) ? r.data.links : [] };
  }

  /**
   * QR-koden som SVG fra qlk's OFFENTLIGE `/q/<kode>.svg`.
   *
   * Uden noegle - billedet er offentligt, ligesom kortlinket selv - og med et
   * loft. Kaldstedet har allerede afgjort, at koden er brugerens egen.
   */
  async function qrSvg(userId, kode) {
    const { url } = opsaetning(userId);
    if (!url) return { ok: false, kode: 'not_connected', besked: 'qlk is not connected yet.' };
    if (!KODE_RE.test(String(kode || ''))) return { ok: false, kode: 'not_found', besked: 'No such code.' };
    try {
      const svar = await fetch(`${url}/q/${encodeURIComponent(kode)}.svg`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (svar.status === 404) return { ok: false, kode: 'not_found', besked: 'qlk does not know that code.' };
      if (!svar.ok) return { ok: false, kode: 'qlk_error', besked: `qlk answered ${svar.status}.` };
      const type = String(svar.headers.get('content-type') || '');
      if (!type.startsWith('image/svg+xml')) {
        return { ok: false, kode: 'qlk_error', besked: 'qlk did not answer with an SVG image.' };
      }
      const svg = (await laesMedLoft(svar, MAX_SVG)).toString('utf8');
      return { ok: true, svg };
    } catch (ex) {
      srv.logAdvarsel(`QR ${kode}: ${ex && ex.message}`);
      return { ok: false, kode: 'unreachable', besked: 'qlk did not answer.' };
    }
  }

  /**
   * Renser en adresse for sporing (`utm_…`, `fbclid` …) med qlk's regler.
   *
   * Kort timeout. Fejler noget, er svaret `ok: false`, og kaldstedet gemmer
   * adressen UAENDRET - en fangst maa aldrig fejle, fordi qlk er nede.
   */
  async function rens(userId, adresse) {
    const r = await kald(userId, 'POST', '/api/v1/clean/check', { url: adresse }, { timeout: RENS_TIMEOUT_MS });
    if (!r.ok) return r;
    const ren = typeof r.data.url === 'string' ? r.data.url : '';
    if (!ren || !/^https?:\/\//i.test(ren)) return { ok: false, kode: 'qlk_error', besked: 'qlk returned no address.' };
    return { ok: true, url: ren, removed: r.data.removed || [] };
  }

  return { opsaetning, kald, proev, sikrLink, hentLinks, stats, qrSvg, rens };
}

module.exports = { opret, TIMEOUT_MS, RENS_TIMEOUT_MS, KODE_RE };
