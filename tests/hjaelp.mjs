/* Faelles opsaetning: starter DEN RIGTIGE server i en frisk datamappe.
 *
 * Fire ting er lært dyrt andre steder og er indbygget her:
 *
 *  - **BIND_PORT=0.** Et fast portnummer goer testen afhaengig af, at ingen
 *    efterladt dev-server fra en tidligere koersel sidder paa den - og fejlen
 *    bliver "serveren startede ikke" i stedet for EADDRINUSE.
 *  - **Porten laeses ud af serverens EGEN startlinje**, ikke af en variabel.
 *    Det er den eneste maade at bevise, hvilken socket der faktisk blev bundet.
 *  - **Serverens stderr kommer med i timeout-beskeden.** Uden den peger fejlen
 *    paa opstarten i stedet for paa aarsagen.
 *  - **Databasen kan aabnes ved siden af** med node:sqlite for at flytte uret
 *    eller plante data, en test ikke kan provokere gennem API'et. WAL taaler
 *    to processer.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startServer(ekstraEnv = {}) {
  return startServerPaa(mkdtempSync(path.join(tmpdir(), 'sagu-test-')), ekstraEnv);
}

/**
 * Starter serveren paa en BESTEMT datamappe.
 *
 * Bruges til at genstarte oven paa de samme data - fx for at faa `sweep()` til
 * at koere, som den goer ved opstart. `stop()` sletter mappen; `stopUdenAtSlette()`
 * lader den staa, saa en test kan starte endnu en gang.
 */
export async function startServerPaa(dataDir, ekstraEnv = {}) {
  const proc = spawn('node', [path.join(ROD, 'app', 'server.js')], {
    env: { ...process.env, BIND_PORT: '0', DATA_DIR: dataDir, SAGU_DEV: '', APP_NAME: 'Sagu', ...ekstraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ud = '';
  let fejl = '';
  proc.stdout.on('data', (d) => { ud += d; });
  proc.stderr.on('data', (d) => { fejl += d; });

  const port = await new Promise((ok, nej) => {
    const frist = setTimeout(() => nej(new Error(
      `serveren startede ikke inden 10 s.\nstdout:\n${ud}\nstderr:\n${fejl}`)), 10000);
    const kig = setInterval(() => {
      // Samme linje, runens done_regex venter paa.
      const m = ud.match(/sagu lytter paa port (\d+)/);
      if (m) { clearInterval(kig); clearTimeout(frist); ok(Number(m[1])); }
      if (proc.exitCode !== null) {
        clearInterval(kig); clearTimeout(frist);
        nej(new Error(`serveren doede (kode ${proc.exitCode}).\nstderr:\n${fejl}`));
      }
    }, 25);
  });

  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    dataDir,
    port,
    logg: () => ud,
    fejllogg: () => fejl,
    stop() {
      proc.kill('SIGTERM');
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ligegyldigt */ }
    },
    stopUdenAtSlette() {
      proc.kill('SIGTERM');
    },
    /**
     * Stopper og VENTER paa, at processen er ude.
     *
     * Noedvendig, naar en test vil skrive i databasen bagefter: SIGTERM giver
     * serveren tid til at lukke sin egen forbindelse, og goer man det ikke,
     * skriver to processer i den samme fil. Det gaar godt alene og gaar galt
     * under parallel koersel - altsaa den vaerste slags flakkende test.
     */
    async stopOgVent() {
      if (proc.exitCode !== null) return;
      const doed = new Promise((ok) => proc.once('exit', ok));
      proc.kill('SIGTERM');
      await Promise.race([doed, new Promise((ok) => setTimeout(() => { proc.kill('SIGKILL'); ok(); }, 4000))]);
    },
  };
}

/** En klient med sin egen cookie-krukke. To af dem = to brugere. */
export function klient(base) {
  let cookie = '';
  async function kald(metode, sti, krop, opt = {}) {
    const headers = { ...(opt.headers || {}) };
    if (cookie && !opt.udenCookie) headers.Cookie = cookie;
    if (krop !== undefined && !opt.raaKrop) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + sti, {
      method: metode,
      headers,
      body: krop === undefined ? undefined : (opt.raaKrop ? krop : JSON.stringify(krop)),
    });
    const saet = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of saet) {
      const v = c.split(';')[0];
      if (v.startsWith('sagu_session=')) cookie = v;
    }
    let data = null;
    try { data = await res.json(); } catch { /* tomt svar */ }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    kald,
    get cookie() { return cookie; },
    async opret(brugernavn, kodeord) {
      const r = await kald('POST', '/api/register', { username: brugernavn, password: kodeord });
      if (r.status !== 200) throw new Error(`kunne ikke oprette ${brugernavn}: ${JSON.stringify(r.data)}`);
      return r.data.user;
    },
  };
}

/* ------------------------------------------------- en BESOEGENDE */

let gaesteNr = 0;

/**
 * En besoegende: ingen cookie, ingen legitimation, som en kollega med et link.
 *
 * Hver gaest faar sin egen IP. Kodeords-spaerren er pr. IP, og en test, der
 * bruger den op, ville ellers faelde en HELT anden test tre trin senere - med
 * en fejl, der peger det forkerte sted hen (RUNE-ERFARINGER, doda v6). Den bor
 * HER og ikke i én testfil, fordi to kopier med hver sin taeller ville dele
 * spaerren uden at vide det.
 */
export function gaest(base) {
  gaesteNr += 1;
  const ip = `203.0.113.${gaesteNr}`;
  const somGaest = (ekstra) => Object.assign({ 'X-Forwarded-For': ip }, ekstra || {});
  return {
    async hent(sti, opt) {
      const o = Object.assign({ redirect: 'manual' }, opt || {});
      o.headers = somGaest(o.headers);
      const r = await fetch(base + sti, o);
      const tekst = r.headers.get('content-type') && !/^image|octet/.test(r.headers.get('content-type'))
        ? await r.text() : '';
      return { status: r.status, tekst, headers: r.headers, r };
    },
    async post(sti, felter, cookie) {
      const krop = Object.entries(felter)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      const r = await fetch(base + sti, {
        method: 'POST',
        redirect: 'manual',
        headers: somGaest(Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' },
          cookie ? { Cookie: cookie } : {})),
        body: krop,
      });
      return { status: r.status, tekst: await r.text(), headers: r.headers };
    },
  };
}

/* ------------------------------------------------------- XSS-maaling */

export /**
 * Plukker de RIGTIGE tags ud af outputtet.
 *
 * Det virker, fordi `esc()` goer enhver `<` fra brugeren til `&lt;`. Et `<` i
 * resultatet kan derfor KUN komme fra vores egne skabeloner - saa alt, denne
 * finder, er noget, vi selv har udstedt.
 *
 * Det er hele forskellen paa den her og et regex efter »on…=«: et
 * `&lt;img onerror=…&gt;` er inert TEKST, og en test, der ikke kan se
 * forskel paa en attribut og tekst der ligner en, raaber op om intet.
 */
function tags(html) {
  const ud = [];
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\/?>/g)) {
    const attributter = [];
    for (const a of m[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
      attributter.push({ navn: a[1].toLowerCase(), vaerdi: a[2] });
    }
    // Attributter uden vaerdi (`<details open>`) taeller ogsaa.
    for (const a of m[2].matchAll(/(?:^|\s)([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?=\s|$)/g)) {
      if (!attributter.some((x) => x.navn === a[1].toLowerCase())) {
        attributter.push({ navn: a[1].toLowerCase(), vaerdi: '' });
      }
    }
    ud.push({ navn: m[1].toLowerCase(), attributter, raa: m[0] });
  }
  return ud;
}
