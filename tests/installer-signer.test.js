const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const forge = require('node-forge');
const { loadP12, signWidget, CertificateError } = require('../installer/signer');
const { createZip, crc32 } = require('../installer/zip');
const { receiverFiles, appIds } = require('../installer/package');

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

// CA de teste → certificado do signatário, empacotados num .p12 com senha (como os da Samsung)
function makeP12(cn, password) {
  const make = (subject, issuer, keys, signKey, ca) => {
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = String(Math.floor(Math.random() * 1e9));
    cert.validity.notBefore = new Date(Date.now() - 864e5); cert.validity.notAfter = new Date(Date.now() + 864e5 * 365);
    cert.setSubject([{ name: 'commonName', value: subject }]); cert.setIssuer([{ name: 'commonName', value: issuer }]);
    cert.setExtensions([{ name: 'basicConstraints', cA: ca }]);
    cert.sign(signKey, forge.md.sha256.create());
    return cert;
  };
  // Raiz (autoassinada) → intermediária → signatário, como Tizen Root → Samsung VD Author CA → autor
  const rootKeys = forge.pki.rsa.generateKeyPair(1024), caKeys = forge.pki.rsa.generateKeyPair(1024), keys = forge.pki.rsa.generateKeyPair(1024);
  const root = make(`${cn} Root`, `${cn} Root`, rootKeys, rootKeys.privateKey, true);
  const ca = make(`${cn} CA`, `${cn} Root`, caKeys, rootKeys.privateKey, true);
  const leaf = make(cn, `${cn} CA`, keys, caKeys.privateKey, false);
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [leaf, ca, root], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

// Mesma verificação usada para validar o .wgt gerado pelo Tizen Studio
function verify(files, name) {
  const xml = files.find(f => f.name === name).data.toString('utf8');
  for (const m of xml.matchAll(/<Reference URI="([^#"][^"]*)">[\s\S]*?<DigestValue>([^<]*)<\/DigestValue>/g)) {
    const data = files.find(f => f.name === decodeURI(m[1])).data;
    assert.equal(crypto.createHash('sha512').update(data).digest('base64'), m[2].replace(/\s/g, ''), `digest de ${m[1]}`);
  }
  const object = xml.match(/<Object Id="prop">[\s\S]*?<\/Object>/)[0].replace('<Object Id="prop">', `<Object xmlns="${DSIG}" Id="prop">`);
  const propDigest = xml.match(/<Reference URI="#prop">[\s\S]*?<DigestValue>([^<]*)<\/DigestValue>/)[1].replace(/\s/g, '');
  assert.equal(crypto.createHash('sha512').update(object).digest('base64'), propDigest, '#prop');
  const signedInfo = xml.match(/<SignedInfo>[\s\S]*?<\/SignedInfo>/)[0].replace('<SignedInfo>', `<SignedInfo xmlns="${DSIG}">`);
  const value = Buffer.from(xml.match(/<SignatureValue>([^<]*)<\/SignatureValue>/)[1].replace(/\s/g, ''), 'base64');
  const certs = [...xml.matchAll(/<X509Certificate>([^<]*)<\/X509Certificate>/g)].map(m => new crypto.X509Certificate(Buffer.from(m[1].replace(/\s/g, ''), 'base64')));
  assert.ok(crypto.verify('sha512', Buffer.from(signedInfo), certs[0].publicKey, value), 'assinatura RSA-SHA512');
  return { xml, certs };
}

test('assina o receptor como o Tizen: autor + distribuidor, cadeia e referências', () => {
  const author = loadP12(makeP12('Autor Teste', 'segredo'), 'segredo');
  const distributor = loadP12(makeP12('Distribuidor Teste', 'outra'), 'outra');
  assert.equal(author.subject, 'Autor Teste');
  assert.equal(author.chain.length, 2); // signatário + intermediária; a raiz autoassinada fica de fora

  const files = receiverFiles('http://10.0.0.5:8787');
  assert.match(files.find(f => f.name === 'index.html').data.toString(), /data-server="http:\/\/10\.0\.0\.5:8787"/);
  const signed = signWidget([...files, { name: 'signature1.xml', data: Buffer.from('velha') }], author, distributor);
  assert.deepEqual(signed.map(f => f.name), [...files.map(f => f.name), 'author-signature.xml', 'signature1.xml'].sort());

  const a = verify(signed, 'author-signature.xml');
  assert.doesNotMatch(a.xml, /URI="author-signature\.xml"/);
  assert.match(a.xml, /role-author/);
  assert.deepEqual(a.certs.map(c => c.subject), ['CN=Autor Teste', 'CN=Autor Teste CA']);
  const d = verify(signed, 'signature1.xml');
  assert.match(d.xml, /URI="author-signature\.xml"/);
  assert.match(d.xml, /Id="DistributorSignature"[\s\S]*role-distributor/);
  assert.deepEqual(appIds(), { packageId: 'SalaTV0001', appId: 'SalaTV0001.Sala' });
});

test('senha errada e .p12 inválido viram mensagens claras', () => {
  const p12 = makeP12('Autor', 'certa');
  assert.throws(() => loadP12(p12, 'errada'), CertificateError);
  assert.throws(() => loadP12(Buffer.from('não é p12'), 'x'), CertificateError);
});

test('zip: arquivos legíveis com CRC correto', () => {
  const entries = [{ name: 'a.txt', data: Buffer.from('olá TV') }, { name: 'dir/b.bin', data: crypto.randomBytes(5000) }];
  const zip = createZip(entries);
  let offset = 0;
  for (const entry of entries) {
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    const nameLength = zip.readUInt16LE(offset + 26), size = zip.readUInt32LE(offset + 18);
    assert.equal(zip.toString('utf8', offset + 30, offset + 30 + nameLength), entry.name);
    const data = zlib.inflateRawSync(zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size));
    assert.deepEqual(data, entry.data);
    assert.equal(zip.readUInt32LE(offset + 14), crc32(entry.data));
    offset += 30 + nameLength + size;
  }
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
