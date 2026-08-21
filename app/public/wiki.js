/*
 * Wikiens EGEN lille fil. Ikke app-koden.
 *
 * En besoegende maa hverken hente app.js eller kunne kalde app-API'et, saa den
 * her kender ingen adresser og laver ingen forespoergsler. Alt hvad wikien kan
 * uden JavaScript, GOER den uden JavaScript: navigation, soegning, links og
 * temaet virker med scriptet slaaet fra. Det her er de tre ting, der ikke kan:
 * kopier-knappen paa en kodeblok, temaskiftet og »/« til soegefeltet.
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
        var ud = String(x.excerpt || '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/&lt;&lt;/g, '<mark>').replace(/&gt;&gt;/g, '</mark>');
        var titel = String(x.title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var afsnit = x.section ? ' <span class="wtraef-afsnit">§ ' + String(x.section)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>' : '';
        return '<a class="wtraefliste-et' + (i === 0 ? ' paa' : '') + '" href="' + x.url + '">'
          + '<span class="wtraefliste-titel">' + titel + afsnit + '</span>'
          + '<span class="wtraefliste-uddrag">' + ud + '</span></a>';
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
