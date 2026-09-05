#!/usr/bin/env python3
"""Bygger runes/sagu.yaml ud fra kilderne i app/.

    python3 build_rune.py            # byg
    python3 build_rune.py --budget   # byg + leave-one-out: hvad KOSTER hver fil?

Trin:
  1. Tegn ikonet (palet-PNG, ingen PIL - se tegn_ikon).
  2. Saml app/shared/*.js + app/parts/p*.js -> app/public/app.js, `node --check`.
  3. Stempl ?v=<APP_VERSION> ind i index.html (Cloudflare edge-cacher .js/.css
     i timevis og ignorerer no-cache - RUNE-ERFARINGER §5).
  4. Pak app-filerne som tar, strip kommentarer fra KOPIEN, brotli, base85.
  5. Verificer rundturen med PRAECIS den dekoder, der udgives.
  6. Tjek at payloaden indeholder alt, koden require'r.
  7. Skriv og valider runens YAML - og at install og update pakker DET SAMME.

runes/sagu.yaml, app/public/app.js og app/public/icon-192.png er GENEREREDE
artefakter. Redigér dem aldrig i haanden.
"""

import io
import os
import re
import struct
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import zlib

import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, 'app')
PARTS = os.path.join(APP, 'parts')
PUBLIC = os.path.join(APP, 'public')
SHARED = os.path.join(APP, 'shared')
OUT = os.path.join(ROOT, 'runes', 'sagu.yaml')

# Install-scriptet koeres som ET sh -c-argument -> Linux' MAX_ARG_STRLEN
# (131072 b) er loftet. Margenen skal kun daekke panelets
# {{VARIABEL}}-udskiftninger, og de er faa og korte.
#
# Sagu er projektets stoerste app, og pladsen er dens FOERSTE reelle
# begraensning - ikke dens sidste. Se DESIGN.md, maaling 1, for budgettet og
# de maalte udveje.
MAX_INSTALL = 126_000
MAX_YAML = 512 * 1024

# ------------------------------------------------ hvor app-koden kommer fra
#
# Indtil 2026-08-21 BAR install-scriptet hele appen som brotli+base85. Efter
# F6 laa den paa 111.352 af 126.000 tegn (88,4 %), og DESIGN.md maaling 1
# regnede i F0 ud, at F7-F13 ikke kan vaere der. Udvejen - maalt dengang, ikke
# gaettet - er et install-script, der HENTER app-koden i stedet for at baere
# den. Det er konstant stort, uanset hvor stor appen bliver (tools v1).
#
# Payloaden bygges STADIG ved hver koersel, og det er ikke spild:
#   - rundturs-tjekket beviser, at kilderne kan pakkes og pakkes ud igen,
#   - --budget svarer stadig paa "hvad fylder hvad",
#   - tallet staar i loggen, saa §8's vane (rapportér payloaden) holder,
#   - og saet HENT_FRA_GITHUB = False, saa er den indlejrede rune tilbage.
#     Det er den eneste vej, der virker uden net ved installationen.
HENT_FRA_GITHUB = True
GITHUB_EJER = 'andreasdinesen'
GITHUB_REPO = 'sagu'

# ------------------------------------------------ to tal, ikke ét
#
# Indtil v46 var app-koden og runen ét tal. Runen bar ikke koden - den hentede
# den fra taggen vN - men taggen stod i install-scriptet, saa en ny app-udgave
# KRAEVEDE en ny rune. Andreas skulle derfor gennem panelets to trin (hent
# runen igen, saa Opdater) ved hver eneste udgivelse for at flytte ét tal i en
# YAML.
#
# Fra v47 henter `app/kilde.js` koden ved hver opstart, og **en genstart ER
# opdateringen**. Runen er blevet en STARTSNOR: den skal kun udgives, naar
# selve runen aendrer sig (variabler, startup, porte, watchers, wipe).
#
# Derfor to tal:
#   APP_VERSION (i app/parts/p1_core.js) - koden. Bumpes ved hver udgivelse.
#   RUNE_VERSION (her)                   - runen. Bumpes KUN naar YAML'en
#                                          herunder aendrer sig.
#
# Bumpes RUNE_VERSION alligevel ved hver udgivelse, er vi tilbage ved to trin i
# panelet, og hele pointen er tabt.
#
# RUNE_VERSION er ogsaa den tag, install-scriptet henter FOERSTE gang. Den
# behoever ikke vaere den nyeste: foerste opstart henter alligevel det, der
# staar i KODE_VERSION. Den skal bare vaere en udgave, der KAN starte - og
# taggen SKAL vaere pushet, ellers kan runen ikke installeres forfra.
RUNE_VERSION = 49


def tarball_url(version):
    """Runens version N hoerer sammen med taggen vN - ikke med en gren.

    Peger scriptet paa `refs/heads/main`, installerer en gammel rune det, main
    tilfaeldigvis indeholder i dag. Med en tag installerer rune vN praecis vN's
    kode, ogsaa om et aar. Prisen er ét trin mere ved udgivelse:
    `git tag vN && git push --tags` - og glemmer man det, siger install-scriptet
    det HOEJT i stedet for at installere noget andet.
    """
    return (f'https://codeload.github.com/{GITHUB_EJER}/{GITHUB_REPO}'
            f'/tar.gz/refs/tags/v{version}')

HEREDOC = 'YGG_PAYLOAD_EOF'
FORBUDT_MOENSTER = re.compile(r'\{\{[A-Z_]{2,}\}\}')

# base85 uden { } og \ - saa kan payloaden aldrig ligne panelets
# {{VARIABEL}}-skabeloner (RUNE-ERFARINGER §2).
ALFABET = [c for c in range(33, 127) if c not in (123, 125, 92)][:85]


def fejl(besked):
    print(f'FEJL: {besked}', file=sys.stderr)
    sys.exit(1)


def node(*args, stdin=None):
    res = subprocess.run(['node', *args], input=stdin, capture_output=True)
    if res.returncode != 0:
        fejl(f'node fejlede: {res.stderr.decode("utf8", "replace")[:2000]}')
    return res.stdout


# ------------------------------------------------------------------- 1. ikon

