/*
 * Sagu - den OFFENTLIGE wiki (F6).
 *
 * Erstatningen for den offentlige Notion-side. Kollegaerne har ingen konti, saa en
 * udgivelse er offentlig som udgangspunkt, og kodeordet er en kontakt, der kan
 * slaas til bagefter - UDEN at linket skifter.
 *
 * ── Hvorfor det er sin egen skabelon og ikke SPA'en ───────────────────────
 *
 * En besoegende maa hverken hente app-koden eller kunne kalde app-API'et. Med
 * en server-renderet side er der ikke noget at spaerre for: der findes ingen
 * app.js paa siden, ingen fetch mod /api/, og ingen session. Det er baade
 * hurtigere (én rundtur, ingen JS at koere) og enklere at bevise.
 *
 * Den lille `/wiki.js` er wikiens EGEN - 40 linjer til kopier-knapper og
 * temaskiftet. Den kan intet kalde og kender ingen adresser.
 *
 * ── De fire regler, hele modulet staar paa ────────────────────────────────
 *
 *  1. **Ukendt eller tilbagekaldt = 404.** Aldrig 401 eller 403: de ville
 *     bekraefte, at adressen findes, og saa kan man aftaste sig frem.
 *  2. **Ingen rute scanner datasaettet.** Alt slaas op paa et indeks
 *     (`shares.slug`, `shares.token`, `notes.parent_id`).
 *  3. **Udgivelsens noter beregnes ÉT sted** (`udgivelsensNoter`), og hver
 *     eneste rute - side, soegning, fil, feed - spoerger den samme funktion.
 *     To lister ville betyde, at den ene glemmer en spaerring.
 *  4. **Kodeordet daekker ALT.** Uden det er der intet indhold nogen steder:
 *     ikke en titel i navigationen, ikke et uddrag i en soegning, ikke et
 *     billede. Kun forsiden svarer - med formularen.
 */

'use strict';

/*
 * Ord, en sides adresse ALDRIG maa blive.
 *
 * Sidernes adresser er pæne slugs (`/w/handbook/vpn-adgang`), og saa kan en
 * side, der tilfaeldigvis hedder »Search«, ellers stjaele soegningens adresse.
 * Kollisionen loeses samme sted som dubletter: der haenges et tal paa.
 */
const RESERVEREDE = new Set(['search', 'f', 'changes', 'feed', 'password', 'robots.txt', 'comment']);

/** Hvornaar en side faar maerket »ikke roert i …«. En arbejdswiki doer af forældet indhold. */
const GAMMEL_EFTER = 300 * 86400;

