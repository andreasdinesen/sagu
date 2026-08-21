'use strict';
/*
 * Sagu - ZIP-laeser. Ingen pakker; `node:zlib` kan det, der skal til.
 *
 * En Notion-eksport er hundredvis af MB. Filen ligger allerede paa DISK
 * (streaming-upload, DESIGN.md maaling 4), og den maa ikke laeses ind i
 * hukommelsen for at blive pakket ud. Derfor:
 *
 *   1. Det centrale katalog staar til SIDST i en zip. Vi laeser de sidste
 *      ~64 KB, finder `End of Central Directory`, og laeser saa katalogets
 *      egne bytes - typisk nogle faa hundrede KB, uanset arkivets stoerrelse.
 *   2. Hver post laeses for sig med en POSITIONERET laesning
 *      (`fs.readSync` med offset). Hukommelsen er én post ad gangen.
 *
 * Der er ingen streaming-inflate pr. post: en enkelt fil i en note-eksport er
 * smaa MB, og `inflateRawSync` paa én post er baade enklere og hurtigere end
 * en stroem. Loftet pr. post er derfor eksplicit - se `MAX_POST`.
 */

const fs = require('node:fs');
const zlib = require('node:zlib');

const EOCD = 0x06054b50;          // End of central directory
const EOCD64 = 0x06064b50;        // ... zip64
const EOCD64_LOC = 0x07064b50;
const CEN = 0x02014b50;           // Central directory header
const LOC = 0x04034b50;           // Local file header

// En enkelt post pakkes ud i hukommelsen. Notions stoerste fil i Andreas'
// eksport er en PDF paa 19,4 MB; 128 MB er rigeligt og stadig et loft.
const MAX_POST = 128 * 1024 * 1024;

/**
 * Zip-bomber: 64 MB arkiv, der pakkes ud til 66 GB, er en normal form paa et
 * angreb (Verdandes spec). Loftet gaelder BAADE den samlede udpakkede
 * stoerrelse og antallet af poster - én kaempe fil og ti tusind smaa er to
 * angreb med samme slutning.
 */
const MAX_UDPAKKET = 4 * 1024 * 1024 * 1024;
const MAX_POSTER = 20000;

function laes(fd, laengde, position) {
  const buf = Buffer.alloc(laengde);
  let laest = 0;
  while (laest < laengde) {
    const n = fs.readSync(fd, buf, laest, laengde - laest, position + laest);
    if (!n) break;
    laest += n;
  }
  return laest === laengde ? buf : buf.subarray(0, laest);
}