def tegn_ikon():
    """Et 192x192 PNG med farvetype 3 (palet) og to farver.

    PNG komprimeres IKKE af brotli og koster derfor over 125 % af sin egen
    vaegt i install-scriptet (RUNE-ERFARINGER, doda F6 + F17). En truecolor-PNG
    paa 2,2 KB kostede doda 2.817 tegn. Et fladt tofarvet maerke behoever ikke
    et billedbibliotek: ~40 linjer zlib + struct skriver filen direkte, og
    build'et beholder sine nul afhaengigheder ud over PyYAML (tovo F0).
    """
    n = 192
    bg = (0xB0, 0x7D, 0x14)      # --accent
    fg = (0xFF, 0xF7, 0xEA)

    # Maerket er en side med et ombukket hjoerne - samme figur som logo-ikonet
    # i frontenden, bare i pixels.
    def taend(x, y):
        # Sidens omrids
        v, h, o, u = 52, 140, 34, 158
        hjoerne = 34                      # ombukningens stoerrelse
        if not (v <= x < h and o <= y < u):
            return False
        kant = 7
        paa_kant = (x < v + kant or x >= h - kant or y < o + kant or y >= u - kant)
        # Det ombukkede hjoerne oeverst til hoejre skaeres af
        if (x - (h - hjoerne)) + ((o + hjoerne) - y) > hjoerne:
            # Selve foldelinjen tegnes med
            return abs((x - (h - hjoerne)) + ((o + hjoerne) - y) - hjoerne) < kant \
                and y < o + hjoerne
        if paa_kant:
            return True
        # Tre tekstlinjer
        for ly in (78, 100, 122):
            if ly <= y < ly + 9 and v + 18 <= x < (h - 18 if ly != 122 else h - 46):
                return True
        return False

    raa = bytearray()
    for y in range(n):
        raa.append(0)                     # filter 0 pr. raekke
        raekke = bytearray()
        bit = 0
        byte = 0
        for x in range(n):
            byte = (byte << 1) | (1 if taend(x, y) else 0)
            bit += 1
            if bit == 8:
                raekke.append(byte)
                bit = 0
                byte = 0
        if bit:
            raekke.append(byte << (8 - bit))
        raa.extend(raekke)

    def chunk(art, data):
        return (struct.pack('>I', len(data)) + art + data
                + struct.pack('>I', zlib.crc32(art + data) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 1, 3, 0, 0, 0))
           + chunk(b'PLTE', bytes(bg) + bytes(fg))
           + chunk(b'IDAT', zlib.compress(bytes(raa), 9))
           + chunk(b'IEND', b''))

    sti = os.path.join(PUBLIC, 'icon-192.png')
    with open(sti, 'wb') as fh:
        fh.write(png)
    print(f'  ikon: {len(png):,} b (palet-PNG, 1 bit pr. pixel)')


# --------------------------------------------------------------- 2. frontend

def saml_frontend():
    navne = sorted(f for f in os.listdir(PARTS) if f.endswith('.js'))
    if not navne:
        fejl('ingen dele i app/parts/')
    stykker = []

    # De delte moduler FOERST. De er UMD-pakkede, saa serveren kan require dem
    # og browseren faar dem paa window - ÉN parser, to koersteder.
    #
    # Listen samles ALFABETISK, saa et delt modul, der bruger et andet, skal
    # komme efter det i alfabetet. Det staar her, fordi det ellers virker ved
    # held indtil nogen doeber en fil om (RUNE-ERFARINGER, tovo F1).
    delte = sorted(f for f in os.listdir(SHARED) if f.endswith('.js')) if os.path.isdir(SHARED) else []
    for navn in delte:
        with open(os.path.join(SHARED, navn), encoding='utf8') as fh:
            stykker.append(f'/* ---- shared/{navn} ---- */\n{fh.read()}')

    for navn in navne:
        with open(os.path.join(PARTS, navn), encoding='utf8') as fh:
            stykker.append(f'/* ---- {navn} ---- */\n{fh.read()}')
    samlet = '\n'.join(stykker)

    sti = os.path.join(PUBLIC, 'app.js')
    with open(sti, 'w', encoding='utf8') as fh:
        fh.write(samlet)

    # Ingen bundler fanger syntaksfejl for os.
    res = subprocess.run(['node', '--check', sti], capture_output=True)
    if res.returncode != 0:
        fejl('app.js har en syntaksfejl:\n' + res.stderr.decode('utf8', 'replace'))

    m = re.search(r'^const APP_VERSION = (\d+);', samlet, re.M)
    if not m:
        fejl('APP_VERSION mangler i app/parts/ (forventet: const APP_VERSION = N;)')
    print(f'  frontend: {len(delte)} delte + {len(navne)} dele, {len(samlet):,} tegn')
    return int(m.group(1))


def stempl_version(version):
    """Cache-bust. Resultatet SKAL skrives tilbage til disk - payloaden laeser
    filerne fra disk igen, og ellers pakkes den gamle HTML."""
    sti = os.path.join(PUBLIC, 'index.html')
    with open(sti, encoding='utf8') as fh:
        html = fh.read()
    ny = re.sub(r'(style\.css|app\.js)(\?v=\d+)?', rf'\1?v={version}', html)
    if ny != html:
        with open(sti, 'w', encoding='utf8') as fh:
            fh.write(ny)
    if f'app.js?v={version}' not in ny:
        fejl('kunne ikke stemple versionen i index.html')

    # ... og service workeren SKAL foelge med.
    #
    # Bumpes cachenavnet ikke, hober hver udgivelse sig op i browserens cache,
    # og workeren kan servere en gammel app.js i det uendelige. Det ramte doda
    # i drift (v39). Derfor stemples de to fra SAMME tal, i samme funktion -
    # to steder at huske er ét for meget.
    sw_sti = os.path.join(PUBLIC, 'sw.js')
    with open(sw_sti, encoding='utf8') as fh:
        sw = fh.read()
    sw_ny = re.sub(r'^const VERSION = \d+;', f'const VERSION = {version};', sw, flags=re.M)
    if sw_ny != sw:
        with open(sw_sti, 'w', encoding='utf8') as fh:
            fh.write(sw_ny)
    if f'const VERSION = {version};' not in sw_ny:
        fejl('kunne ikke stemple versionen i sw.js - staar linjen der stadig?')
    print(f'  index.html og sw.js stemplet med v={version}')


# ------------------------------------------------------------------ 3. payload

