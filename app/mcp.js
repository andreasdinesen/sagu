'use strict';
/*
 * Sagu - MCP-server (Model Context Protocol).
 *
 * Streamable HTTP + JSON-RPC 2.0, haandskrevet. MCP *er* JSON-RPC over HTTP
 * POST, saa der er ingen grund til en pakke i en rune, hvor hele pointen er
 * nul afhaengigheder (RUNE-ERFARINGER §9a).
 *
 * ── Den regel, hele modulet staar paa ─────────────────────────────────────
 *
 * **Vaerktoejerne gaar gennem DE SAMME funktioner som webappen.** Der maa
 * ikke findes en saerlig MCP-vej ind i dataene: gjorde der det, ville
 * `user_id`-filteret, maerke-reglen og adgangstjekket skulle huskes ét sted
 * mere. Gevinsten er stoerre end genbrug - fordi en ny klient kalder de samme
 * funktioner, er den en gratis integrationstest af dataadgangen.
 *
 * Godkendelsen er de samme adgangsnoegler som resten af API'et, med samme
 * scopes. En `capture`-noegle ser praecis ét vaerktoej.
 */

const PROTOKOL = '2025-06-18';
const PROTOKOLLER = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Et svar, en model kan LAESE. Id'et med, saa den kan arbejde videre. */
function noteLinje(n) {
  const dele = [n.title || 'Untitled'];
  if (n.notebook) dele.push(`in ${n.notebook}`);
  if (n.tags && n.tags.length) dele.push(n.tags.map((t) => `#${t}`).join(' '));
  return `- ${dele.join(' · ')}  (id: ${n.id})`;
}