/** Finder det centrale katalog og laeser posternes metadata. */
function aabn(sti) {
  const fd = fs.openSync(sti, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const halelaengde = Math.min(stat.size, 66 * 1024);
    const hale = laes(fd, halelaengde, stat.size - halelaengde);

    let eocd = -1;
    for (let i = hale.length - 22; i >= 0; i--) {
      if (hale.readUInt32LE(i) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw Object.assign(new Error('That is not a zip file.'), { status: 400 });

    let antal = hale.readUInt16LE(eocd + 10);
    let katStoerrelse = hale.readUInt32LE(eocd + 12);
    let katOffset = hale.readUInt32LE(eocd + 16);

    // Zip64: en eksport paa over 4 GB, eller med over 65.535 poster, skriver
    // de rigtige tal i en ekstra blok. Uden det her ville en stor eksport
    // fejle med "kunne ikke laese katalog" og ligne en oedelagt fil.
    if (antal === 0xffff || katOffset === 0xffffffff || katStoerrelse === 0xffffffff) {
      let loc = -1;
      for (let i = eocd - 20; i >= 0; i--) {
        if (hale.readUInt32LE(i) === EOCD64_LOC) { loc = i; break; }
      }
      if (loc < 0) throw Object.assign(new Error('The zip file needs zip64 but has no locator.'), { status: 400 });
      const z64Offset = Number(hale.readBigUInt64LE(loc + 8));
      const z64 = laes(fd, 56, z64Offset);
      if (z64.readUInt32LE(0) !== EOCD64) {
        throw Object.assign(new Error('The zip64 record is broken.'), { status: 400 });
      }
      antal = Number(z64.readBigUInt64LE(32));
      katStoerrelse = Number(z64.readBigUInt64LE(40));
      katOffset = Number(z64.readBigUInt64LE(48));
    }

    if (antal > MAX_POSTER) {
      throw Object.assign(new Error(`The archive has ${antal} entries — the limit is ${MAX_POSTER}.`),
        { status: 413 });
    }

    const kat = laes(fd, katStoerrelse, katOffset);
    const poster = [];
    let p = 0;
    let samlet = 0;
    for (let i = 0; i < antal && p + 46 <= kat.length; i++) {
      if (kat.readUInt32LE(p) !== CEN) break;
      const metode = kat.readUInt16LE(p + 10);
      const komprimeret = kat.readUInt32LE(p + 20);
      const udpakket = kat.readUInt32LE(p + 24);
      const navnLen = kat.readUInt16LE(p + 28);
      const ekstraLen = kat.readUInt16LE(p + 30);
      const kommentarLen = kat.readUInt16LE(p + 32);
      const flag = kat.readUInt16LE(p + 8);
      let lokalOffset = kat.readUInt32LE(p + 42);
      const raaNavn = kat.subarray(p + 46, p + 46 + navnLen);

      // Bit 11 = navnet er UTF-8. Notion saetter den; aeldre vaerktoejer
      // bruger CP437, men et notearkiv med aeoea ville alligevel vaere
      // ulaeseligt i CP437, saa UTF-8 er det rigtige gaet.
      const navn = raaNavn.toString('utf8');

      let ægteUdpakket = udpakket;
      let ægteKomprimeret = komprimeret;
      if (udpakket === 0xffffffff || komprimeret === 0xffffffff || lokalOffset === 0xffffffff) {
        // Zip64-ekstrafeltet (0x0001) baerer de rigtige tal.
        const ekstra = kat.subarray(p + 46 + navnLen, p + 46 + navnLen + ekstraLen);
        let e = 0;
        while (e + 4 <= ekstra.length) {
          const id = ekstra.readUInt16LE(e);
          const len = ekstra.readUInt16LE(e + 2);
          if (id === 0x0001) {
            let q = e + 4;
            if (udpakket === 0xffffffff) { ægteUdpakket = Number(ekstra.readBigUInt64LE(q)); q += 8; }
            if (komprimeret === 0xffffffff) { ægteKomprimeret = Number(ekstra.readBigUInt64LE(q)); q += 8; }
            if (lokalOffset === 0xffffffff) { lokalOffset = Number(ekstra.readBigUInt64LE(q)); }
            break;
          }
          e += 4 + len;
        }
      }

      samlet += ægteUdpakket;
      if (samlet > MAX_UDPAKKET) {
        throw Object.assign(
          new Error('The archive unpacks to more than 4 GB. That is far larger than a note export.'),
          { status: 413 });
      }

      // En mappe-post har ingen krop. Vi bruger dem ikke - stierne staar i
      // filernes egne navne.
      if (!navn.endsWith('/')) {
        poster.push({
          navn,
          metode,
          komprimeret: ægteKomprimeret,
          udpakket: ægteUdpakket,
          lokalOffset,
          krypteret: !!(flag & 1),
        });
      }
      p += 46 + navnLen + ekstraLen + kommentarLen;
    }
    return { fd, poster, samlet };
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}

/**
 * Pakker ÉN post ud.
 *
 * Den lokale header skal laeses igen: dens `navnLen`/`ekstraLen` kan afvige
 * fra katalogets, og datastarten ligger efter dem. At regne den ud af
 * katalogets tal alene giver en forskudt laesning i nogle arkiver.
 */
function udpak(zip, post) {
  if (post.krypteret) {
    throw Object.assign(new Error(`"${post.navn}" is encrypted and cannot be read.`), { status: 400 });
  }
  if (post.udpakket > MAX_POST) {
    throw Object.assign(
      new Error(`"${post.navn}" unpacks to ${Math.round(post.udpakket / 1024 / 1024)} MB — too large.`),
      { status: 413 });
  }
  const hoved = laes(zip.fd, 30, post.lokalOffset);
  if (hoved.readUInt32LE(0) !== LOC) {
    throw Object.assign(new Error(`The entry "${post.navn}" is broken.`), { status: 400 });
  }
  const start = post.lokalOffset + 30 + hoved.readUInt16LE(26) + hoved.readUInt16LE(28);
  const raa = laes(zip.fd, post.komprimeret, start);

  if (post.metode === 0) return raa;                  // "stored"
  if (post.metode === 8) return zlib.inflateRawSync(raa, { maxOutputLength: MAX_POST });
  throw Object.assign(new Error(`"${post.navn}" uses an unsupported compression method.`), { status: 400 });
}

function luk(zip) {
  try { fs.closeSync(zip.fd); } catch { /* allerede lukket */ }
}

module.exports = { aabn, udpak, luk, MAX_UDPAKKET, MAX_POSTER, MAX_POST };

/* ======================================================== at SKRIVE en zip */

/*
 * En zip maa gemme filer med metode 0 ("stored"), saa der skal ikke
 * komprimeres - kun beregnes CRC32. Det er en tabel og tolv linjer
 * (RUNE-ERFARINGER, tovo v7).
 *
 * Men en markdown-eksport er tekst, og tekst komprimerer 3-5 gange. `deflate`
 * er ét kald til zlib, saa vi bruger den for teksten og "stored" for det, der
 * allerede ER komprimeret (billeder, PDF'er) - dér ville deflate koste tid
 * uden at spare en byte.
 */
let CRC_TABEL = null;

function crc32(buf) {
  if (!CRC_TABEL) {
    CRC_TABEL = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABEL[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABEL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Allerede komprimeret? Saa er deflate spildt arbejde. */
const IKKE_KOMPRIMERBAR = /\.(png|jpe?g|gif|webp|avif|heic|zip|gz|pdf|mp[34]|mov|woff2?)$/i;

/**
 * Bygger en zip i hukommelsen.
 *
 * En eksport af hele arkivet med filer kan vaere hundredvis af MB, og det er
 * for meget at samle. Derfor har `skrivZip` et LOFT og en fejl, der peger paa
 * den rigtige vej - panelets backup, som allerede daekker /data
 * (RUNE-ERFARINGER, doda F9).
 */
function skrivZip(poster, maxBytes) {
  const loft = maxBytes || 400 * 1024 * 1024;
  const dele = [];
  const kat = [];
  let offset = 0;

  for (const p of poster) {
    const navn = Buffer.from(p.navn, 'utf8');
    const raa = Buffer.isBuffer(p.data) ? p.data : Buffer.from(String(p.data), 'utf8');
    const komprimer = !IKKE_KOMPRIMERBAR.test(p.navn) && raa.length > 256;
    const krop = komprimer ? zlib.deflateRawSync(raa, { level: 6 }) : raa;
    const metode = komprimer ? 8 : 0;
    const crc = crc32(raa);

    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(LOC, 0);
    lokal.writeUInt16LE(20, 4);           // version
    lokal.writeUInt16LE(0x0800, 6);       // bit 11: navnet er UTF-8
    lokal.writeUInt16LE(metode, 8);
    lokal.writeUInt16LE(0, 10);           // tid
    lokal.writeUInt16LE(0x21, 12);        // dato (1. januar 2000)
    lokal.writeUInt32LE(crc, 14);
    lokal.writeUInt32LE(krop.length, 18);
    lokal.writeUInt32LE(raa.length, 22);
    lokal.writeUInt16LE(navn.length, 26);
    lokal.writeUInt16LE(0, 28);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(CEN, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(metode, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(krop.length, 20);
    cen.writeUInt32LE(raa.length, 24);
    cen.writeUInt16LE(navn.length, 28);
    cen.writeUInt32LE(offset, 42);

    dele.push(lokal, navn, krop);
    kat.push(Buffer.concat([cen, navn]));
    offset += lokal.length + navn.length + krop.length;
    if (offset > loft) {
      throw Object.assign(
        new Error('The export is larger than the limit. Use the panel backup — it already covers /data.'),
        { status: 413 });
    }
  }

  const katBuf = Buffer.concat(kat);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(poster.length, 8);
  eocd.writeUInt16LE(poster.length, 10);
  eocd.writeUInt32LE(katBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...dele, katBuf, eocd]);
}

module.exports.skrivZip = skrivZip;
module.exports.crc32 = crc32;