def indsaml_filer():
    """Payloadens fil-liste maa ALDRIG vaere haandholdt.

    Beanledger udgav to versioner, der slet ikke kunne installeres, fordi to
    nye server-moduler manglede i en manuel FILES-liste: containeren stoppede
    paa "Cannot find module". Fejlen var usynlig lokalt, fordi preview koerer
    fra repo-mappen, hvor filerne ligger (RUNE-ERFARINGER, Beanledger v30).
    Derfor: glob mapperne, og udled kravet af koden (se tjek_requires).
    """
    filer = [(f'app/{n}', os.path.join(APP, n))
             for n in sorted(os.listdir(APP)) if n.endswith('.js')]
    if os.path.isdir(SHARED):
        for navn in sorted(os.listdir(SHARED)):
            if navn.endswith('.js'):
                filer.append((f'app/shared/{navn}', os.path.join(SHARED, navn)))
    for navn in sorted(os.listdir(PUBLIC)):
        sti = os.path.join(PUBLIC, navn)
        if os.path.isfile(sti) and not navn.startswith('.'):
            filer.append((f'app/public/{navn}', sti))
    return filer


def tjek_requires(filer):
    """Udled kravet fra KODEN, ikke fra en liste.

    En verifikation, der kun bekraefter det, du allerede har skrevet ned,
    fanger tilfoejelser - aldrig udeladelser. Beviset for spaerren tager 30
    sekunder: fjern en mappe fra globben ovenfor og se build'et faelde.
    """
    har = {navn for navn, _ in filer}
    mangler = []
    for arkivnavn, sti in filer:
        if not arkivnavn.endswith('.js') or arkivnavn.startswith('app/public/'):
            continue
        with open(sti, encoding='utf8') as fh:
            kode = fh.read()
        mappe = os.path.dirname(arkivnavn)
        for rel in re.findall(r"require\(\s*['\"](\./[^'\"]+)['\"]\s*\)", kode):
            maal = os.path.normpath(os.path.join(mappe, rel))
            if not maal.endswith('.js'):
                maal += '.js'
            if maal not in har:
                mangler.append(f'{arkivnavn} -> {maal}')
    if mangler:
        fejl('disse require-filer mangler i payloaden: ' + ', '.join(mangler))
    print(f'  require-spaerre: {len(har)} filer, alle require\'s daekket')


def tjek_git(filer):
    """I hente-tilstand er det, GITHUB har, det der bliver installeret.

    Den nye fejlmulighed er ikke en manglende fil i en liste, men en fil, der
    ikke er committet: `app/public/app.js` og ikonet er GENERERET, og ligger de
    ikke i repoet, stopper containeren paa "Cannot find module" - Beanledger
    v30's fejl flyttet ét sted hen. Spoerg derfor git, ikke .gitignore.
    """
    if not os.path.isdir(os.path.join(ROOT, '.git')):
        print('  git: intet repo endnu - hentningen virker foerst, naar app/ '
              'er pushet OG tagget')
        return
    res = subprocess.run(['git', '-C', ROOT, 'ls-files', '-z'], capture_output=True)
    if res.returncode != 0:
        fejl('git ls-files fejlede: ' + res.stderr.decode('utf8', 'replace')[:400])
    sporet = set(res.stdout.decode('utf8').split('\0'))
    mangler = [navn for navn, _ in filer if navn not in sporet]
    if mangler:
        fejl('disse filer er ikke i git og ville mangle efter en hentning: '
             + ', '.join(mangler))
    beskidt = subprocess.run(['git', '-C', ROOT, 'status', '--porcelain', '--', 'app'],
                             capture_output=True).stdout.decode('utf8').strip()
    if beskidt:
        # Ikke en fejl: build koeres FOER commit. Men det er den eneste
        # paamindelse, der findes, om at en udgivelse nu er tre trin.
        print(f'  git: {len(beskidt.splitlines())} aendrede filer i app/ - '
              'husk commit + `git tag v<N>` + `git push --tags`')
    else:
        print('  git: app/ er committet')


def tjek_kilder(filer):
    for arkivnavn, sti in filer:
        if not sti.endswith(('.js', '.html', '.css', '.webmanifest')):
            continue
        with open(sti, encoding='utf8') as fh:
            indhold = fh.read()
        if HEREDOC in indhold:
            fejl(f'{arkivnavn} indeholder heredoc-markoeren {HEREDOC}')
        fund = FORBUDT_MOENSTER.search(indhold)
        if fund:
            fejl(f'{arkivnavn} indeholder {fund.group(0)} - yggdrasil templater '
                 'den vaek i install-scriptet. Omskriv.')


def tjek_syntaks(navn, kode):
    """node --check paa INDHOLD, ikke paa en sti."""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf8') as fh:
        fh.write(kode)
        midl = fh.name
    try:
        res = subprocess.run(['node', '--check', midl], capture_output=True)
        if res.returncode != 0:
            fejl(f'{navn} har en syntaksfejl EFTER kommentar-strip:\n'
                 + res.stderr.decode('utf8', 'replace'))
    finally:
        os.unlink(midl)


def strip_kommentarer(kode):
    """Fjerner kommentarer fra den UDGIVNE kopi. Kilderne roeres aldrig.

    §2 i erfaringsfilen kalder kommentar-strip "den risikable vej med den
    mindste gevinst" - det var Kokkeris tal (0,8 %). doda maalte 24 % paa den
    samme metode, fordi doda skriver begrundelser i koden. Sagu goer det
    samme, saa tallet maales her og staar i DESIGN.md.

    To regler goer den sikker:

    1. Kun linjer, der er HELT kommentar eller tomme, fjernes. En linje med
       kode paa roeres aldrig, saa hverken en streng eller en regex-literal
       kan beskadiges. Den ene farlige kant - `/* kort */ kode();` - beholdes
       med vilje.
    2. Hver fjernet linje efterlades TOM, saa linjetallet holder og en
       stak-sporing fra containeren peger paa samme linje i repoet. Tomme
       linjer komprimerer til naesten ingenting.
    """
    ud, i_blok = [], False
    for linje in kode.split('\n'):
        s = linje.strip()
        fjern = False
        if i_blok:
            if '*/' in s:
                i_blok = False
            fjern = True
        elif s.startswith('/*'):
            if '*/' not in s:
                i_blok = True
            elif s.split('*/', 1)[1].strip():
                # Kode efter en kort blok-kommentar: behold linjen frem for
                # at aede koden.
                ud.append(linje)
                continue
            fjern = True
        elif s.startswith('//') or not s:
            fjern = True
        ud.append('' if fjern else linje)
    return '\n'.join(ud)


