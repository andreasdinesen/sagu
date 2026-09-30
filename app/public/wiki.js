/*
 * Wikiens EGEN lille fil. Ikke app-koden.
 *
 * En besoegende maa hverken hente app.js eller kunne kalde app-API'et, saa den
 * her kender ingen adresser og laver ingen forespoergsler. Alt hvad wikien kan
 * uden JavaScript, GOER den uden JavaScript: navigation, soegning, links og
 * temaet virker med scriptet slaaet fra. Det her er det, der ikke kan:
 * kopier-knapperne paa kode, billederne i stort (med »Copy image«),
 * temaskiftet, den levende soegning, knappen til bunden/toppen og »/« til
 * soegefeltet.
 */
(function () {
  'use strict';

  /* --- kopier-knap paa kodeblokke (Andreas' krav 6) ---------------------- */

  /*
   * Knappen ligger UDEN FOR <pre>.
   *
   * Ligger den indeni, bliver den en del af blokkens tekstindhold, og saa
   * skriver et klik paa »Copy« ordet *Copied* ind i koden (Verdandes dyreste
   * fejl). ÉN funktion siger, hvad blokken indeholder.
   */
  document.querySelectorAll('.wnote pre').forEach(function (pre) {
    var kode = pre.querySelector('code');
    if (!kode) return;

    // PRAECIS appens egen struktur (.kodeblok / .kodeblok-top): en note skal
    // se ens ud i appen og i wikien, og saa er der ogsaa kun ét saet CSS at
    // vedligeholde. Knapraekken ligger OVER blokken, saa den aldrig daekker
    // foerste kodelinje - og uden for <pre>, saa dens egen tekst ikke kan
    // ende i koden (Verdandes dyreste fejl).
    var ramme = document.createElement('div');
    ramme.className = 'kodeblok';
    pre.parentNode.insertBefore(ramme, pre);
    ramme.appendChild(pre);

    var sprog = (kode.className.match(/language-([\w+-]+)/) || [])[1];
    var linje = document.createElement('div');
    linje.className = 'kodeblok-top';
    var maerke = document.createElement('span');
    maerke.className = 'kodeblok-sprog meta';
    maerke.textContent = sprog || 'text';
    linje.appendChild(maerke);

    var knap = document.createElement('button');
    knap.type = 'button';
    knap.className = 'kodeblok-kopi';
    knap.textContent = 'Copy';
    linje.appendChild(knap);
    ramme.insertBefore(linje, pre);

    knap.addEventListener('click', function () {
      var tekst = kode.textContent;
      var sig = function (ord) {
        knap.textContent = ord;
        setTimeout(function () { knap.textContent = 'Copy'; }, 1400);
      };

      function markerTekst() {
        try {
          var omraade = document.createRange();
          omraade.selectNodeContents(kode);
          var valg = window.getSelection();
          valg.removeAllRanges();
          valg.addRange(omraade);
          sig('Press \u2318C');
        } catch (e) { sig('Select and copy'); }
      }

      // clipboard-API'et kraever et secure context, og panelet naas paa
      // IP:port over http. Fallbacken MARKERER teksten i stedet for at melde
      // en fejl - en kopi-knap, der siger "kunne ikke", er en blindgyde.
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(tekst).then(function () { sig('Copied'); }, markerTekst);
      } else markerTekst();
    });
  });

  /* --- SVG-ikonerne, som appen bruger dem ------------------------------- */

  function ikon(sti, stoerrelse) {
    var n = stoerrelse || 16;
    return '<svg width="' + n + '" height="' + n + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + sti + '</svg>';
  }
  var IKON_KOPI = '<path d="M9 9h10v10a1.5 1.5 0 01-1.5 1.5H9z"/><path d="M15 9V4.5A1.5 1.5 0 0013.5 3H5.5A1.5 1.5 0 004 4.5v9A1.5 1.5 0 005.5 15H9"/>';
  var IKON_UD = '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>';
  var IKON_LUK = '<path d="M6 6l12 12M18 6L6 18"/>';
  var IKON_TJEK = '<path d="M20 6.5L9.5 17 4 11.5"/>';

  /** Tekst paa udklipsholderen - med en vej ud over http (se kodeblokkene). */
  function kopierTekst(tekst) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(tekst).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }

  /* --- kopier-knap paa kode INDE i teksten ------------------------------ */

  /*
   * »Kan du goere saa naar man benytter wiki mode at det er muligt at benytte
   * kopi af kodestykker« (Andreas, 2026-09-30). Kodeblokkene havde en knap;
   * en adresse som `http://<server>/cc1/licdump.php#` inde i en saetning
   * havde ingen. Samme knap og samme klasser som i appen (`pyntInlineKode`):
   * den dukker op, naar musen staar over koden, og paa en telefon (ingen
   * hover) er den skjult - dér markerer man med et langt tryk.
   */
  document.querySelectorAll('.wnote code').forEach(function (kode) {
    if (kode.closest('pre')) return;
    if (kode.parentElement && kode.parentElement.classList.contains('inlinekode')) return;
    var ramme = document.createElement('span');
    ramme.className = 'inlinekode';
    kode.parentNode.insertBefore(ramme, kode);
    ramme.appendChild(kode);
    var knap = document.createElement('button');
    knap.type = 'button';
    knap.className = 'inlinekode-kopi';
    knap.tabIndex = -1;
    knap.title = 'Copy';
    knap.setAttribute('aria-label', 'Copy ' + kode.textContent);
    knap.innerHTML = ikon(IKON_KOPI, 12);
    knap.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      kopierTekst(kode.textContent).then(function (ok) {
        if (!ok) {
          // Kan det ikke kopieres herfra, markeres koden - saa er ⌘C/Ctrl+C nok.
          var r = document.createRange();
          r.selectNodeContents(kode);
          var s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        }
        knap.classList.add('kopieret');
        knap.title = ok ? 'Copied' : 'Press Ctrl+C';
        setTimeout(function () { knap.classList.remove('kopieret'); knap.title = 'Copy'; }, 1400);
      });
    });
    ramme.appendChild(knap);
  });

  /* --- billederne: stort, og en kopi, andre programmer kan bruge -------- */

  /*
   * Klik paa et billede aabner det stort - med »Copy image« og »Open«, som i
   * appen (Andreas, 2026-09-30). Kopien er baade `image/png` (til programmer,
   * der kun tager et billede) og HTML med billedet LAGT IND som `data:`, for
   * OneNote og Word tager HTML'en frem for billedet og kan ikke hente en
   * adresse bag wikiens adgangskode (appen v89).
   *
   * `fetch` gaar til wikiens egen adresse (`connect-src 'self'`), og en
   * wiki med adgangskode sender cookien med - samme vej, som billedet blev
   * vist ad.
   */
  function hentBlob(src) {
    return fetch(src, { credentials: 'same-origin' }).then(function (svar) {
      if (!svar.ok) throw new Error('Could not read the image.');
      return svar.blob();
    });
  }

  function tilPng(blob) {
    if (blob.type === 'image/png') return Promise.resolve(blob);
    return createImageBitmap(blob).then(function (bm) {
      var c = document.createElement('canvas');
      c.width = bm.width;
      c.height = bm.height;
      c.getContext('2d').drawImage(bm, 0, 0);
      return new Promise(function (ok, nej) {
        c.toBlob(function (b) { if (b) ok(b); else nej(new Error('png')); }, 'image/png');
      });
    });
  }

  function tilDataUrl(blob) {
    return new Promise(function (ok, nej) {
      var l = new FileReader();
      l.onload = function () { ok(l.result); };
      l.onerror = function () { nej(new Error('read')); };
      l.readAsDataURL(blob);
    });
  }

  function kopierBillede(src, alt) {
    if (!navigator.clipboard || !window.ClipboardItem) return Promise.resolve(false);
    // Loefterne gives til ClipboardItem MED DET SAMME, inde i klikket -
    // Safari naegter en skrivning, der foerst kommer efter et `await`.
    var blob = hentBlob(src);
    var png = blob.then(tilPng);
    var html = blob.then(tilDataUrl).then(function (data) {
      var a = String(alt || '').replace(/"/g, '&quot;');
      return new Blob(['<img src="' + data + '" alt="' + a + '">'], { type: 'text/html' });
    });
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': png, 'text/html': html })])
      .then(function () { return true; }, function () {
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
          .then(function () { return true; }, function (ex) {
            if (window.console) console.warn('billedkopi afvist', ex && ex.message);
            return false;
          });
      });
  }

  function visLysboks(img) {
    var gammel = document.getElementById('lightbox');
    if (gammel) gammel.remove();
    var src = img.currentSrc || img.src;
    var alt = img.getAttribute('alt') || '';
    var boks = document.createElement('div');
    boks.className = 'lightbox';
    boks.id = 'lightbox';
    boks.innerHTML = '<div class="lightbox-vaerktoej">'
      + '<button type="button" class="lightbox-knap" id="lbKopi">' + ikon(IKON_KOPI) + '<span>Copy image</span></button>'
      + '<a class="lightbox-knap" id="lbAaben" target="_blank" rel="noopener">' + ikon(IKON_UD) + '<span>Open</span></a>'
      + '<button type="button" class="lightbox-luk" aria-label="Close">' + ikon(IKON_LUK, 20) + '</button>'
      + '</div><img alt="">'
      + (alt ? '<div class="lightbox-tekst"></div>' : '');
    boks.querySelector('img').src = src;
    boks.querySelector('img').alt = alt;
    boks.querySelector('#lbAaben').href = src;
    if (alt) boks.querySelector('.lightbox-tekst').textContent = alt;
    document.body.appendChild(boks);

    function luk() {
      boks.remove();
      document.removeEventListener('keydown', paaTast);
    }
    function paaTast(e) { if (e.key === 'Escape') { e.preventDefault(); luk(); } }
    document.addEventListener('keydown', paaTast);
    boks.querySelector('.lightbox-luk').addEventListener('click', luk);
    boks.querySelector('#lbAaben').addEventListener('click', function (e) { e.stopPropagation(); });
    boks.addEventListener('click', function (e) { if (e.target === boks) luk(); });

    var kopiKnap = boks.querySelector('#lbKopi');
    var foer = kopiKnap.innerHTML;
    kopiKnap.addEventListener('click', function (e) {
      e.stopPropagation();
      kopiKnap.disabled = true;
      kopierBillede(src, alt).then(function (ok) {
        kopiKnap.disabled = false;
        kopiKnap.innerHTML = ok ? ikon(IKON_TJEK) + '<span>Copied</span>'
          : '<span>Could not copy — use Open</span>';
        setTimeout(function () { if (boks.isConnected) kopiKnap.innerHTML = foer; }, 2500);
      });
    });

    // Swipe lukker - en telefon har ingen Esc-tast.
    var start = null;
    boks.addEventListener('pointerdown', function (e) { start = { x: e.clientX, y: e.clientY }; });
    boks.addEventListener('pointerup', function (e) {
      if (!start) return;
      var d = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      start = null;
      if (d > 80) luk();
    });
  }

  document.querySelectorAll('.wnote img').forEach(function (img) {
    // Et billede, der ER et link, foelger linket.
    if (img.closest('a')) return;
    img.classList.add('wbillede');
    img.addEventListener('click', function () { visLysboks(img); });
  });

  /* --- deep-link paa hver overskrift ------------------------------------ */

  // Ankeret virker uden JS (id'et staar i HTML'en); det her er kun det
  // synlige haandtag, saa man kan kopiere adressen til et bestemt afsnit.
  document.querySelectorAll('.wnote h1[id], .wnote h2[id], .wnote h3[id], .wnote h4[id]')
    .forEach(function (h) {
      var a = document.createElement('a');
      a.className = 'wankermaerke';
      a.href = '#' + h.id;
      a.setAttribute('aria-label', 'Link to this section');
      a.textContent = '#';
      h.appendChild(a);
    });

  /* --- temaskiftet ------------------------------------------------------- */

  // Knappen er `hidden` i HTML'en og taendes her: uden JavaScript ville den
  // staa der og ikke goere noget.
  var tema = document.getElementById('wtheme');
  if (tema) {
    tema.hidden = false;
    tema.addEventListener('click', function () {
      var rod = document.documentElement;
      var nu = rod.getAttribute('data-theme');
      var moerk = nu === 'dark'
        || (!nu && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var valg = moerk ? 'light' : 'dark';
      rod.setAttribute('data-theme', valg);
      // Samme noegle som appen: én maskine, ét temavalg.
      try { localStorage.setItem('sagu_theme', valg); } catch (e) { /* privat tilstand */ }
    });
  }

  /* --- levende soegning -------------------------------------------------- */

  /*
   * Traeffere mens man skriver, som i appen - men uden appens API.
   *
   * Adressen staar i `data-levende` paa formularen og peger paa udgivelsens
   * EGEN soegning. Den besoegende kan derfor ikke naa noget andet end det,
   * der er delt: der er ingen `/api/`-vej ud herfra, og der er intet at
   * oprette - en laeser soeger i sider og maerker, og det er alt.
   *
   * Uden JavaScript virker feltet stadig: formularen POSTer ikke, den GETter
   * til den samme adresse og faar en almindelig resultatside.
   */
  document.querySelectorAll('form[data-levende]').forEach(function (form) {
    var felt = form.querySelector('input[type=search]');
    var liste = form.querySelector('.wtraefliste');
    if (!felt || !liste) return;
    var timer = null;
    var token = 0;
    var valgt = -1;

    function luk() { liste.hidden = true; liste.innerHTML = ''; valgt = -1; }

    function medMark(tekst) {
      return String(tekst || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/&lt;&lt;/g, '<mark>').replace(/&gt;&gt;/g, '</mark>');
    }

    function tegn(svar) {
      var r = svar.results || [];
      if (!r.length) {
        liste.innerHTML = '<p class="wtraefliste-tom">Nothing matched. Press Enter to see the full search.</p>';
        liste.hidden = false;
        return;
      }
      liste.innerHTML = r.map(function (x, i) {
        // Uddraget er ESCAPET af serveren paa naer << >>, som er
        // fremhaevningen. De byttes til <mark> HER - efter escaping - saa der
        // er ingen vej fra en notes tekst til et tag.
        var ud = medMark(x.excerpt);
        /*
         * Forsmagen: flere linjer af noten, vist under den VALGTE raekke, som i
         * appens soegefelt. Begge staar i HTML'en, og CSS'en viser den ene -
         * saa piletasterne ikke skal tegne listen om.
         */
        var forsmag = x.preview ? '<span class="wtraefliste-forsmag">' + medMark(x.preview) + '</span>' : '';
        var titel = String(x.title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var afsnit = x.section ? ' <span class="wtraef-afsnit">§ ' + String(x.section)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>' : '';
        return '<a class="wtraefliste-et' + (i === 0 ? ' paa' : '') + (forsmag ? ' har-forsmag' : '')
          + '" href="' + x.url + '">'
          + '<span class="wtraefliste-titel">' + titel + afsnit + '</span>'
          + '<span class="wtraefliste-uddrag">' + ud + '</span>' + forsmag + '</a>';
      }).join('');
      valgt = 0;
      liste.hidden = false;
    }

    function marker(n) {
      var alle = liste.querySelectorAll('.wtraefliste-et');
      if (!alle.length) return;
      valgt = (n + alle.length) % alle.length;
      for (var i = 0; i < alle.length; i++) alle[i].classList.toggle('paa', i === valgt);
      alle[valgt].scrollIntoView({ block: 'nearest' });
    }

    felt.addEventListener('input', function () {
      var q = felt.value.trim();
      clearTimeout(timer);
      if (q.length < 2) { luk(); return; }
      // 140 ms: kort nok til at foeles levende, langt nok til ikke at sende et
      // kald pr. tastetryk.
      timer = setTimeout(function () {
        var mit = ++token;
        fetch(form.dataset.levende + '?format=json&q=' + encodeURIComponent(q))
          .then(function (r) { return r.ok ? r.json() : { results: [] }; })
          // Et AELDRE svar maa aldrig overskrive et nyere.
          .then(function (d) { if (mit === token) tegn(d); })
          .catch(function () { if (mit === token) luk(); });
      }, 140);
    });

    felt.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { luk(); felt.blur(); return; }
      if (liste.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); marker(valgt + 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); marker(valgt - 1); return; }
      if (e.key === 'Enter') {
        var el = liste.querySelectorAll('.wtraefliste-et')[valgt];
        // Enter paa en markeret raekke aabner den; ellers lader vi formularen
        // goere sit og vise hele resultatsiden.
        if (el) { e.preventDefault(); window.location.href = el.getAttribute('href'); }
      }
    });

    // Et klik uden for lukker. `mousedown`, ikke `click`: ellers naar
    // feltets blur at lukke listen, foer klikket paa en raekke rammer.
    document.addEventListener('mousedown', function (e) {
      if (!form.contains(e.target)) luk();
    });
  });

  /* --- til bunden / til toppen ------------------------------------------- */

  /*
   * Samme knap som i appen (v83): én, der vender efter hvor man staar, og kun
   * naar der er mere end en skaermhoejde at rulle i. Den bygges HER, fordi
   * den kraever JavaScript - uden scriptet ville den staa der og ikke virke.
   *
   * Rulleboksen er dokumentet paa en bred skaerm, men BODY under 900 px
   * (`html, body { overflow-x: hidden }` i style.css). Og dér flytter en
   * bloed rulning sig slet ikke - derfor hoppet bagefter, som i appen.
   */
  (function () {
    var knap = document.createElement('button');
    knap.type = 'button';
    knap.className = 'rulleknap';
    knap.hidden = true;
    knap.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M12 4.5v14.5"/><path d="M6.5 13.5L12 19l5.5-5.5"/></svg>';
    document.body.appendChild(knap);

    function rullet() {
      return Math.max(window.scrollY || 0, document.body.scrollTop || 0,
        document.documentElement.scrollTop || 0);
    }
    function plads() {
      return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
        - window.innerHeight;
    }
    function boks() {
      var d = document.scrollingElement || document.documentElement;
      return d.scrollHeight > d.clientHeight ? d : document.body;
    }
    function retning() {
      var p = plads();
      if (p < window.innerHeight) return null;
      return rullet() < p / 2 ? 'ned' : 'op';
    }
    function opdater() {
      var r = retning();
      knap.hidden = !r;
      if (!r) return;
      var op = r === 'op';
      knap.classList.toggle('op', op);
      knap.title = op ? 'Go to the top' : 'Go to the bottom';
      knap.setAttribute('aria-label', knap.title);
    }
    function rulTil(y) {
      var b = boks();
      if (b === document.body) b.scrollTop = y; else window.scrollTo(0, y);
    }

    knap.addEventListener('click', function () {
      var r = retning();
      if (!r) return;
      var y = r === 'op' ? 0 : plads() + 1;
      var b = boks();
      var fra = rullet();
      var roligt = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      (b === document.body ? b : window).scrollTo({ top: y, behavior: roligt ? 'auto' : 'smooth' });
      setTimeout(function () {
        if (Math.abs(rullet() - fra) < 2) rulTil(y);
        opdater();
      }, 350);
    });

    window.addEventListener('scroll', opdater, { passive: true });
    document.body.addEventListener('scroll', opdater, { passive: true });
    window.addEventListener('resize', opdater, { passive: true });
    // Billeder kan give siden sin hoejde efter scriptet har koert.
    window.addEventListener('load', opdater);
    opdater();
  }());

  /* --- »/« og »Cmd/Ctrl+K« giver soegefeltet fokus -----------------------
   *
   * Samme to taster som i appen, og af samme grund: den, der laeser wikien,
   * er som regel den samme, der skriver den, og en genvej, der kun virker det
   * ene sted, er en genvej man holder op med at bruge.
   *
   * `Cmd/Ctrl+K` bryder med reglen om at lade browserens egne genveje vaere
   * (i Chrome er den adressefeltets soegning). Prisen er den samme som i
   * appen, og den staar skrevet dér ved genvejen selv; her er det nok at
   * sige, at den er BEVIDST og er den eneste af sin slags.
   */

  document.addEventListener('keydown', function (e) {
    var iFelt = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'
      || e.target.isContentEditable);
    var medTast = (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K');
    // `/` kun uden modifikator og kun uden for et skrivefelt - ellers spiser
    // den et skraatstreg, man var ved at taste. `Cmd/Ctrl+K` maa derimod
    // gerne komme MIDT i et felt: det er hele pointen med den.
    var skraa = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !iFelt;
    if (!medTast && !skraa) return;
    var felt = document.getElementById('wq');
    if (!felt) return;
    e.preventDefault();
    felt.focus();
    felt.select();
  });
}());
