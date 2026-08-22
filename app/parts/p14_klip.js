/*
 * F18 - »Save to Sagu«: bogmærket, der gemmer en side som en note.
 *
 * ── Hvad Andreas bad om ───────────────────────────────────────────────────
 *
 * »Kan du lave et javascript som jeg kan gemme direkte i sagu på samme måde
 * som ServiceNowMarkdown. Det skal lægges som et punkt under indstillinger så
 * det er let at finde. man skal også kunne vælge projekt og evt tag«
 * (2026-08-21). »Projekt« er en **notesbog** i Sagu.
 *
 * ── Bogmærket er skrevet som en RIGTIG funktion ───────────────────────────
 *
 * `klipFunktion` herunder er almindelig, læsbar kode, og bogmærket bygges af
 * dens egen `toString()`. Alternativet - en streng med kode i - kan ikke
 * læses, ikke `node --check`'es og ikke rettes uden at tælle
 * anførselstegn. Build'et minificerer ikke, så det, man læser her, er præcis
 * det, der havner i bogmærket.
 *
 * ── Nøglen er `capture`, og det er ikke en detalje ────────────────────────
 *
 * Et bogmærke ligger i klartekst i browserens bogmærkeliste og bliver
 * synkroniseret rundt. Nøglen i det skal derfor være den svageste, der kan
 * gøre arbejdet: `capture` kan lægge noget NYT ind og læse **ingenting**.
 * Mister man maskinen, kan bogmærket ikke bruges til at hente arkivet ud.
 * Derfor laver ruden altid en `capture`-nøgle - man kan ikke vælge en bredere.
 *
 * ── Og hvorfor det er ét kald til `/api/v1/capture` ───────────────────────
 *
 * Ingen ny rute, intet nyt format. Bogmærket er bare endnu en klient til det
 * API, iPhone-genvejene allerede bruger (F9) - så er der ét sted, der tager
 * imod tekst, og én scope-tabel, der afgør hvad den må.
 */

/**
 * Selve bogmærket. Kører på en FREMMED side og må ikke antage noget om den.
 *
 * Alt, den har brug for, kommer i `k`: adressen, nøglen, notesbogen og
 * mærket. Ingen globale variabler fra Sagu findes derovre.
 */