def byg_tar(filer, udelad=None):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tar:
        for arkivnavn, sti in filer:
            if udelad and arkivnavn == udelad:
                continue
            info = tarfile.TarInfo(arkivnavn)
            data = open(sti, 'rb').read()
            if arkivnavn.endswith('.js'):
                tekst = data.decode('utf8')
                renset = strip_kommentarer(tekst)
                if renset.count('\n') != tekst.count('\n'):
                    fejl(f'{arkivnavn}: strip aendrede linjetallet - stak-sporinger '
                         'ville ikke laengere passe med kilden')
                # Tjek DEN FIL, DER UDGIVES - ikke kilden den kom fra.
                tjek_syntaks(arkivnavn, renset)
                data = renset.encode('utf8')
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def brotli(raw):
    """Python har ikke brotli i stdlib - Node har. Og install-imaget ER node."""
    return node('-e', 'process.stdout.write(require("zlib").brotliCompressSync('
                      'require("fs").readFileSync(0),{params:{[require("zlib")'
                      '.constants.BROTLI_PARAM_QUALITY]:11}}))', stdin=raw)


def b85(raw):
    ud = []
    for i in range(0, len(raw) - len(raw) % 4, 4):
        v = int.from_bytes(raw[i:i + 4], 'big')
        blok = []
        for _ in range(5):
            blok.append(ALFABET[v % 85])
            v //= 85
        ud.extend(reversed(blok))
    rest = len(raw) % 4
    if rest:
        # NULpadning her, mens dekoderen padder cifrene med 84 (max). De to
        # runder hver sin vej, saa de betydende bytes overlever. Padder man
        # begge steder opad, loeber overskuddet op i den sidste rigtige byte -
        # og brotli dekomprimerer villigt til noget, der kun afviger i halen
        # (RUNE-ERFARINGER, doda).
        v = int.from_bytes(raw[-rest:] + b'\x00' * (4 - rest), 'big')
        blok = []
        for _ in range(5):
            blok.append(ALFABET[v % 85])
            v //= 85
        ud.extend(list(reversed(blok))[:rest + 1])
    return ''.join(chr(c) for c in ud)


# Dekoderen staar i en 'single quoted' sh-streng -> den maa IKKE indeholde '.
# Derfor bygges alfabetet af tegnkoder, ikke som streng-literal.
DEKODER = (
    'const A=[];for(let c=33;c<127;c++)if(c!==123&&c!==125&&c!==92)A.push(c);'
    'const M=new Int16Array(128).fill(-1);for(let i=0;i<85;i++)M[A[i]]=i;'
    'const s=require("fs").readFileSync(0,"utf8").replace(/\\s+/g,"");'
    'const h=s.length/5|0,r=s.length%5,o=Buffer.alloc(h*4+(r?r-1:0));let q=0;'
    'for(let i=0;i<h;i++){let v=0;for(let j=0;j<5;j++)v=v*85+M[s.charCodeAt(q++)];'
    'o.writeUInt32BE(v>>>0,i*4);}'
    'if(r){let v=0;for(let j=0;j<5;j++)v=v*85+(j<r?M[s.charCodeAt(q+j)]:84);'
    'const b=Buffer.alloc(4);b.writeUInt32BE(v>>>0);b.copy(o,h*4,0,r-1);}'
    'process.stdout.write(require("zlib").brotliDecompressSync(o));'
)


# Hentningen staar ligesom dekoderen i en 'single quoted' sh-streng -> den maa
# IKKE indeholde '. Node bruges frem for wget af to grunde: Node ER
# install-imaget og altsaa garanteret til stede, mens busybox' wget og dens
# TLS er ubevist - og zlib i Node pakker gzip'en ud, saa `tar` kun skal kunne
# det, den allerede goer i dag (`tar x`). Ingen -z, ingen --strip-components,
# ingen wildcards: hver ekstra tar-funktion er en antagelse mere om busybox.
def henter(version):
    url = tarball_url(version)
    return (
        'const https=require("https"),zlib=require("zlib");'
        f'const U="{url}";'
        'function d(m){console.error("[fejl] "+m);console.error("Adresse: "+U);'
        'console.error("GitHub svarer 404 BAADE naar adressen ikke findes OG naar '
        'der ikke er adgang - tjek at taggen er pushet, og at repoet er offentligt.");'
        'process.exit(1);}'
        'function hent(u,n){https.get(u,{headers:{"user-agent":"sagu-installer"}},(r)=>{'
        'if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){'
        'if(n<=0)return d("for mange omdirigeringer");r.resume();'
        'return hent(new URL(r.headers.location,u).toString(),n-1);}'
        'if(r.statusCode!==200)return d("GitHub svarede "+r.statusCode);'
        'const g=zlib.createGunzip();'
        'g.on("error",(e)=>d("arkivet kunne ikke pakkes ud: "+e.message));'
        'r.pipe(g).pipe(process.stdout);'
        '}).on("error",(e)=>d("kunne ikke naa GitHub: "+e.message));}'
        'hent(U,3);'
    )


def verificer(kodet, forventet):
    """Koer PRAECIS den dekoder, der udgives - saa beviser testen, at dekoderen
    virker, ikke bare at Python kan regne baglaens."""
    if "'" in DEKODER:
        fejl("dekoderen indeholder ' og kan ikke staa i en sh-streng")
    faktisk = node('-e', DEKODER, stdin=kodet.encode('ascii'))
    if faktisk != forventet:
        fejl(f'rundturen fejlede: {len(faktisk)} b ud, {len(forventet)} b ind')
    print(f'  rundtur ok: {len(forventet):,} b tar -> {len(kodet):,} tegn base85')


