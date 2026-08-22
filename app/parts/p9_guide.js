/*
 * F9 - siden om API'et og iPhone-genvejene.
 *
 * ── Hvorfor den findes ────────────────────────────────────────────────────
 *
 * En noegle er ubrugelig uden en opskrift. Man kan se, at der ER et API, men
 * ikke hvad man skriver i Shortcuts' »Get Contents of URL« - og saa bliver
 * funktionen meldt som manglende, selv om den virker (RUNE-ERFARINGER,
 * tovo v8: en funktion, man ikke kan SE, findes ikke for brugeren).
 *
 * ── Reglen, siden er skrevet efter ────────────────────────────────────────
 *
 * **En hjaelpetekst er en kravspecifikation** (doda v9/v35/v38). Hver eneste
 * linje herunder svarer til noget, der er DAEKKET AF EN TEST i
 * `tests/api.test.mjs` - de fire veje ind, `to=today`, `?date=`,
 * `notebook=<navn>`, `#maerke`, `?format=md`, `changes` med slettede id'er, og
 * hele scope-matricen. Bliver et endepunkt lavet om, skal linjen her med i
 * samme ombaering; ellers staar der en funktion, appen ikke har.
 *
 * Adressen skrives med `offentligBase()` - den samme, udgivelsesruden bruger.
 * Ellers ville en opskrift, man kopierer fra én adresse, pege et andet sted
 * hen end en, man kopierer fra en anden (DESIGN.md §15).
 */

/** Ét sted: adressen, opskrifterne skrives med. */
function apiBase() {
  return offentligBase();
}

/**
 * En opskrift.
 *
 * `felter` er præcis dét, der skal staa i Shortcuts' »Get Contents of URL« -
 * i den raekkefoelge, felterne staar dér. Alt andet er stoej for den, der
 * sidder med telefonen i haanden.
 */
function opskriftHtml(o) {
  return `<div class="opskrift">
    <h3>${esc(o.navn)}</h3>
    <p class="lead">${o.hvorfor}</p>
    <table class="data opskrift-felter"><tbody>
      ${o.felter.map(([navn, vaerdi]) => `<tr>
        <th>${esc(navn)}</th>
        <td><code>${esc(vaerdi)}</code></td></tr>`).join('')}
    </tbody></table>
    ${o.noter ? `<p class="meta saetning">${o.noter}</p>` : ''}
  </div>`;
}