function opret(srv) {
  /* ---------------------------------------------------------- vaerktoejer */

  const VAERKTOEJER = [
    {
      name: 'create_note',
      scope: 'capture',
      description:
        'Create a note in Sagu. The first line becomes the title, the rest becomes the '
        + 'body (markdown). A #tag in the first line becomes a real tag. Use to="today" to '
        + 'append to today\'s note instead of making a new one — that is where small things '
        + 'belong. Give a notebook by name if the note has an obvious home.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The whole note: first line is the title.' },
          notebook: { type: 'string', description: 'Notebook name. Optional.' },
          to: { type: 'string', description: 'Set to "today" to append to today\'s note.' },
        },
        required: ['text'],
      },
      kald(a, ctx) {
        const svar = srv.fangst(ctx.userId, String(a.text || ''), {
          tilDagens: String(a.to || '') === 'today',
          notesbog: srv.findNotesbog(ctx.userId, a.notebook),
        });
        if (svar.fejl) return { fejl: svar.fejl[1] };
        return {
          tekst: `${svar.tilfoejet ? 'Added to today\'s note' : 'Created'}: ${svar.note.title}\nid: ${svar.note.id}`,
          data: { note: { id: svar.note.id, title: svar.note.title } },
        };
      },
    },
    {
      name: 'search_notes',
      scope: 'read',
      description:
        'Search the archive. Same syntax as the app: plain words, "a phrase", -without, '
        + 'tag:name, in:notebook-or-page, updated:<30d, has:code|image|link|todo|table. '
        + 'Returns titles and ids — read the note itself with get_note.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search line, filters and all.' },
          limit: { type: 'number', description: 'How many at most. Default 20.' },
        },
        required: ['query'],
      },
      kald(a, ctx) {
        const r = srv.soegNoter(ctx.userId, String(a.query || ''), Math.min(Number(a.limit) || 20, 50));
        if (!r.results.length) return { tekst: 'Nothing matches that.', data: { results: [] } };
        const linjer = r.results.map(noteLinje);
        // Faldt soegningen tilbage til at laese teksten, er resultatet
        // URANGERET - og det maa ikke se ud som en rangering (F2).
        const hoved = r.fallback
          ? `${r.results.length} found by reading the text (no index match, so these are not ranked):`
          : `${r.results.length} found:`;
        return { tekst: `${hoved}\n${linjer.join('\n')}`, data: { results: r.results } };
      },
    },
    {
      name: 'get_note',
      scope: 'read',
      description:
        'The full note as markdown — the same text the app stores. Also returns its '
        + 'backlinks and attachments.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The note id, from a search.' } },
        required: ['id'],
      },
      kald(a, ctx) {
        const n = srv.hentNote(ctx.userId, String(a.id || ''));
        if (!n) return { fejl: 'No note with that id. Search for it first — never invent an id.' };
        let s = `# ${n.title}\n\n${String(n.body || '').replace(/^#\s+.*\n+/, '')}`;
        if (n.tags && n.tags.length) s += `\n\nTags: ${n.tags.map((t) => `#${t}`).join(' ')}`;
        if (n.files && n.files.length) s += `\nAttachments: ${n.files.map((f) => f.name).join(', ')}`;
        if (n.backlinks && n.backlinks.length) {
          s += `\nLinked from: ${n.backlinks.map((b) => b.title).join(', ')}`;
        }
        return { tekst: s, data: { note: n } };
      },
    },
    {
      name: 'append_note',
      scope: 'write',
      description:
        'Add text to the end of a note, without touching what is already there. Use this '
        + 'rather than update_note when you are adding — it cannot lose anything.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string', description: 'Markdown to add at the end.' },
        },
        required: ['id', 'text'],
      },
      kald(a, ctx) {
        const n = srv.hentNote(ctx.userId, String(a.id || ''));
        if (!n) return { fejl: 'No note with that id.' };
        const tilfoej = String(a.text || '').trim();
        if (!tilfoej) return { fejl: 'Nothing to add.' };
        const ny = `${String(n.body || '').replace(/\s+$/, '')}\n\n${tilfoej}\n`;
        const svar = srv.gemNote(ctx.userId, n.id, { body: ny });
        if (svar.fejl) return { fejl: 'Could not write to that note.' };
        return { tekst: `Added to “${n.title}”.`, data: { note: { id: n.id } } };
      },
    },
    {
      name: 'update_note',
      scope: 'write',
      description:
        'Replace a note\'s title or its whole body. The body is markdown and REPLACES what '
        + 'is there — read the note first, or use append_note if you are only adding.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string', description: 'The whole new body, in markdown.' },
        },
        required: ['id'],
      },
      kald(a, ctx) {
        const felter = {};
        if (typeof a.title === 'string') felter.title = a.title;
        if (typeof a.body === 'string') felter.body = a.body;
        if (!Object.keys(felter).length) return { fejl: 'Send a title or a body to change.' };
        const svar = srv.gemNote(ctx.userId, String(a.id || ''), felter);
        if (svar.fejl === 'not_found') return { fejl: 'No note with that id.' };
        if (svar.fejl) return { fejl: 'Could not save that note.' };
        return { tekst: `Saved “${svar.note.title}”.`, data: { note: { id: svar.note.id } } };
      },
    },
    {
      name: 'list_notebooks',
      scope: 'read',
      description: 'The notebooks, with how many notes are in each. Use a name with create_note.',
      inputSchema: { type: 'object', properties: {} },
      kald(a, ctx) {
        const b = srv.hentNotesboeger(ctx.userId);
        if (!b.length) return { tekst: 'No notebooks yet.', data: { notebooks: [] } };
        return {
          tekst: b.map((x) => `- ${x.name}${x.count ? ` (${x.count})` : ''}  (id: ${x.id})`).join('\n'),
          data: { notebooks: b },
        };
      },
    },
    {
      name: 'list_tags',
      scope: 'read',
      description: 'Every tag in the archive. Use one with tag: in search_notes.',
      inputSchema: { type: 'object', properties: {} },
      kald(a, ctx) {
        const t = srv.hentMaerker(ctx.userId);
        if (!t.length) return { tekst: 'No tags yet.', data: { tags: [] } };
        return { tekst: t.map((x) => `#${x.name}`).join(' '), data: { tags: t } };
      },
    },
    {
      name: 'add_comment',
      scope: 'write',
      description:
        'Leave a comment on a note. Comments are a conversation about the note, not part '
        + 'of it — use append_note if the text belongs in the note itself.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, body: { type: 'string' } },
        required: ['id', 'body'],
      },
      kald(a, ctx) {
        const n = srv.hentNote(ctx.userId, String(a.id || ''));
        if (!n) return { fejl: 'No note with that id.' };
        const svar = srv.opretKommentar({
          noteId: n.id, userId: ctx.userId, body: String(a.body || ''), origin: 'app',
        });
        if (svar.fejl) return { fejl: svar.fejl[1] };
        return { tekst: `Commented on “${n.title}”.`, data: { id: svar.id } };
      },
    },
    {
      name: 'publish_note',
      scope: 'write',
      description:
        'Put a note on the web so people without an account can read it — the page and '
        + 'everything under it. Returns the address. This is PUBLIC: say so before using it, '
        + 'and never publish something the user has not asked to share.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          slug: { type: 'string', description: 'A short web address, letters and hyphens. Optional.' },
        },
        required: ['id'],
      },
      kald(a, ctx) {
        const svar = srv.udgivNote(ctx.userId, String(a.id || ''), a.slug);
        // fejl er [status, kode, besked] - modellen skal have SAETNINGEN.
        if (svar.fejl) return { fejl: svar.fejl[2] };
        return {
          tekst: `Published at ${svar.url}\nAnyone with the link can read it. Revoke it in Sagu under Settings.`,
          data: { share: svar },
        };
      },
    },
  ];

  /* ---------------------------------------------------------- protokollen */

  const ok = (id, result) => (id === undefined || id === null ? null : { jsonrpc: '2.0', id, result });
  const fejl = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

  function behandl(besked, auth) {
    if (!besked || besked.jsonrpc !== '2.0' || typeof besked.method !== 'string') {
      return fejl(besked && besked.id, -32600, 'Invalid Request');
    }
    const { id, method, params } = besked;

    if (method === 'initialize') {
      const oensket = params && params.protocolVersion;
      return ok(id, {
        // Accepter klientens version, hvis vi kender den - ellers vores egen.
        protocolVersion: PROTOKOLLER.includes(oensket) ? oensket : PROTOKOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'sagu', title: srv.appName, version: String(srv.version()) },
        // Gratis kontekst til modellen. Forklar domaenet, og sig hvad den
        // ALDRIG maa (RUNE-ERFARINGER §9a).
        instructions:
          'Sagu is a personal note archive and wiki. Notes are markdown; notebooks hold '
          + 'pages, and pages can have subpages. Search before you write: never invent an '
          + 'id — read it from a search result. Prefer append_note over update_note when '
          + 'you are adding, because update_note replaces the whole body. Small things go '
          + 'in today\'s note (create_note with to="today"). publish_note puts a page on '
          + 'the OPEN web — ask first.',
      });
    }
    if (method === 'ping') return ok(id, {});
    // Notifikationer (uden id) besvares med 202 og TOM krop. Svarer man med
    // JSON, brokker klienten sig.
    if (method.startsWith('notifications/')) return null;

    if (method === 'tools/list') {
      // Vis kun det, noeglen maa. Saa foreslaar modellen ikke noget, der
      // alligevel giver et afslag - men listen er en HJAELP, ikke en
      // spaerring: `tools/call` tjekker igen.
      return ok(id, {
        tools: VAERKTOEJER.filter((v) => srv.maa(auth, v.scope)).map((v) => ({
          name: v.name, description: v.description, inputSchema: v.inputSchema,
        })),
      });
    }

    if (method === 'tools/call') {
      const navn = params && params.name;
      const v = VAERKTOEJER.find((x) => x.name === navn);
      if (!v) return fejl(id, -32602, `Unknown tool: ${navn}`);
      if (!srv.maa(auth, v.scope)) {
        return ok(id, {
          isError: true,
          content: [{
            type: 'text',
            text: `This access key is "${auth.scope}" and cannot ${v.scope}. `
              + 'Create a wider key in Sagu under Settings → Access keys.',
          }],
        });
      }
      let svar;
      try {
        svar = v.kald((params && params.arguments) || {}, { userId: auth.userId });
      } catch (err) {
        srv.logError(`mcp ${navn}: ${err && err.stack ? err.stack : err}`);
        return ok(id, {
          isError: true,
          content: [{ type: 'text', text: 'The tool failed. See the Sagu server log.' }],
        });
      }
      /*
       * En fejl i et VAERKTOEJ er ikke en protokolfejl.
       *
       * Den skal tilbage som et resultat med `isError`, saa modellen kan
       * laese den og rette op. Blander man de to, kan den ikke skelne »du
       * skrev et forkert id« fra »serveren er i stykker«.
       */
      if (svar.fejl) return ok(id, { isError: true, content: [{ type: 'text', text: svar.fejl }] });
      return ok(id, Object.assign(
        { content: [{ type: 'text', text: svar.tekst }] },
        svar.data ? { structuredContent: svar.data } : {},
      ));
    }

    return fejl(id, -32601, `Method not found: ${method}`);
  }

  /* ---------------------------------------------------------------- http */

  async function haandter(req, res) {
    // GET og DELETE hoerer til den serverstyrede SSE-stroem, som denne server
    // ikke tilbyder - alt besvares i selve POST-svaret.
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'method_not_allowed', message: 'Sagu answers MCP on POST only.' }));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

    /*
     * DNS-rebinding: en browser paa et fremmed site maa ikke kunne naa den
     * her. Kommer der ingen Origin (Claude Code, Claude Desktop), er der
     * intet at tjekke.
     */
    const origin = req.headers.origin;
    if (origin) {
      const vaert = req.headers['x-forwarded-host'] || req.headers.host || '';
      let god = false;
      try { god = new URL(origin).host === String(vaert).split(',')[0].trim(); } catch { god = false; }
      if (!god) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_origin', message: 'Origin not allowed.' }));
        return;
      }
    }

    const auth = srv.godkendMcp(req);
    if (!auth) {
      /*
       * **Hele indgangen er én header.**
       *
       * Uden `resource_metadata` kan claude.ai ikke opdage
       * autorisationsserveren og opgiver forbindelsen - uden at noget ser i
       * stykker ud (RUNE-ERFARINGER §9a, faelde 1).
       */
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': srv.oauthUdfordring(req),
      });
      res.end(JSON.stringify({
        error: 'invalid_key',
        message: 'Send a valid Sagu access key as "Authorization: Bearer sagu_…", or connect with OAuth.',
      }));
      return;
    }

    let krop;
    try {
      // tilladArray: JSON-RPC maa sende et bundt beskeder.
      krop = await srv.readJsonBody(req, true, true);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fejl(null, -32700, 'Parse error')));
      return;
    }

    const flere = Array.isArray(krop);
    const beskeder = flere ? krop : [krop];
    const svar = beskeder.map((b) => behandl(b, auth)).filter(Boolean);

    // Kun notifikationer i bundtet: kvitter uden krop, som protokollen kraever.
    if (!svar.length) { res.writeHead(202); res.end(); return; }

    const data = JSON.stringify(flere ? svar : svar[0]);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'MCP-Protocol-Version': PROTOKOL,
      'Content-Length': Buffer.byteLength(data),
    });
    res.end(data);
  }

  return { haandter, behandl, VAERKTOEJER };
}

module.exports = { opret, PROTOKOL };