def budget(filer, payload):
    """Leave-one-out: hvad KOSTER hver fil i install-scriptet?

    Raa filstoerrelse siger naesten intet. Et delt UMD-modul, der ogsaa ligger
    inde i app.js, koster naesten nul, fordi brotli genkender dubletten - og en
    PNG koster MERE end sin egen stoerrelse, fordi den ikke komprimeres og
    derefter skal kodes i base85 (RUNE-ERFARINGER, doda).
    """
    print('\nLeave-one-out - hvad koster hver fil i tegn:')
    fuld = len(payload)
    raekker = []
    for arkivnavn, sti in filer:
        uden = len(b85(brotli(byg_tar(filer, udelad=arkivnavn))))
        raekker.append((fuld - uden, os.path.getsize(sti), arkivnavn))
    raekker.sort(reverse=True)
    for pris, raa, navn in raekker:
        forhold = f'{pris / raa * 100:.0f} %' if raa else '-'
        print(f'  {pris:>8,} tegn  ({forhold:>6} af {raa:,} b raa)  {navn}')

    # Hvad koster kommentarerne? Maal det, i stedet for at tro paa et andet
    # projekts procent.
    global strip_kommentarer
    aegte = strip_kommentarer
    strip_kommentarer = lambda k: k                    # noqa: E731
    try:
        ustrippet = len(b85(brotli(byg_tar(filer))))
    finally:
        strip_kommentarer = aegte
    print(f'\n  kommentar-strip sparer: {ustrippet - fuld:,} tegn '
          f'({(ustrippet - fuld) / ustrippet * 100:.1f} % af {ustrippet:,})')


# --------------------------------------------------------------------- 4. yaml

def hent_krop(version):
    """De linjer, install og update har TILFAELLES, naar koden hentes.

    ── Hvad der gik galt 2026-09-04 ─────────────────────────────────────────

    Den foerste udgave af de her linjer pakkede ud i `/tmp/sagu-hent` og gjorde
    saa `rm -rf app` efterfulgt af `mv`. Tre fejl paa tre linjer, og de ramte
    alle sammen samme dag:

      1. **Fast temp-sti.** To tryk paa »Opdater Sagu« otte sekunder fra
         hinanden delte mappen: den ene kunne rydde den, mens den anden pakkede
         ud i den.
      2. **`rm -rf app` foer `mv`.** Et vindue helt uden `app/` - og dermed uden
         `kilde.js` til at redde sig selv.
      3. **`mv` fra `/tmp` er en KOPI over to filsystemer**, og en kopi kan
         afbrydes paa midten. Et `rename` inden for samme filsystem kan ikke.

    Det er praecis de tre, `kilde.js` blev bygget udenom (§35) - og de stod
    stadig i det script, knappen faktisk koerer. Nu goer begge det samme:

      - der pakkes ud VED SIDEN AF `app/`, i datamappen, ikke i `/tmp`,
      - den gamle app flyttes til `.sagu-gammel` frem for at blive slettet, saa
        `startup`s redning kan saette den tilbage, hvis vi doer imellem,
      - og der byttes med to `rename`, aldrig en kopi.

    At den gamle app flyttes VAEK som en helhed loeser ogsaa det, `rm -rf app`
    var der for: filer, der er slettet i en ny version, bliver ikke liggende
    (RUNE-ERFARINGER, Beanledger v30). Der pakkes aldrig ud oven i den levende
    `app/`.

    Datamappen selv roeres ikke - kun `app/` og de tre `.sagu-*`-arbejdsmapper.
    """
    return (
        'echo "Henter app-koden fra GitHub ..."\n'
        '\n'
        '# Der pakkes ud VED SIDEN AF app/, ikke i /tmp: et bytte skal kunne\n'
        '# ske med to rename inden for samme filsystem.\n'
        'rm -rf .sagu-ny .sagu-gammel\n'
        'mkdir -p .sagu-ny\n'
        f"node -e '{henter(version)}' > .sagu-ny/app.tar\n"
        'tar x -C .sagu-ny -f .sagu-ny/app.tar\n'
        'rm -f .sagu-ny/app.tar\n'
        '\n'
        '# Mappenavnet i et GitHub-arkiv er <repo>-<ref uden v>, og arkivet\n'
        '# begynder med en pax_global_header-post. Ingen af delene gaettes:\n'
        '# find den app-mappe, der FINDES (RUNE-ERFARINGER, Sagu F5).\n'
        'NY=$(find .sagu-ny -maxdepth 2 -type d -name app | head -n 1)\n'
        'if [ -z "$NY" ] || [ ! -f "$NY/server.js" ]; then\n'
        '  echo "[fejl] arkivet fra GitHub indeholder ingen app/server.js"\n'
        '  exit 1\n'
        'fi\n'
        '\n'
        '# To omdoebninger, ingen kopi. Doer vi mellem dem, ligger den gamle\n'
        '# app under .sagu-gammel, og startup-kommandoen saetter den tilbage.\n'
        'if [ -d app ]; then mv app .sagu-gammel; fi\n'
        'mv "$NY" app\n'
        'rm -rf .sagu-ny .sagu-gammel\n'
    )


def install_script(version, payload):
    if HENT_FRA_GITHUB:
        return (
            'set -eu\n'
            f'echo "Installerer Sagu (startsnor v{version}) ..."\n'
            'echo "Node: $(node --version)"\n'
            '\n'
            + hent_krop(version)
            + '\n'
            'echo "Filer udpakket:"\n'
            'ls -1 app app/public\n'
            'echo "Klar. Start serveren i panelet - den henter selv nyeste"\n'
            'echo "udgave (eller den, KODE_VERSION laaser til), foer den starter."\n'
        )
    linjer = textwrap.wrap(payload, 100)
    return (
        'set -eu\n'
        f'echo "Installerer Sagu v{version} ..."\n'
        'echo "Node: $(node --version)"\n'
        '\n'
        '# App-filerne ligger som brotli-komprimeret tar i base85 - se build_rune.py\n'
        f"node -e '{DEKODER}' <<'{HEREDOC}' | tar x\n"
        + '\n'.join(linjer) + '\n'
        f'{HEREDOC}\n'
        '\n'
        'echo "Filer udpakket:"\n'
        'ls -1 app app/public\n'
        'echo "Klar. Start serveren i panelet."\n'
    )