function klipFunktion(k) {
  var d = document;

  /* Markeringen, hvis der er en - ellers sidens hovedindhold. Det man har
     streget under, er det man mente. */
  var valg = window.getSelection();
  var rod = null;
  if (valg && !valg.isCollapsed && String(valg).trim().length > 2) {
    rod = d.createElement('div');
    for (var i = 0; i < valg.rangeCount; i++) rod.appendChild(valg.getRangeAt(i).cloneContents());
  } else {
    rod = d.querySelector('article') || d.querySelector('main') || d.body;
  }

  var UD = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, IFRAME: 1, SVG: 1, NAV: 1, FOOTER: 1, FORM: 1 };
  var linjer = [];

  function tekst(n) {
    var s = '';
    for (var i = 0; i < n.childNodes.length; i++) {
      var b = n.childNodes[i];
      if (b.nodeType === 3) s += b.nodeValue;
      else if (b.nodeType === 1 && !UD[b.tagName]) {
        var t = b.tagName;
        if (t === 'BR') s += ' ';
        else if (t === 'CODE') s += '`' + tekst(b) + '`';
        else if (t === 'STRONG' || t === 'B') s += '**' + tekst(b) + '**';
        else if (t === 'EM' || t === 'I') s += '*' + tekst(b) + '*';
        else if (t === 'A' && b.getAttribute('href')) {
          var h = b.href || b.getAttribute('href');
          var inde = tekst(b).trim();
          s += inde ? '[' + inde + '](' + h + ')' : h;
        } else s += tekst(b);
      }
    }
    return s.replace(/[ \t ]+/g, ' ');
  }

  function skriv(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s) linjer.push(s);
  }

  function gaa(n, dybde) {
    if (dybde > 40) return;
    for (var i = 0; i < n.childNodes.length; i++) {
      var b = n.childNodes[i];
      if (b.nodeType === 3) { skriv(b.nodeValue); continue; }
      if (b.nodeType !== 1 || UD[b.tagName]) continue;
      var t = b.tagName;
      if (/^H[1-6]$/.test(t)) skriv(new Array(Number(t[1]) + 1).join('#') + ' ' + tekst(b));
      else if (t === 'P') skriv(tekst(b));
      /* En LISTE er ÉN blok. Skrev man hvert punkt for sig med en tom linje
         imellem, blev en nummereret liste til fem lister, der hver begyndte
         paa 1 - maalt paa en rigtig side. */
      else if (t === 'UL' || t === 'OL') linjer.push(liste(b, t === 'OL', ''));
      else if (t === 'BLOCKQUOTE') skriv('> ' + tekst(b));
      else if (t === 'PRE') linjer.push('```\n' + (b.textContent || '').trim() + '\n```');
      else if (t === 'HR') linjer.push('---');
      /* Og en TABEL er ÉN blok med en skillelinje under foerste raekke -
         ellers er det slet ikke en tabel, men en raekke loese streger. */
      else if (t === 'TABLE') { var tb = tabel(b); if (tb) linjer.push(tb); }
      else gaa(b, dybde + 1);
    }
  }

  function liste(n, nummereret, indryk) {
    var ud = [];
    var nr = 1;
    for (var i = 0; i < n.children.length; i++) {
      var li = n.children[i];
      if (li.tagName !== 'LI') continue;
      /* Underlister tages for sig og rykkes ind - saa overlever et
         hierarki turen, i stedet for at blive fladet ud. */
      var under = [];
      for (var j = 0; j < li.children.length; j++) {
        var u = li.children[j];
        if (u.tagName === 'UL' || u.tagName === 'OL') { under.push(u); u.remove(); }
      }
      var linje = indryk + (nummereret ? (nr++) + '. ' : '- ') + tekst(li).trim();
      if (linje.trim() !== indryk.trim() + (nummereret ? '.' : '-')) ud.push(linje);
      for (var m = 0; m < under.length; m++) {
        ud.push(liste(under[m], under[m].tagName === 'OL', indryk + '  '));
      }
    }
    return ud.join('\n');
  }

  function tabel(n) {
    var raekker = n.querySelectorAll('tr');
    if (!raekker.length) return '';
    var ud = [];
    for (var i = 0; i < raekker.length; i++) {
      var celler = [];
      var c = raekker[i].children;
      for (var j = 0; j < c.length; j++) celler.push(tekst(c[j]).replace(/\|/g, '\\|').trim());
      if (!celler.length) continue;
      ud.push('| ' + celler.join(' | ') + ' |');
      if (ud.length === 1) ud.push('|' + new Array(celler.length + 1).join(' --- |'));
    }
    return ud.length > 1 ? ud.join('\n') : '';
  }

  gaa(rod, 0);

  var titel = (d.title || location.hostname).replace(/\s+/g, ' ').trim().slice(0, 180);
  /* Mærket skal stå i FØRSTE linje - det er dér, capture læser det (F9). */
  var foerste = titel + (k.tag ? ' #' + k.tag : '');
  var krop = linjer.join('\n\n').slice(0, 100000);
  var tekstUd = foerste + '\n\n[' + titel + '](' + location.href + ')\n\n' + krop;

  var adr = k.base + '/api/v1/capture';
  if (k.notesbog) adr += '?notebook=' + encodeURIComponent(k.notesbog);

  fetch(adr, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8', Authorization: 'Bearer ' + k.noegle },
    body: tekstUd,
  }).then(function (r) {
    return r.json().catch(function () { return {}; });
  }).then(function (svar) {
    if (svar && svar.note) sig('Saved to Sagu');
    else sig((svar && svar.message) || 'Sagu said no — check the key');
  }).catch(function () {
    sig('Could not reach Sagu');
  });

  /* Et svar man kan SE. En knap, der gør noget usynligt, prøver man igen. */
  function sig(besked) {
    var e = d.createElement('div');
    e.textContent = besked;
    e.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;padding:10px 14px;'
      + 'border-radius:8px;background:#1c1a17;color:#e8e2d8;font:14px/1.3 system-ui,sans-serif;'
      + 'box-shadow:0 8px 24px rgba(0,0,0,.4)';
    d.body.appendChild(e);
    setTimeout(function () { e.remove(); }, 2600);
  }
}

/**
 * Bogmærkets adresse, bygget af funktionen selv.
 *
 * `encodeURIComponent` om det hele: en bogmærke-URL må ikke indeholde `"`
 * eller mellemrum i visse browsere, og koden her er fuld af begge dele.
 */
function byggKlip(konfig) {
  const kode = `(${klipFunktion.toString()})(${JSON.stringify(konfig)})`;
  return `javascript:${encodeURIComponent(kode)}`;
}