function opret(srv) {
  const md = srv.markdown;
  const esc = md.esc;
  const attr = md.attr;

  /* ------------------------------------------------------------ adresser */

  /**
   * Udgivelsens rodadresse. Slug'en naar den findes, ellers tokenet.
   *
   * Begge virker altid: tokenet er den uforudsigelige adresse, slug'en den
   * paene. At slaa kodeord til roerer ingen af dem (CLAUDE.md).
   */
  function rodSti(share) {
    return share.slug ? `/w/${encodeURIComponent(share.slug)}` : `/s/${share.token}`;
  }

  /**
   * id -> adresse-slug for hele udgivelsen.
   *
   * Deterministisk: samme traa giver samme adresser hver gang, saa et bogmaerke
   * ikke doer, fordi nogen tilfoejede en side. Dubletter og reserverede ord
   * faar et tal haengt paa - samme greb som rendererens overskrifts-id'er.
   */
  function slugKort(noter) {
    const kort = new Map();
    const brugte = new Set();
    for (const n of noter) {
      let s = md.slug(n.title || 'untitled');
      if (RESERVEREDE.has(s)) s = `${s}-page`;
      let base = s;
      let i = 2;
      while (brugte.has(s)) { s = `${base}-${i}`; i++; }
      brugte.add(s);
      kort.set(n.id, s);
    }
    return kort;
  }

  /**
   * Noterne i laeserækkefoelge: dybde-foerst, soeskende efter seq og titel.
   *
   * Det er baade navigationstraeets orden og »forrige/naeste«-baandets, saa
   * de to kan ikke komme ud af trit.
   */
  function iLaeseraekkefoelge(noter, rodId) {
    const findes = new Set(noter.map((n) => n.id));
    const boern = new Map();
    for (const n of noter) {
      // `rodId === null` er en hel NOTESBOG: der er ingen rod-note, saa alt
      // uden en foraelder INDE i udgivelsen ligger i toppen.
      const f = n.id === rodId ? null
        : ((n.parentId && findes.has(n.parentId)) ? n.parentId : rodId);
      if (!boern.has(f)) boern.set(f, []);
      boern.get(f).push(n);
    }
    for (const liste of boern.values()) {
      liste.sort((a, b) => (a.seq - b.seq) || String(a.title).localeCompare(String(b.title), 'da'));
    }
    const ud = [];
    const gaa = (id, dybde) => {
      const n = noter.find((x) => x.id === id);
      if (!n) return;
      ud.push(Object.assign({ dybde }, n));
      for (const b of boern.get(id) || []) {
        if (b.id !== id) gaa(b.id, dybde + 1);
      }
    };
    if (rodId) gaa(rodId, 0);
    else for (const b of boern.get(null) || []) gaa(b.id, 0);
    // Et net under: en note, hvis foraelder ligger uden for udgivelsen, ville
    // ellers forsvinde fra navigationen uden at fejle.
    for (const n of noter) if (!ud.some((x) => x.id === n.id)) ud.push(Object.assign({ dybde: 1 }, n));
    return ud;
  }

  /* -------------------------------------------------------------- kodeord */

  /**
   * Kodeordscookiens vaerdi.
   *
   * Bundet til BAADE udgivelsen og kodeordets hash: skifter Andreas kodeordet,
   * doer alle gamle cookies af sig selv, uden at noget skal ryddes op.
   */
  function laasKvittering(share) {
    return srv.hmac(`wiki:${share.id}:${share.password_hash || ''}`);
  }

  function cookieNavn(share) {
    return `sagu_w_${share.id}`;
  }

  function erLaastOp(req, share) {
    if (!share.password_hash) return true;
    const c = srv.cookies(req)[cookieNavn(share)];
    return !!c && srv.tidsSikkerLig(c, laasKvittering(share));
  }

  /* ---------------------------------------------------------- skabelonen */

  /**
   * Sidens ramme.
   *
   * Den arver SPA'ens udseende gratis: `/style.css?v=N` med N laest ud af
   * index.html ved opstart, og tema-scriptet indsat ORDRET. Serveren har
   * allerede regnet sha256 af netop den tekst til CSP-headeren, saa hashen
   * passer af sig selv - ingen ny undtagelse, ingen ny hash (RUNE-ERFARINGER
   * §9a, doda F12).
   */
  function ramme(o) {
    const titel = o.titel ? `${o.titel} · ${o.sted}` : o.sted;
    const robots = o.indekserbar ? 'index, follow' : 'noindex, nofollow';
    return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(titel)}</title>
<meta name="robots" content="${robots}">
<meta property="og:title" content="${attr(o.titel || o.sted)}">
<meta property="og:type" content="article">
${o.kanonisk ? `<link rel="canonical" href="${attr(o.kanonisk)}">
<meta property="og:url" content="${attr(o.kanonisk)}">` : ''}
${o.beskrivelse ? `<meta name="description" content="${attr(o.beskrivelse)}">
<meta property="og:description" content="${attr(o.beskrivelse)}">` : ''}
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#efe9e2">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141210">
<script data-theme-init>${srv.temaScript()}</script>
<link rel="stylesheet" href="/style.css?v=${srv.cssVersion()}">
${o.feed ? `<link rel="alternate" type="application/atom+xml" title="Changes" href="${attr(o.feed)}">` : ''}
</head>
<body class="wiki">
${o.krop}
<script src="/wiki.js?v=${srv.cssVersion()}" defer></script>
</body>
</html>`;
  }

  /** Topbaren. Soegefeltet er en almindelig GET-formular - den virker uden JS. */
  function top(share, rod, opt) {
    const o = opt || {};
    return `<header class="wtop">
  <a class="wbrand" href="${attr(rod)}/">${share.icon ? `<span class="wicon">${esc(share.icon)}</span>` : ''}<span>${esc(share.title)}</span></a>
  ${o.udenSoeg ? '' : `<form class="wsearch" method="get" action="${attr(rod)}/search" role="search"
        data-levende="${attr(rod)}/search">
    <input type="search" name="q" id="wq" placeholder="Search this wiki" value="${attr(o.q || '')}"
           aria-label="Search this wiki" autocomplete="off">
    <button class="btn" type="submit">Search</button>
    <div class="wtraefliste" hidden></div>
  </form>`}
  <button class="wtheme" id="wtheme" type="button" aria-label="Switch theme" hidden>◐</button>
</header>`;
  }

  /** Navigationstraeet. Kun titler - en side, der ikke er udgivet, staar der ikke. */
  function navHtml(raekke, rod, kort, aktivId, erBog) {
    if (raekke.length < 2) return '';
    const punkter = raekke.map((n) => {
      const her = n.id === aktivId;
      // I en notesbog har hver side sin egen adresse - ogsaa de oeverste.
      // I en note-udgivelse ER den oeverste selve forsiden.
      const sti = (!erBog && n.dybde === 0) ? `${rod}/` : `${rod}/${kort.get(n.id)}`;
      /*
       * Titlen i sin EGEN span.
       *
       * `.wnav-item` er en flex-raekke, og `text-overflow: ellipsis` virker
       * kun paa det element, teksten staar i - ikke paa containeren. Uden
       * span'en blev en lang importeret titel klippet HAARDT, uden de tre
       * prikker, der siger, at der er mere.
       */
      return `<a class="wnav-item${her ? ' on' : ''}" href="${attr(sti)}"
        style="padding-left:${10 + Math.min(n.dybde, 6) * 14}px"${her ? ' aria-current="page"' : ''}>${
  n.icon ? `<span class="wicon">${esc(n.icon)}</span>` : ''}<span class="wnav-tekst">${
  esc(n.title || 'Untitled')}</span></a>`;
    }).join('');
    /*
     * <details open> frem for JavaScript: browseren folder selv, og en menu,
     * der kraever JS, er en menu, der kan doe.
     *
     * Den staar AABEN, og paa en telefon flyttes hele navigationen i stedet
     * NED under artiklen med `order` i griddet - saa moeder laeseren siden og
     * ikke en liste over alle de andre.
     *
     * Foerste forsoeg var at sende den LUKKET og tvinge den aaben med CSS paa
     * desktop. Layoutet sagde ja (display: flex, 34 px hoej), men punkterne
     * blev ikke TEGNET - og jeg kan ikke afgoere i et preview-panel, om det er
     * panelet eller browseren. En navigation, hvis synlighed afhaenger af, om
     * et trick holder, er ikke noget at bygge en offentlig side paa.
     */
    return `<nav class="wnav"><details class="wnav-fold" open>
      <summary>Pages</summary>${punkter}</details></nav>`;
  }

  /** Sideoversigten i hoejre kant. Samme id'er, som rendereren gav overskrifterne. */
  function tocHtml(overskrifter) {
    const brugbare = overskrifter.filter((h) => h.niveau <= 3);
    if (brugbare.length < 2) return '';
    return `<aside class="wtoc"><div class="wtoc-inder"><p class="wtoc-hoved">On this page</p>${
      brugbare.map((h) => `<a class="wtoc-link n${h.niveau}" href="#${attr(h.id)}">${esc(h.tekst)}</a>`).join('')
    }</div></aside>`;
  }

  /**
   * En synlig vej tilbage til forsiden.
   *
   * Maerket i toppen linker allerede hjem, og broedkrummen goer det ogsaa -
   * men ingen af dem LIGNER en knap, og en laeser, der er landet dybt nede fra
   * et link, leder efter noget at trykke paa (Andreas, 2026-08-21). En udvej
   * skal kunne SES, ikke bare findes (doda v39).
   */
  function hjemHtml(rod) {
    return `<a class="whjem" href="${attr(rod)}/">← Front page</a>`;
  }

  function krummerHtml(kaede, rod, kort) {
    if (kaede.length < 2) return '';
    return `<nav class="wkrummer">${kaede.map((n, i) => {
      const sidst = i === kaede.length - 1;
      // dybde -1 = selve notesbogen; den har ingen note og peger paa forsiden.
      const sti = (i === 0 || n.dybde === -1) ? `${rod}/` : `${rod}/${kort.get(n.id)}`;
      return sidst
        ? `<span>${esc(n.title || 'Untitled')}</span>`
        : `<a href="${attr(sti)}">${esc(n.title || 'Untitled')}</a><span class="wsep">/</span>`;
    }).join('')}</nav>`;
  }

  /** »Sidst opdateret«, og et diskret maerke naar siden er blevet gammel. */
  function friskhed(note) {
    const dato = new Date(note.updatedAt * 1000).toISOString().slice(0, 10);
    const alder = srv.now() - note.updatedAt;
    const gammel = alder > GAMMEL_EFTER
      ? ` <span class="wgammel" title="This page may be out of date">not touched in ${
        Math.round(alder / (30 * 86400))} months</span>`
      : '';
    return `<p class="wmeta">Last updated ${esc(dato)}${gammel}</p>`;
  }

  /* ---------------------------------------------------------------- sider */

  function kodeordsSide(share, rod, fejl, naeste) {
    /*
     * Siden naevner IKKE wikiens titel.
     *
     * Uden kodeordet maa der ikke slippe indhold ud - heller ikke en titel.
     * Den besoegende kom fra et link, han fik af en kollega, saa han ved godt
     * hvor han er; en soegemaskine eller en, der taster sig frem, goer ikke.
     */
    const krop = `<div class="wlaas">
      <div class="card">
        <h1>${esc(srv.appName)}</h1>
        <p class="meta saetning">This wiki is password protected. Ask the person who shared the link.</p>
        <form method="post" action="${attr(rod)}/password">
          ${naeste ? `<input type="hidden" name="next" value="${attr(naeste)}">` : ''}
          <label class="field"><span>Password</span>
            <input class="input" type="password" name="password"
                   autocomplete="current-password" autofocus required></label>
          ${fejl ? `<p class="wfejl">${esc(fejl)}</p>` : ''}
          <div class="btnrow"><button class="btn primary" type="submit">Open</button></div>
        </form>
      </div>
    </div>`;
    // Aldrig indekserbar, uanset hvad udgivelsen ellers siger: en
    // kodeordsside i en soegemaskine er stoej.
    return ramme({ sted: srv.appName, titel: 'Password', krop, indekserbar: false });
  }

  function noteSide(share, rod, raekke, kort, note, opt) {
    const o = opt || {};
    // `dybde` hoerer til RAEKKEN, ikke til noten: `hentUdgivetNote` giver en
    // almindelig note. Slaar man den ikke op, er `note.dybde` undefined, og
    // forsiden faar sin egen underside-adresse.
    const sideSlug = sideSlugFor(share, raekke, kort, note.id);
    // FOER render: krogen nedenfor kaldes UNDER optegningen, saa `erBog` skal
    // vaere erklaeret allerede - ellers rammer man en TDZ-fejl midt i en
    // skabelon, hvor den ligner alt muligt andet.
    const erBog = !!share.notebook_id;
    const { html, overskrifter } = md.render(note.body, {
      billedUrl: (u) => o.filUrl(u),
      // Et link kan pege paa en fil ELLER paa en anden side i udgivelsen.
      // Peger det paa en note, der ikke er udgivet, svarer krogen `false`:
      // saa staar teksten der som doed - uden adressen og uden id'et.
      linkUrl: (u) => {
        const fil = o.filUrl(u);
        if (fil) return fil;
        const m = /^sagu-note:([a-f0-9]{32})$/.exec(String(u || ''));
        if (!m) return null;
        const maal = raekke.find((x) => x.id === m[1]);
        if (!maal) return false;
        return (!erBog && maal.dybde === 0) ? `${rod}/` : `${rod}/${kort.get(maal.id)}`;
      },
      slaaOpNote: (titel) => {
        const t = raekke.find((x) => String(x.title || '').toLowerCase() === titel.toLowerCase());
        if (!t) return null;
        return { href: (!erBog && t.dybde === 0) ? `${rod}/` : `${rod}/${kort.get(t.id)}` };
      },
      /*
       * GitHub-indlejringer paa wikien (F12).
       *
       * **Kun fra cachen.** En besoegende maa aldrig kunne udloese et kald
       * til GitHub: siden er offentlig, og en fremmed, der genindlaeser
       * hurtigt nok, ville ellers bruge Andreas' kvote op - og med hans
       * token, altsaa mod hans private repoer. Ligger svaret ikke i cachen,
       * bliver linjen det link, den var.
       *
       * Kortet er RENT HTML. Ingen kopier-knap, ingen opfrisk-knap: wikien
       * har ikke app-JS, og en knap, der ikke virker, er vaerre end ingen.
       */
      bartLink: (u, b) => srv.githubKort(u, b),
    });

    /*
     * Intet »forrige/naeste«-baand.
     *
     * En wiki er ikke en bog, man laeser forfra: man kommer ind paa en side
     * fra et link eller en soegning, og naboen i traeet har som regel intet
     * med den at goere. Baandet fyldte mest og pegede tilfaeldigt hen
     * (Andreas, 2026-08-21). Navigationen til venstre er vejen videre.
     */
    const link = (n) => ((!erBog && n.dybde === 0) ? `${rod}/` : `${rod}/${kort.get(n.id)}`);

    // Kun de backlinks, der ogsaa ER udgivet. En henvisning til en note, der
    // ikke er delt, maa ikke kunne ses - heller ikke som en titel.
    const bagud = (note.backlinks || []).filter((b) => kort.has(b.id));

    const krop = `${top(share, rod)}
<div class="wwrap">
  ${navHtml(raekke, rod, kort, note.id, !!share.notebook_id)}
  <main class="wmain">
    ${hjemHtml(rod)}
    ${krummerHtml(o.kaede || [], rod, kort)}
    <h1 class="wtitel">${note.icon ? `<span class="wicon">${esc(note.icon)}</span>` : ''}${esc(note.title || 'Untitled')}</h1>
    ${friskhed(note)}
    ${egenskaberHtml(note.props)}
    <article class="note-body wnote">${html}</article>
    ${bagud.length ? `<section class="wbagud"><h2 id="pages-that-link-here">Pages that link here</h2>
      <ul>${bagud.map((b) => `<li><a href="${attr(link(raekke.find((x) => x.id === b.id)))}">${esc(b.title || 'Untitled')}</a></li>`).join('')}</ul>
    </section>` : ''}
    ${kommentarAfsnit(share, rod, sideSlug, note.id, o)}
    ${fodHtml(share, rod)}
  </main>
  ${tocHtml(overskrifter)}
</div>`;

    return ramme({
      sted: share.title,
      titel: note.title || 'Untitled',
      kanonisk: o.kanonisk,
      beskrivelse: md.tilTekst(note.body).replace(/\s+/g, ' ').trim().slice(0, 200),
      krop,
      feed: `${rod}/feed`,
      // Kun en udgivelse UDEN kodeord kan overhovedet indekseres - og kun
      // hvis ejeren har sagt ja. Fravaer betyder nej.
      indekserbar: !share.password_hash && !!share.allow_index,
    });
  }

  /* --------------------------------------------------- kommentarer (F7) */

  /**
   * Kommentarerne under en side - og formularen, der laver dem.
   *
   * **Uden en linje JavaScript.** Det er ikke sparsommelighed: hele modulets
   * pointe er, at en besoegende ikke henter app-kode og ikke kan kalde noget.
   * Et svar er derfor et LINK (`?reply=<id>`), som tegner formularen ét sted
   * laengere nede - ikke en knap, der folder noget ud.
   *
   * Kommentarens tekst gaar gennem den samme renderer som noterne, med
   * hvidliste og escaping foerst. Men **krogene siger nej til alt**: en
   * gaest maa ikke kunne pege paa en vedhaeftning eller en anden side med
   * `sagu:`-adresser, som han umuligt kan kende id'erne paa i forvejen.
   */
  function kommentarHtml(c, rod, sideSlug, svarene) {
    const svar = (svarene || []).filter((x) => x.parentId === c.id);
    return `<li class="wkom" id="c-${attr(c.id)}">
      <div class="wkom-top">
        <span class="wkom-navn">${esc(c.author)}</span>
        ${c.guest ? '<span class="wkom-gaest">guest</span>' : ''}
        ${c.kind === 'suggestion' ? '<span class="wkom-forslag">suggested edit</span>' : ''}
        <time datetime="${attr(new Date(c.createdAt * 1000).toISOString())}">${esc(dato(c.createdAt))}</time>
      </div>
      <div class="note-body wkom-krop">${md.render(c.body, {
    billedUrl: () => null, linkUrl: () => null, noFoelg: true,
  }).html}</div>
      ${svar.length ? `<ul class="wkom-svar">${svar.map((x) => kommentarHtml(x, rod, sideSlug, [])).join('')}</ul>` : ''}
      ${c.parentId ? '' : `<a class="wkom-svarlink"
        href="${attr(`${rod}/${sideSlug}?reply=${encodeURIComponent(c.id)}#comment-form`)}">Reply</a>`}
    </li>`;
  }

  function dato(sek) {
    return new Date(sek * 1000).toISOString().slice(0, 10);
  }

  /**
   * Sidens adresse-slug - tom for en note-udgivelses FORSIDE.
   *
   * ÉT sted, fordi tre flader spoerger om det samme (formularen, den
   * kanoniske adresse og linkene): to udregninger af den samme adresse er to
   * steder, den kan blive forkert.
   */
  function sideSlugFor(share, raekke, kort, noteId) {
    const n = raekke.find((x) => x.id === noteId);
    if (!share.notebook_id && n && n.dybde === 0) return '';
    return kort.get(noteId) || '';
  }

  /**
   * Formularen.
   *
   * `website` er en honningkrukke: feltet ligger uden for skaermen og har
   * `tabindex="-1"`, saa et menneske hverken ser eller rammer det. En robot
   * udfylder alt. Svaret paa et udfyldt felt er **ikke** en fejlmeddelelse -
   * den ville bare fortaelle robotten, hvad den skulle lade vaere med. Den
   * faar samme kvittering som alle andre, og kommentaren gemmes ikke.
   */
  function kommentarFormular(share, rod, sideSlug, opt) {
    const o = opt || {};
    return `<form class="wkomform" id="comment-form" method="post" action="${attr(rod)}/comment">
      <input type="hidden" name="page" value="${attr(sideSlug)}">
      ${o.svarPaa ? `<input type="hidden" name="reply" value="${attr(o.svarPaa)}">` : ''}
      ${o.svarPaa ? `<p class="wkom-svarer">Replying to a comment ·
        <a href="${attr(`${rod}/${sideSlug}#comments`)}">cancel</a></p>` : ''}
      <div class="wkomform-navn">
        <label for="wc-navn">Your name</label>
        <input id="wc-navn" name="author" maxlength="60" autocomplete="name" placeholder="Optional">
      </div>
      <label for="wc-tekst">${o.svarPaa ? 'Your reply' : 'Your comment'}</label>
      <textarea id="wc-tekst" name="body" rows="4" maxlength="4000" required
        placeholder="Markdown works here."></textarea>
      <div class="wkom-krukke" aria-hidden="true">
        <label for="wc-website">Website</label>
        <input id="wc-website" name="website" tabindex="-1" autocomplete="off">
      </div>
      <div class="wkomform-knapper">
        <button type="submit" name="kind" value="comment" class="btn primary">Post comment</button>
        ${o.svarPaa ? '' : `<button type="submit" name="kind" value="suggestion" class="btn">
          Suggest an edit</button>`}
      </div>
      <p class="meta saetning">${share.moderate_comments
    ? 'Comments are read before they appear.'
    : 'Comments appear right away. Anything with a link is read first.'}</p>
    </form>`;
  }

  function kommentarAfsnit(share, rod, sideSlug, noteId, opt) {
    if (!share.allow_comments) return '';
    const o = opt || {};
    const alle = srv.kommentarerFor(noteId);
    const top = alle.filter((c) => !c.parentId);
    const kvittering = o.kvittering
      ? `<p class="wkom-kvit">${esc(o.kvittering)}</p>` : '';
    return `<section class="wkommentarer" id="comments">
      <h2 id="comments-heading">Comments${top.length ? ` <span class="wkom-antal">${alle.length}</span>` : ''}</h2>
      ${kvittering}
      ${top.length
    ? `<ul class="wkom-liste">${top.map((c) => kommentarHtml(c, rod, sideSlug, alle)).join('')}</ul>`
    : '<p class="meta saetning">No comments yet. Yours would be the first.</p>'}
      ${kommentarFormular(share, rod, sideSlug, o)}
    </section>`;
  }

  /** Notion-databasernes kolonner staar oeverst, som i appen. */
  function egenskaberHtml(props) {
    if (!props || !props.length) return '';
    return `<table class="wprops"><tbody>${props.map((p) => `<tr>
      <th>${esc(p.key)}</th><td>${md.inline(p.value, {})}</td></tr>`).join('')}</tbody></table>`;
  }

  function fodHtml(share, rod) {
    return `<footer class="wfod">
      <span>Published with Sagu</span>
      <span class="wsep">·</span><a href="${attr(rod)}/changes">Recent changes</a>
      ${share.allow_search ? `<span class="wsep">·</span><a href="${attr(rod)}/search">Search</a>` : ''}
    </footer>`;
  }

  /**
   * Forsiden for en udgivet NOTESBOG.
   *
   * En bog har ingen forside-note, saa den bygges her: bogens navn og et kort
   * pr. side i toppen. Det er bedre end at kraeve, at ejeren laver en kunstig
   * forside for at kunne dele det, der allerede var en samling.
   */
  function bogForside(share, rod, raekke, kort, opt) {
    const top_ = top;                       // topbaren
    const oeverste = raekke.filter((n) => n.dybde === 0);
    /*
     * Ingen liste over alle siderne her.
     *
     * Foerste udgave havde et kort-grid under soegefeltet - og det sagde
     * PRAECIS det samme som navigationen til venstre og listen nedenunder.
     * Tre lister over det samme paa den side, folk lander paa, er ikke tre
     * indgange; det er stoej (Andreas, 2026-08-21). Forsiden er nu det, en
     * wiki-forside skal vaere: soeg efter noget, eller se hvad der er nyt.
     */
    // De fem senest rørte. En wiki doer af foraeldet indhold, ikke af
    // manglende indhold (SAGU-PLAN §5) - saa det, der ER friskt, skal staa
    // paa forsiden.
    const nyeste = raekke.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    const link = (n) => `${rod}/${kort.get(n.id)}`;

    const krop = `${top_(share, rod, { udenSoeg: true })}
<div class="wwrap">
  ${navHtml(raekke, rod, kort, null, !!share.notebook_id)}
  <main class="wmain">
    <h1 class="wtitel">${share.icon ? `<span class="wicon">${esc(share.icon)}</span>` : ''}${esc(share.title)}</h1>
    <p class="wmeta">${raekke.length} page${raekke.length === 1 ? '' : 's'}</p>
    ${share.allow_search ? `<form class="wsoegstor" method="get" action="${attr(rod)}/search" role="search"
      data-levende="${attr(rod)}/search">
      <input type="search" name="q" id="wq" placeholder="Search ${attr(share.title)}"
             aria-label="Search this wiki" autocomplete="off" autofocus>
      <button class="btn primary" type="submit">Search</button>
      <div class="wtraefliste" hidden></div>
    </form>
    <p class="meta saetning" style="margin:-6px 0 26px">Titles, headings, body text and tags —
    not just the headings.</p>` : ''}
    ${oeverste.length ? '' : '<p class="lead">This notebook is empty.</p>'}
    ${nyeste.length > 1 ? `<h2 class="wafsnit">Recently updated</h2>
      <ul class="wtraeffer">${nyeste.map((n) => `<li class="wtraef">
        <a class="wtraef-titel" href="${attr(link(n))}">${esc(n.title || 'Untitled')}</a>
        <span class="wtraef-afsnit">${esc(new Date(n.updatedAt * 1000).toISOString().slice(0, 10))}</span>
      </li>`).join('')}</ul>` : ''}
    ${fodHtml(share, rod)}
  </main>
</div>`;
    return ramme({
      sted: share.title,
      titel: '',
      krop,
      feed: `${rod}/feed`,
      kanonisk: (opt || {}).kanonisk,
      indekserbar: !share.password_hash && !!share.allow_index,
    });
  }

  /* ------------------------------------------------------------- soegning */

  function soegeSide(share, rod, raekke, kort, q, svar) {
    const erBog = !!share.notebook_id;
    const link = (id) => {
      const n = raekke.find((x) => x.id === id);
      if (!n) return `${rod}/`;
      return (!erBog && n.dybde === 0) ? `${rod}/` : `${rod}/${kort.get(n.id)}`;
    };
    const traef = (svar.results || []).map((r) => {
      // Uddraget escapes FOERST, og << >> bliver til <mark> bagefter. Der er
      // derfor ingen vej fra notens tekst til et tag.
      const uddrag = esc(r.excerpt || '').replace(/&lt;&lt;/g, '<mark>').replace(/&gt;&gt;/g, '</mark>');
      const til = r.section ? `${link(r.id)}#${encodeURIComponent(r.section)}` : link(r.id);
      return `<li class="wtraef">
        <a class="wtraef-titel" href="${attr(til)}">${esc(r.title || 'Untitled')}</a>
        ${r.sectionTitle ? `<span class="wtraef-afsnit">§ ${esc(r.sectionTitle)}</span>` : ''}
        <p class="wtraef-uddrag">${uddrag}</p>
        ${r.tags && r.tags.length ? `<p class="meta">${r.tags.map((t) => `#${esc(t)}`).join(' ')}</p>` : ''}
      </li>`;
    }).join('');

    const krop = `${top(share, rod, { q })}
<div class="wwrap">
  ${navHtml(raekke, rod, kort, null, !!share.notebook_id)}
  <main class="wmain">
    ${hjemHtml(rod)}
    <h1 class="wtitel">${q ? `Results for “${esc(q)}”` : 'Search'}</h1>
    ${q && !svar.results.length ? `<p class="lead">Nothing matched. Try fewer words —
      the search covers titles, headings, body text, tags and properties.</p>` : ''}
    ${svar.fallback && svar.results.length ? `<p class="meta saetning">No index match —
      the text was read instead, so these are not ranked.</p>` : ''}
    ${svar.results.length ? `<ul class="wtraeffer">${traef}</ul>` : ''}
    ${!q ? `<p class="lead">Type a word. You can also use
      <code>tag:</code>, <code>in:</code>, <code>updated:&lt;30d</code>,
      <code>"a phrase"</code> and <code>-without</code>.</p>` : ''}
    ${fodHtml(share, rod)}
  </main>
</div>`;
    return ramme({ sted: share.title, titel: q ? `Search: ${q}` : 'Search', krop, indekserbar: false });
  }

  /* -------------------------------------------------------- aendringsfeed */

  function aendringsSide(share, rod, raekke, kort) {
    const nyeste = raekke.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
    const krop = `${top(share, rod)}
<div class="wwrap">
  ${navHtml(raekke, rod, kort, null, !!share.notebook_id)}
  <main class="wmain">
    ${hjemHtml(rod)}
    <h1 class="wtitel">Recent changes</h1>
    <p class="lead">What has moved lately. <a href="${attr(rod)}/feed">Atom feed</a> if you would
      rather be told than remember to look.</p>
    <ul class="wtraeffer">${nyeste.map((n) => `<li class="wtraef">
      <a class="wtraef-titel" href="${attr((!share.notebook_id && n.dybde === 0) ? `${rod}/` : `${rod}/${kort.get(n.id)}`)}">${esc(n.title || 'Untitled')}</a>
      <span class="meta">${esc(new Date(n.updatedAt * 1000).toISOString().slice(0, 10))}</span></li>`).join('')}</ul>
    ${fodHtml(share, rod)}
  </main>
</div>`;
    return ramme({ sted: share.title, titel: 'Recent changes', krop, feed: `${rod}/feed`, indekserbar: false });
  }

  /** Atom. Ren tekst i XML: samme escaping som HTML, og aldrig raa krop. */
  function atomFeed(share, rod, raekke, kort, vaert) {
    const nyeste = raekke.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
    const iso = (t) => new Date(t * 1000).toISOString();
    const abs = (sti) => `${vaert}${sti}`;
    return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(share.title)}</title>
  <id>${esc(abs(rod))}/</id>
  <updated>${iso(nyeste.length ? nyeste[0].updatedAt : srv.now())}</updated>
  <link rel="alternate" href="${attr(abs(rod))}/"/>
  <link rel="self" href="${attr(abs(rod))}/feed"/>