def opdater_script(version, payload):
    """update:-blokken - en selvstaendig "Opdatér app"-knap i panelet.

    `rm -rf app` FOERST: tar overskriver, men fjerner ikke filer, der er
    slettet i en ny version, saa de ville blive liggende for evigt. Datamappen
    ligger uden for app/ og roeres ikke - det er hele pointen med knappen.
    """
    if HENT_FRA_GITHUB:
        # Knappen maa ALDRIG hente startsnorens tag, naar appen allerede er
        # laengere fremme: v47 oven i v60 er en NEDGRADERING, som ingen bad om.
        # Findes app/kilde.js, er den facit - den kender KODE_VERSION og henter
        # praecis den udgave, serveren ville hente ved en genstart. Startsnoren
        # er kun redningen, hvis app/ er vaek eller er fra foer v47.
        return (
            'set -eu\n'
            'echo "Opdaterer Sagu ..."\n'
            'echo "Node: $(node --version)"\n'
            '\n'
            # Laasen. Andreas trykkede paa knappen to gange med otte sekunders
            # mellemrum 2026-09-04, og de to koersler traadte i hinandens
            # arbejdsmapper. `mkdir` er atomisk paa alle filsystemer; `[ -d ]`
            # efterfulgt af `mkdir` er ikke - der er et hul imellem dem.
            #
            # Laasen daekker BEGGE grene med vilje: fra v47 og frem er
            # kilde.js-grenen den almindelige, og to samtidige kilde.js ville
            # kunne bytte app/ ud under hinanden.
            'if ! mkdir .sagu-laas 2>/dev/null; then\n'
            '  echo "[fejl] en anden opdatering er allerede i gang."\n'
            '  echo "Vent til den er faerdig, eller genstart Sagu og proev igen."\n'
            '  exit 1\n'
            'fi\n'
            # Laasen skal vaek, ogsaa naar noget faelder undervejs - ellers er
            # knappen doed for altid. Bliver containeren draebt haardt, naar
            # trap'en ikke at koere; DEN vej ryddes af startup-kommandoen.
            "trap 'rm -rf .sagu-laas .sagu-ny' EXIT INT TERM\n"
            '\n'
            'if [ -f app/kilde.js ]; then\n'
            # Panelet templater {{...}} ind i scriptets TEKST, og variablerne
            # findes OGSAA som env i containeren. Hvilken af de to der gaelder
            # her, er UBEVIST - saa vi proever skabelonen og falder tilbage til
            # env, hvis den staar utemplateret. Ellers kunne en laasning gaa
            # tabt paa en antagelse.
            '  K="{{KODE_VERSION}}"\n'
            '  case "$K" in\n'
            "    '') : ;;\n"
            '    seneste|latest|[0-9]*) : ;;\n'
            '    *) K="${KODE_VERSION:-}" ;;\n'
            '  esac\n'
            '  echo "Oensket udgave: ${K:-nyeste}"\n'
            '  KODE_VERSION="$K" node app/kilde.js\n'
            'else\n'
            + textwrap.indent(hent_krop(version), '  ')
            + 'fi\n'
            '\n'
            '\n'
            # Panelet stopper appen FOER opdateringen og starter den bagefter
            # - maalt to steder 2026-09-04: server_crashes har en post kl.
            # 22:28:34 med "[sagu] lukker ned" og exit_code 0 (samme sekund som
            # app-update), og containerens StartedAt er 22:28:40, altsaa seks
            # sekunder efter. Panelet koerer stop -> skift -> start.
            #
            # Min foerste laesning var, at knappen IKKE genstartede - sluttet
            # ud af, at der ikke stod en separat restart-anmodning i loggen.
            # Det var aldrig et bevis: en genstart INDE i jobbet giver ingen
            # HTTP-anmodning. Beskeden er derfor formuleret, saa den er sand
            # begge veje - den lover ikke noget om panelet, og den efterlader
            # heller ikke nogen i troen paa, at ny kode koerer af sig selv.
            'echo "App-filerne er skiftet ud. Databasen i /data er uroert."\n'
            'echo "Panelet genstarter Sagu bagefter. Sker det ikke, saa genstart"\n'
            'echo "selv - serveren koerer den gamle kode, til den er genstartet."\n'
        )
    linjer = textwrap.wrap(payload, 100)
    return (
        'set -eu\n'
        f'echo "Opdaterer Sagu til v{version} ..."\n'
        'echo "Node: $(node --version)"\n'
        'rm -rf app\n'
        f"node -e '{DEKODER}' <<'{HEREDOC}' | tar x\n"
        + '\n'.join(linjer) + '\n'
        f'{HEREDOC}\n'
        '\n'
        'echo "App-filerne er skiftet ud. Databasen i /data er uroert."\n'
        'echo "Skemaet opdateres automatisk, naar serveren starter."\n'
    )