function sideApi() {
  const b = apiBase();
  const OPSKRIFTER = [
    {
      navn: 'Send text to Sagu',
      hvorfor: 'One field and a button. The first line becomes the title, the rest becomes the note.',
      felter: [
        ['URL', `${b}/api/v1/capture`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — one key, <code>text</code>, with the Shortcut Input as its value'],
      ],
      noter: 'A <strong>capture</strong> key is enough: it can put something new in and '
        + 'read nothing at all. Lose the phone, and it cannot be used to pull your archive. '
        + 'The answer carries a <code>message</code> field you can show as it is.',
    },
    {
      navn: 'Put it in today\'s note',
      hvorfor: 'Gathers the day\'s small things in one place, instead of a note per thought.',
      felter: [
        ['URL', `${b}/api/v1/capture?to=today`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — one key, <code>text</code>, with the Shortcut Input as its value'],
      ],
      noter: 'The note is named after the date (<code>2026-08-21</code>) and is made the '
        + 'first time you send something. In a different time zone than the server? Send your '
        + 'own day: <code>?to=today&amp;date=</code> with the date from <em>Current Date</em>.',
    },
    {
      navn: 'Add to a note you already have',
      hvorfor: 'A running page — a project, a shopping list, a log — that you add to from '
        + 'your phone during the day.',
      felter: [
        ['URL', `${b}/api/v1/capture?to=NOTE_ID`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'JSON — one key, <code>text</code>, with the Shortcut Input as its value'],
      ],
      noter: 'The text lands at the <em>bottom</em>; nothing already there is touched. A '
        + '<code>#tag</code> is <strong>added</strong> to the note\'s tags — it does not replace '
        + 'them. The id is the 32 characters at the end of the note\'s address in Sagu. '
        + 'You need a key that may write in that note; a note shared with you for reading '
        + 'answers 404, the same as one that does not exist.',
    },
    {
      navn: 'Add a photo to a note you already have',
      hvorfor: 'A picture of the cabinet straight into the page about the cabinet.',
      felter: [
        ['URL', `${b}/api/v1/capture?to=NOTE_ID&name=foto.jpg`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'File (Danish: <em>Arkiv</em>) — the Shortcut Input'],
      ],
      noter: 'A picture is the one case where <em>Request Body</em> must be <strong>File</strong> (<em>Arkiv</em>) and not JSON. The image is '
        + 'written in at the bottom and attached to the note. Add <code>&amp;text=</code> if it '
        + 'needs a line above it; without one the picture stands on its own.',
    },
    {
      navn: 'Share an image from the share sheet',
      hvorfor: 'A photo of the cabinet, a whiteboard, a receipt — as a note with the image in it.',
      felter: [
        ['URL', `${b}/api/v1/capture?name=foto.jpg&text=Skabet%20i%20kaelderen`],
        ['Method', 'POST'],
        ['Headers', 'Authorization: Bearer sagu_…'],
        ['Request Body', 'File (Danish: <em>Arkiv</em>) — the Shortcut Input'],
      ],
      noter: 'Again <strong>File</strong> (<em>Arkiv</em>), not JSON. The image becomes '
        + 'an attachment and is written into the note. Add <code>&amp;to=today</code> to put it '
        + 'in today\'s note instead.',
    },
    {
      navn: 'Get a note as markdown',
      hvorfor: 'To paste into an email, a message, or another program.',
      felter: [
        ['URL', `${b}/api/v1/notes/NOTE_ID?format=md`],
        ['Method', 'GET'],
        ['Headers', 'Authorization: Bearer sagu_…'],
      ],
      noter: 'The answer is plain text — not JSON to dig through. Needs a '
        + '<strong>read</strong> key; a capture key gets a 403.',
    },
    {
      navn: 'Search your notes',
      hvorfor: 'The same search as in the app — filters and all.',
      felter: [
        ['URL', `${b}/api/v1/search?q=vpn+tag:drift`],
        ['Method', 'GET'],
        ['Headers', 'Authorization: Bearer sagu_…'],
      ],
      noter: 'The filters work as they do in the field: <code>tag:</code>, <code>in:</code>, '
        + '<code>updated:&lt;30d</code>, <code>has:code</code>, <code>"a phrase"</code> '
        + 'and <code>-without</code>.',
    },
    {
      navn: 'Keep a copy up to date',
      hvorfor: 'For a program mirroring the archive — it is told what was deleted, too.',
      felter: [
        ['URL', `${b}/api/v1/changes?since=0`],
        ['Method', 'GET'],
        ['Headers', 'Authorization: Bearer sagu_…'],
      ],
      noter: 'The answer has a <code>now</code> field. Keep it, and send it as <code>since</code> '
        + 'next time. <code>deleted</code> holds the ids of what is gone — without them a copy '
        + 'collects ghosts.',
    },
  ];

  return `
  <h2>What a key may do</h2>
  <div class="card">
    <div class="tablewrap"><table class="data">
      <thead><tr><th>Scope</th><th>Can</th><th>Cannot</th></tr></thead>
      <tbody>
        <tr><td><code>capture</code></td><td>Add new notes, images and <strong>comments</strong></td>
          <td><strong>Read nothing at all</strong></td></tr>
        <tr><td><code>read</code></td><td>Read and search</td><td>Write anything</td></tr>
        <tr><td><code>link</code></td><td>Read, search and add</td><td>Change or delete</td></tr>
        <tr><td><code>full</code></td><td>Everything above, and change and delete</td>
          <td>Make keys, change your password, or touch server settings</td></tr>
      </tbody>
    </table></div>
    <p class="meta saetning">A <strong>comment</strong> counts as capture, not as writing:
    it is something new beside the note, not a change to it — the same distinction the app
    itself makes, where a page shared with you for reading can still be commented on.
    Adding to the note's own text is different and needs a key that may write in it.
    A capture key gets no reply beyond »done«: a write-only door must not become a way to
    read.</p>
    <p class="meta saetning">No key can make another key or change your password — not even
    <code>full</code>. Otherwise one leaked key would be enough to give itself permanent
    access, or to lock you out of your own app. A key is revoked the moment you remove it
    in Settings; there is no cache to clear.</p>
  </div>

  <h2>The four ways to send text</h2>
  <div class="card">
    <p class="lead">A shortcut has one text field and no patience. <code>/api/v1/capture</code>
    therefore takes the text however it arrives:</p>
    <div class="tablewrap"><table class="data">
      <tbody>
        <tr><th>JSON</th><td><code>{"text": "Ny router i skabet"}</code></td></tr>
        <tr><th>Form</th><td><code>text=Ny+router+i+skabet</code></td></tr>
        <tr><th>Plain text</th><td>the body, with no Content-Type at all</td></tr>
        <tr><th>In the address</th><td><code>?text=Ny%20router</code></td></tr>
      </tbody>
    </table></div>
    <p class="meta saetning"><code>?to=</code> decides <em>where</em> it lands: nothing at all
    makes a new note, <code>today</code> uses today's note, and a <strong>note id</strong>
    adds to that page. The same three work for an image.</p>
    <div class="tablewrap"><table class="data">
      <tbody>
      </tbody>
    </table></div>
    <p class="meta saetning">A <code>#tag</code> in the first line becomes a real tag, exactly
    as it does in the title field — and a web address with a <code>#fragment</code> does not.
    Add <code>?notebook=Drift</code> to file it somewhere; the name works, so a shortcut does
    not have to look up an id.</p>
  </div>

  <h2>Recipes</h2>
  <div class="card">
    <p class="lead">In Shortcuts: <em>Get Contents of URL</em>. These are the fields, in the
    order they appear there.</p>
    <p class="meta saetning"><strong>Which »Request Body«?</strong> The menu offers exactly three:
    <code>JSON</code>, <code>Form</code> and <code>File</code> — on a Danish iPhone
    <code>JSON</code>, <code>Formular</code> and <code>Arkiv</code>. There is no »Text« entry,
    so pick <strong>JSON</strong> and give it one key called <code>text</code> with your
    Shortcut Input as the value. Do <strong>not</strong> set a Content-Type; Sagu takes the text
    as a JSON field, as form data, as a plain body or as <code>?text=</code> in the address —
    a shortcut with one field just has to work.</p>
    ${OPSKRIFTER.map(opskriftHtml).join('')}
  </div>

  <h2>Connect Claude</h2>
  <div class="card">
    <p class="lead">Sagu speaks <strong>MCP</strong>, so Claude can search your archive and
    write in it — without you pasting a key anywhere.</p>
    <div class="tablewrap"><table class="data">
      <tbody>
        <tr><th>Address</th><td><code>${b}/mcp</code></td></tr>
        <tr><th>In Claude</th><td>Settings → Connectors → Add custom connector</td></tr>
        <tr><th>In Claude Code</th><td><code>claude mcp add --transport http sagu ${b}/mcp</code></td></tr>
      </tbody>
    </table></div>
    <p class="meta saetning">The web client sends you through a consent page here and gets a
    key of its own; Claude Code and Desktop can also just carry a <strong>full</strong> key
    in an <code>Authorization</code> header. Either way the connection shows up under
    Settings → Connected apps, and revoking it cuts the app off at once.</p>
    <p class="meta saetning">Claude sees nine tools, and no more than the key allows: a
    <strong>read</strong> connection cannot even see the ones that write. Publishing a page
    is one of them — it puts the page on the <em>open web</em>, so Claude is told to ask
    first.</p>
  </div>

  <h2>When something goes wrong</h2>
  <div class="card">
    <div class="tablewrap"><table class="data">
      <tbody>
        <tr><th>401</th><td>The key is wrong or revoked. Nine times out of ten the
          <code>Authorization</code> value says only <code>Bearer</code> and the key itself
          never made it in — it has to read <code>Bearer sagu_…</code> in full. A key cannot
          be looked up again either: if the list only shows it shortened, make a new one.</td></tr>
        <tr><th>403</th><td>The key is <em>fine</em> — it is just too narrow.
          The message says which scope it has.</td></tr>
        <tr><th>404</th><td>No such note — or it is not yours. The two answer the same,
          so nobody can guess which ids exist.</td></tr>
        <tr><th>413</th><td>Too large, or your file storage is full. The message says which.</td></tr>
        <tr><th>429</th><td>Too many calls with that key. Wait a moment.</td></tr>
      </tbody>
    </table></div>
    <p class="meta saetning">Every error has a machine code and a sentence. A shortcut can show
    the sentence as it is; a program can branch on the code.</p>
  </div>`;
}