${nyeste.map((n) => `  <entry>
    <title>${esc(n.title || 'Untitled')}</title>
    <id>${esc(abs(rod))}/${esc(kort.get(n.id) || '')}</id>
    <updated>${iso(n.updatedAt)}</updated>
    <link rel="alternate" href="${attr(abs((!share.notebook_id && n.dybde === 0) ? `${rod}/` : `${rod}/${kort.get(n.id)}`))}"/>
  </entry>`).join('\n')}
</feed>`;
  }

  /* ------------------------------------------------------------ routeren */

  /**
   * Tager enhver `/w/…` og `/s/…`. Returnerer true, naar den har svaret.
   *
   * Raekkefoelgen er med vilje: FIND udgivelsen, TJEK laasen, og foerst
   * derefter afgoer hvilken side der skal tegnes. Saa kan en ny rute ikke
   * komme til at ligge foer laasen.
   */
  async function svar(req, res, ctx) {
    const sti = ctx.urlPath;
    const m = /^\/(w|s)\/([^/]+)(\/.*)?$/.exec(sti);
    if (!m) { srv.ikkeFundet(res); return true; }

    const viaToken = m[1] === 's';
    const navn = decodeURIComponent(m[2]);
    const rest = (m[3] || '/').replace(/^\/+/, '');
    const share = srv.findUdgivelse(navn, viaToken);
    // Ukendt, tilbagekaldt eller udloebet: 404. Ikke 403 - den ville bekraefte,
    // at adressen fandtes engang.
    if (!share) { srv.ikkeFundet(res); return true; }
    const rod = rodSti(share);

    /* --- kodeordsformularen ------------------------------------------- */
    if (rest === 'password') {
      if (req.method !== 'POST') { srv.omdiriger(res, `${rod}/`); return true; }
      if (!share.password_hash) { srv.omdiriger(res, `${rod}/`); return true; }
      const ip = srv.clientIp(req);
      /*
       * To spaerrer, og den anden er den vigtige.
       *
       * Pr. IP stopper én, der gaetter. Men en IP kan skiftes ud (og bag en
       * proxy er den bare en header), saa spaerren pr. UDGIVELSE er den, der
       * faktisk baerer: 60 forsoeg i timen mod det samme kodeord.
       */
      if (!srv.rateAllow(`wpass:${ip}`, 20, 900) || !srv.rateAllow(`wpass:${share.id}`, 60, 3600)) {
        srv.sendHtml(res, 429, kodeordsSide(share, rod, 'Too many attempts. Try again in a little while.', null));
        return true;
      }
      const felter = await srv.laesFormular(req);
      const naeste = rensNaeste(felter.next, rod);
      if (!srv.verifyPassword(String(felter.password || ''), share.password_hash)) {
        srv.logSecurity(`wiki-kodeord-fejl ip=${ip} share=${share.id}`);
        srv.sendHtml(res, 401, kodeordsSide(share, rod, 'That password does not match.', naeste));
        return true;
      }
      srv.rateClear(`wpass:${ip}`);
      srv.omdiriger(res, naeste || `${rod}/`, {
        'Set-Cookie': srv.wikiCookie(req, cookieNavn(share), laasKvittering(share), 7 * 86400),
      });
      return true;
    }

    /* --- laasen -------------------------------------------------------- */
    if (!erLaastOp(req, share)) {
      // Kun FORSIDEN svarer med formularen. Alt andet - en dyb side, en
      // soegning, en fil, feedet - er 404, saa en besoegende uden kodeordet
      // ikke kan afgoere, hvad der findes derinde.
      if (rest === '') { srv.sendHtml(res, 200, kodeordsSide(share, rod, null, null)); return true; }
      if (erSideSti(rest)) {
        // En dyb side sender til formularen og HUSKER hvor man skulle hen.
        srv.omdiriger(res, `${rod}/?next=${encodeURIComponent(`${rod}/${rest}`)}`);
        return true;
      }
      srv.ikkeFundet(res);
      return true;
    }

    /* --- indholdet ----------------------------------------------------- */
    const noter = srv.udgivelsensNoter(share);
    // En tom NOTESBOG er stadig en gyldig udgivelse - forsiden siger det.
    // En note-udgivelse uden noter findes derimod ikke laengere.
    if (!noter.length && !share.notebook_id) { srv.ikkeFundet(res); return true; }
    const raekke = iLaeseraekkefoelge(noter, share.notebook_id ? null : share.note_id);
    const kort = slugKort(raekke);
    const ider = raekke.map((n) => n.id);

    /* --- en kommentar fra en gaest -------------------------------------- */
    if (rest === 'comment') {
      // GET paa adressen er ikke en fejl - det er nogen, der genindlaeser
      // efter at have sendt. Send dem hjem frem for at vise en 404.
      if (req.method !== 'POST') { srv.omdiriger(res, `${rod}/`); return true; }
      if (!share.allow_comments) { srv.ikkeFundet(res); return true; }

      const felter = await srv.laesFormular(req);
      const sideSlug = String(felter.page || '');
      let noteId = share.note_id;
      if (sideSlug) {
        const fundet = [...kort.entries()].find(([, s2]) => s2 === sideSlug);
        if (!fundet) { srv.ikkeFundet(res); return true; }
        [noteId] = fundet;
      }
      // Noten skal ligge i UDGIVELSEN. Samme id-liste som alt andet - der er
      // ingen anden vej ind, heller ikke for en formular.
      if (!noteId || !ider.includes(noteId)) { srv.ikkeFundet(res); return true; }
      const tilbage = `${rod}/${sideSlug}`;
      const ip = srv.clientIp(req);

      /*
       * Honningkrukken. Et udfyldt felt faar samme kvittering som alle andre
       * og gemmes ikke. En fejlmeddelelse ville bare fortaelle robotten,
       * hvilket felt den skulle lade vaere med at udfylde.
       */
      if (String(felter.website || '').trim()) {
        srv.logSecurity(`wiki-kommentar-krukke ip=${ip} share=${share.id}`);
        srv.omdiriger(res, `${tilbage}?posted=queued#comments`);
        return true;
      }

      // To spaerrer, som ved kodeordet: pr. IP mod én, der spammer, og pr.
      // UDGIVELSE mod mange - bag en proxy er en IP bare en header.
      if (!srv.rateAllow(`wkom:${ip}`, 10, 3600) || !srv.rateAllow(`wkom:${share.id}`, 60, 3600)) {
        srv.omdiriger(res, `${tilbage}?posted=slow#comments`);
        return true;
      }

      const svar2 = srv.opretGaesteKommentar(share, {
        noteId,
        body: felter.body,
        author: felter.author,
        kind: felter.kind,
        parentId: String(felter.reply || '') || null,
      });
      if (svar2.fejl) {
        srv.omdiriger(res, `${tilbage}?posted=${encodeURIComponent(svar2.fejl[0])}#comment-form`);
        return true;
      }
      srv.omdiriger(res, `${tilbage}?posted=${svar2.ventende ? 'queued' : 'live'}#comments`);
      return true;
    }

    if (rest === 'search') {
      if (!share.allow_search) { srv.ikkeFundet(res); return true; }
      const q = String(ctx.query.get('q') || '').slice(0, 200);
      const resultat = q ? srv.soegIUdgivelse(share, q, ider) : { results: [], fallback: false };
      /*
       * Levende soegning, som i appen - men uden appens API.
       *
       * Feltet skal opfoere sig som det, man kender fra den indloggede side:
       * traeffere mens man skriver. Det maa bare ikke gaa gennem `/api/` -
       * en besoegende skal ikke kunne naa app'ens endepunkter. Svaret her er
       * DEN SAMME soegning, afgraenset til udgivelsen, i JSON.
       *
       * Der er intet at oprette og ingen notesboeger at hoppe til: en laeser
       * kan soege i sider og maerker, og det er alt.
       */
      if (ctx.query.get('format') === 'json') {
        const link = (n) => ((!share.notebook_id && n.dybde === 0) ? `${rod}/` : `${rod}/${kort.get(n.id)}`);
        srv.sendTekst(res, 200, JSON.stringify({
          fallback: !!resultat.fallback,
          results: (resultat.results || []).slice(0, 8).map((r) => {
            const n = raekke.find((x) => x.id === r.id);
            return {
              title: r.title || 'Untitled',
              url: n ? (r.section ? `${link(n)}#${encodeURIComponent(r.section)}` : link(n)) : `${rod}/`,
              excerpt: r.excerpt || '',
              section: r.sectionTitle || '',
              tags: r.tags || [],
            };
          }),
          // Maerkerne i udgivelsen, saa feltet kan foreslaa dem paa `#`.
          tags: [...new Set((resultat.results || []).flatMap((r) => r.tags || []))].slice(0, 8),
        }), 'application/json; charset=utf-8', share);
        return true;
      }
      srv.sendHtml(res, 200, soegeSide(share, rod, raekke, kort, q, resultat), share);
      return true;
    }

    if (rest === 'changes') {
      srv.sendHtml(res, 200, aendringsSide(share, rod, raekke, kort), share);
      return true;
    }

    if (rest === 'feed') {
      const vaert = srv.offentligVaert(req);
      srv.sendTekst(res, 200, atomFeed(share, rod, raekke, kort, vaert),
        'application/atom+xml; charset=utf-8', share);
      return true;
    }

    if (rest.startsWith('f/')) {
      const filId = rest.slice(2);
      // Filen skal hoere til en note i UDGIVELSEN. Ét opslag med id-listen -
      // ikke en gennemsoegning, og ikke ejerens filer i al almindelighed.
      const fil = srv.filIUdgivelse(filId, ider);
      if (!fil) { srv.ikkeFundet(res); return true; }
      srv.sendFil(res, req, fil, !share.password_hash);
      return true;
    }

    /* --- en side ------------------------------------------------------- */
    // En notesbogs forside er GENERERET: bogen har ingen rod-note.
    if (!rest && share.notebook_id) {
      srv.taelVisning(share, share.notebook_id);
      srv.sendHtml(res, 200,
        bogForside(share, rod, raekke, kort, { kanonisk: `${srv.offentligVaert(req)}${rod}/` }), share);
      return true;
    }
    let noteId = share.note_id;
    if (rest) {
      const fundet = [...kort.entries()].find(([, s]) => s === rest);
      if (!fundet) { srv.ikkeFundet(res); return true; }
      [noteId] = fundet;
    }
    const note = srv.hentUdgivetNote(share, noteId, ider);
    if (!note) { srv.ikkeFundet(res); return true; }

    // Kaeden op til roden - kun saa langt udgivelsen raekker.
    const kaede = [];
    let p = note.id;
    const set = new Set(ider);
    for (let i = 0; i < 32 && p && set.has(p); i++) {
      const n = raekke.find((x) => x.id === p);
      if (!n) break;
      kaede.unshift(n);
      if (p === share.note_id) break;
      p = n.parentId;
    }
    // For en notesbog er selve BOGEN foerste krumme - ellers begynder stien
    // midt i noget, og der er ingen vej hjem fra en dyb side.
    if (share.notebook_id) kaede.unshift({ id: null, title: share.title, dybde: -1 });

    srv.taelVisning(share, note.id);
    // Kvitteringen efter en indsendelse. POST -> omdirigering -> GET, saa en
    // genindlaesning ikke sender kommentaren igen.
    const KVIT = {
      queued: 'Thank you. Your comment is waiting to be read before it appears.',
      live: 'Thank you. Your comment is below.',
      slow: 'That was a lot of comments in a short while. Try again a bit later.',
      empty_comment: 'Write something first.',
      unknown_parent: 'The comment you replied to is gone.',
    };
    const html = noteSide(share, rod, raekke, kort, note, {
      // Den ENE adresse, siden hedder - uanset hvilket vaertsnavn kaldet kom
      // paa. Uden den ser en soegemaskine samme side paa to domaener.
      kanonisk: `${srv.offentligVaert(req)}${rod}/${sideSlugFor(share, raekke, kort, note.id)}`,
      kvittering: KVIT[String(ctx.query.get('posted') || '')] || null,
      svarPaa: String(ctx.query.get('reply') || '').slice(0, 32) || null,
      kaede,
      // Kun filer, der hoerer til udgivelsen, faar en adresse. Alt andet
      // bliver til et synligt link med en forklaring, praecis som i appen.
      filUrl: (u) => {
        const t = /^sagu:([a-f0-9]{32})$/.exec(String(u || ''));
        if (!t) return null;
        return srv.filIUdgivelse(t[1], ider) ? `${rod}/f/${t[1]}` : null;
      },
    });
    srv.sendHtml(res, 200, html, share);
    return true;
  }

  /** Er stien en SIDE (og ikke soegning, fil eller feed)? */
  function erSideSti(rest) {
    return !rest.startsWith('f/') && !RESERVEREDE.has(rest);
  }

  /**
   * En viderestilling efter login maa kun pege ind i DENNE udgivelse.
   *
   * Ellers er kodeordssiden en aaben viderestilling - og det er praecis dér,
   * den besoegende er indstillet paa at godkende noget (RUNE-ERFARINGER,
   * doda F12).
   */
  function rensNaeste(raa, rod) {
    const s = String(raa || '');
    if (!s.startsWith(`${rod}/`)) return null;
    if (s.includes('//') || s.includes('\\')) return null;
    return s;
  }

  return { svar, slugKort, iLaeseraekkefoelge, rodSti };
}

module.exports = { opret, RESERVEREDE };