def byg_yaml(version, rune_version, payload):
    rune = {'gameskill': {
        'id': 'sagu',
        'name': 'Sagu',
        'category': 'Apps',
        'description': (
            'Noteapp og wiki. Notesboeger med undersider i vilkaarlig dybde, hybrid '
            'live-markdown-editor, fuldtekstsoegning i titler, overskrifter, broedtekst, '
            'maerker og egenskaber, og udgivelse af en side eller et helt undertrae som '
            'offentlig wiki med valgfrit kodeord og kommentarer. Import fra Notion, '
            'API til iOS Shortcuts, MCP-server. Flere brugere med egne noter. '
            'Egen SQLite-database, ingen eksterne afhaengigheder.'
        ),
        'author': 'andreas',
        'version': rune_version,
        'icon': 'app',

        # Node-versionen er et FELT i panelet, ikke en konstant i koden: findes
        # der en CVE i Node, kan den lukkes uden en kodeaendring. Flydende tag
        # som standard, saa en geninstallation henter seneste patch.
        'docker': {'image': '{{NODE_IMAGE}}'},

        'variables': [
            {'key': 'APP_NAME', 'name': 'Appens navn', 'type': 'string', 'default': 'Sagu'},
            {'key': 'NODE_IMAGE', 'name': 'Node-image', 'type': 'string',
             'default': 'node:24-alpine',
             'pattern': r'^node:[0-9][A-Za-z0-9._-]*$',
             'hint': 'Skal vaere et node:-image, fx node:24-alpine. Soegningen kraever '
                     'FTS5, som findes i Node 22 og nyere.'},

            # Laasen. Det er den, der goer runen overfloedig i hverdagen - og
            # samtidig hele vejen tilbage: saet 46, genstart, og serveren
            # koerer v46 igen.
            #
            # TOM = nyeste. Standarden for »goer det normale« skal vaere
            # INGENTING: et felt, der SKAL udfyldes for at opfoere sig
            # almindeligt, laeser man som en indstilling, nogen har taget - og
            # saa spekulerer man paa, hvad »seneste« mon daekker over. Ordene
            # godtages stadig, saa en server, der har dem staaende, ikke
            # pludselig faar en advarsel.
            #
            # `?` i moensteret er noedvendigt: uden det kan den tomme standard
            # ikke gemmes i panelet. Og moensteret afviser »v47« og »47.1«
            # allerede dér, frem for at lade kilde.js tolke noget, brugeren
            # ikke skrev.
            {'key': 'KODE_VERSION', 'name': 'Kodeversion', 'type': 'string',
             'default': '',
             'pattern': r'^([0-9]+|seneste|latest)?$',
             'hint': 'Tom = hent nyeste udgivelse fra GitHub ved hver genstart. '
                     'Et tal (fx 46) laaser til praecis den udgave.'},
        ],
        # Der staar ikke et GITHUB_TOKEN her. Repoet er offentligt, saa
        # hentningen kraever ingen godkendelse - og et felt, der ikke goer
        # noget, er et sted at lede efter en fejl, der ikke er der.

        # Begge scripts henter STARTSNOREN, ikke den nyeste app-udgave: runen
        # kender kun sin egen version. Resten klarer kilde.js.
        'install': {'image': '{{NODE_IMAGE}}',
                    'script': install_script(rune_version, payload)},
        'update': {'image': '{{NODE_IMAGE}}', 'label': 'Opdater Sagu',
                   'script': opdater_script(rune_version, payload)},

        'startup': {
            # Opstarten ER opdateringen (F28). Tre trin, i den raekkefoelge:
            #
            #  1. Redningen. kilde.js bytter app/ ud med to omdoebninger, og
            #     doer containeren imellem dem, ligger den gamle app under
            #     .sagu-gammel. Uden det her trin ville et daarligt sekund
            #     efterlade en container helt uden app/ - og saa er der heller
            #     ingen kilde.js til at hente en ny. Det er den eneste rigtigt
            #     farlige brik; alt andet herinde maa fejle.
            #  2. Hentningen. Fejler den, siger den det og gaar videre - den
            #     kode, der ligger, er stadig en koerende Sagu. Derfor `|| echo`
            #     og ikke `set -e`.
            #  3. Serveren, som foer.
            'command': ('if [ ! -f app/server.js ] && [ -f .sagu-gammel/server.js ]; then\n'
                        '  rm -rf app\n'
                        '  mv .sagu-gammel app\n'
                        '  echo "[kode] app/ sat tilbage efter en afbrudt udskiftning"\n'
                        'fi\n'
                        # En laas, der overlever et haardt drab, ville goere
                        # »Opdater Sagu« doed for altid. En container, der
                        # STARTER, er den bedste lejlighed til at rydde den:
                        # prisen er, at en opdatering, der koerer praecis nu i
                        # sin egen container, mister sin laas - og den pris er
                        # mindre end en knap, der aldrig virker igen.
                        'if [ -d .sagu-laas ]; then\n'
                        '  rm -rf .sagu-laas .sagu-ny\n'
                        '  echo "[kode] en strandet opdateringslaas er ryddet"\n'
                        'fi\n'
                        'node app/kilde.js || echo "[kode] advarsel: opdateringen kunne ikke koeres"\n'
                        'if node -e "require(\'node:sqlite\')" >/dev/null 2>&1; then\n'
                        '  exec node app/server.js\n'
                        'else\n'
                        '  exec node --experimental-sqlite app/server.js\n'
                        'fi\n'),
            'done_regex': 'sagu lytter',
            'stop_timeout': 30,
        },

        'ports': [{'name': 'web', 'default': 3000, 'protocol': 'tcp'}],

        'watchers': [
            {'name': 'Serverfejl i Sagu', 'pattern': r'\[fejl\]',
             'threshold': 5, 'window_secs': 300},
        ],

        # Ruller op pr. IP i panelets sikkerhedshistorik. Watcheren notificerer,
        # events: giver historikken - to forskellige formaal.
        'events': [
            {'key': 'sagu_login_fejl', 'label': 'Mislykket login i Sagu',
             'match': r'\[sikkerhed\] login-fejl ip=(\S+)'},
            {'key': 'sagu_login_spaerret', 'label': 'Login spaerret af rate-limit',
             'match': r'\[sikkerhed\] login-spaerret ip=(\S+)'},
            {'key': 'sagu_noegle_afvist', 'label': 'Ugyldig adgangsnoegle',
             'match': r'\[sikkerhed\] noegle-afvist ip=(\S+)'},
        ],

        'backup': {'include': []},
        # files/ og uploads/ skal med i wipe - ellers efterlader en nulstilling
        # alle vedhaeftninger som foraeldreloese filer, der aldrig ryddes op.
        # backup.include: [] daekker hele datamappen, saa filerne ER med der.
        'wipe': {'paths': ['sagu.db', 'sagu.db-wal', 'sagu.db-shm', 'files', 'uploads'],
                 'backup_first': True},
    }}

    tekst = yaml.safe_dump(rune, allow_unicode=True, sort_keys=False, width=120)
    # Valider at det, vi skrev, kan laeses igen - OG at install og update
    # pakker det SAMME. En update, der pakker noget andet ud end
    # installationen, opdages ellers foerst, naar en bruger trykker paa
    # knappen (RUNE-ERFARINGER, doda/Kokkeri v26).
    genlaest = yaml.safe_load(tekst)['gameskill']
    if genlaest['install']['script'] != rune['gameskill']['install']['script']:
        fejl('install-scriptet overlevede ikke en YAML-rundtur')
    if genlaest['update']['script'] != rune['gameskill']['update']['script']:
        fejl('update-scriptet overlevede ikke en YAML-rundtur')

    def payload_af(script):
        # Heredoc-linjen slutter paa "| tar x", ikke paa markoeren - saa
        # udtraekket skal begynde efter DEN linje, ikke efter markoeren.
        m = re.search(rf"<<'{HEREDOC}'[^\n]*\n(.*?)\n{HEREDOC}\n", script, re.S)
        if not m:
            fejl('kunne ikke finde payloaden i det genlaeste script')
        return m.group(1).replace('\n', '')

    def kilde_af(script):
        """Samme spoergsmaal som payload_af, bare i hente-tilstand: henter de to
        scripts DET SAMME? En update, der henter en anden version end
        installationen, opdages ellers foerst, naar en bruger trykker paa
        knappen (RUNE-ERFARINGER, Kokkeri v26)."""
        fund = re.findall(r'https://codeload\.github\.com/\S+?"', script)
        if len(fund) != 1:
            fejl(f'scriptet henter fra {len(fund)} adresser - der skal vaere praecis én')
        return fund[0]

    if HENT_FRA_GITHUB:
        forventet = tarball_url(rune_version) + '"'
        for navn in ('install', 'update'):
            if kilde_af(genlaest[navn]['script']) != forventet:
                fejl(f'{navn}-scriptet henter ikke fra {tarball_url(rune_version)}')
        for navn in ('install', 'update'):
            # Den gamle regel var »scriptet skal indeholde rm -rf app«: tar
            # overskriver, men fjerner ikke filer, der er slettet i en ny
            # version (RUNE-ERFARINGER, Beanledger v30). Fra rune v48 flyttes
            # den gamle app i stedet VAEK som en helhed, hvilket loeser det
            # samme og desuden efterlader en vej tilbage. Reglen er derfor
            # skiftet ud, ikke slettet - og den er blevet skarpere: der maa
            # ALDRIG pakkes ud oven i den levende app/.
            skript = genlaest[navn]['script']
            if 'mv "$NY" app' not in skript:
                fejl(f'{navn}-scriptet bytter ikke app/ ind med et rename')
            if 'mv app .sagu-gammel' not in skript:
                fejl(f'{navn}-scriptet flytter ikke den gamle app vaek - '
                     'slettede filer ville blive liggende, og der ville ikke '
                     'vaere nogen vej tilbage')
            if 'tar x -C app' in skript or '-C app/' in skript:
                fejl(f'{navn}-scriptet pakker ud OVEN I den levende app/')
            if '/tmp/' in skript:
                fejl(f'{navn}-scriptet bruger /tmp - et mv derfra er en kopi '
                     'over to filsystemer, og en kopi kan afbrydes paa midten')
            if HEREDOC in skript:
                fejl(f'{navn}-scriptet baerer stadig en payload')
    elif payload_af(genlaest['install']['script']) != payload_af(genlaest['update']['script']):
        fejl('install og update pakker IKKE den samme payload')
    # Laasen om HELE update-scriptet: to tryk paa knappen maa ikke kunne
    # overlappe. Maalt 2026-09-04: to app-update otte sekunder fra hinanden.
    if HENT_FRA_GITHUB:
        u = genlaest['update']['script']
        if 'mkdir .sagu-laas' not in u:
            fejl('update-scriptet tager ingen laas - to tryk paa knappen kan overlappe')
        if u.index('mkdir .sagu-laas') > u.index('if [ -f app/kilde.js ]'):
            fejl('laasen skal tages FOER begge grene, ikke inde i den ene')
        if 'trap ' not in u:
            fejl('update-scriptet frigiver ikke laasen, naar noget faelder')

    # Assertér, at update ikke ROERER datamappen. Kun de HANDLENDE linjer
    # tjekkes: en echo-linje maa gerne naevne /data ("Databasen i /data er
    # uroert"), og en assertion, der ikke kan skelne, ville tvinge beskeden
    # vaek - og saa mister brugeren netop den oplysning, knappen handler om.
    for linje in genlaest['update']['script'].split('\n'):
        s = linje.strip()
        if not s or s.startswith('#') or s.startswith('echo ') or s == HEREDOC:
            continue
        for farlig in ('/data', 'sagu.db', 'files', 'uploads'):
            if farlig in s:
                fejl(f'update-scriptet roerer {farlig} i linjen: {s[:80]}')
    return tekst


# ---------------------------------------------------------------------- main

def main():
    vil_budget = '--budget' in sys.argv
    print('Bygger Sagu-runen ...')
    tegn_ikon()
    version = saml_frontend()
    stempl_version(version)

    filer = indsaml_filer()
    tjek_kilder(filer)
    tjek_requires(filer)
    if HENT_FRA_GITHUB:
        tjek_git(filer)

    raw = byg_tar(filer)
    komprimeret = brotli(raw)
    payload = b85(komprimeret)
    verificer(payload, raw)

    install = install_script(RUNE_VERSION, payload)
    tekst = byg_yaml(version, RUNE_VERSION, payload)
    if len(tekst.encode('utf8')) > MAX_YAML:
        fejl(f'YAML er {len(tekst.encode("utf8")):,} b - panelets loft er {MAX_YAML:,}')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf8') as fh:
        fh.write(tekst)

    pct = len(install) * 100 / MAX_INSTALL
    print(f'  install-script: {len(install):,} / {MAX_INSTALL:,} tegn ({pct:.1f} %)')
    if HENT_FRA_GITHUB:
        # Payloaden er ikke i scriptet laengere, men tallet bliver ved med at
        # betyde noget: det er maalet paa, hvor stor appen er blevet, og det er
        # det tal, §8's vane handler om. Rapportér det, ogsaa naar det ikke
        # laengere kan faelde build'et.
        print(f'  startsnoren henter fra: {tarball_url(RUNE_VERSION)}')
        print(f'  (indlejret ville payloaden vaere {len(payload):,} tegn '
              f'= {len(payload) * 100 / MAX_INSTALL:.1f} % af loftet)')
    print(f'\nOK  runes/sagu.yaml  (rune v{RUNE_VERSION}, '
          f'{len(tekst.encode("utf8")):,} b)')
    print(f'    App-koden er v{version} - serveren henter den selv ved opstart.')

    # Hvilket af de to tal, der skal videre, er ikke en detalje. Sig det.
    if RUNE_VERSION == version:
        print('    Runen er AENDRET og skal udgives i panelet.')
    elif RUNE_VERSION < version:
        print('    Runen er UAENDRET og behoever ikke udgives: commit + '
              f'`git tag v{version}` + `git push --tags` er nok.')
    else:
        print(f'    OBS: runen peger paa v{RUNE_VERSION}, og app-koden staar paa '
              f'v{version}.')
        print('    Startsnorens tag findes altsaa ikke endnu - bump APP_VERSION til '
              f'{RUNE_VERSION} ved udgivelsen, ellers kan runen ikke installeres forfra.')

    if vil_budget:
        budget(filer, payload)

    # Loftet tjekkes TIL SIDST, saa --budget stadig kan koere og vise HVOR
    # pladsen gik, den dag build'et faelder.
    if len(install) > MAX_INSTALL:
        fejl(f'install-scriptet er {len(install):,} tegn - loftet er {MAX_INSTALL:,} '
             '(Linux MAX_ARG_STRLEN er 131072). Koer med --budget for at se hvad der fylder.')


if __name__ == '__main__':
    main()
