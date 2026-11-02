// Assinatura de widget Tizen (W3C Widget Digital Signature) sem Tizen Studio.
// Reproduz o formato gerado pelo Tizen: RSA-SHA512, digests SHA-512, SignedInfo em exc-c14n e Object #prop em c14n 1.1.
const crypto = require('node:crypto');
const forge = require('node-forge');

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const SIGNATURE_FILES = /^(author-signature\.xml|signature\d+\.xml)$/;
const wrap = b64 => b64.replace(/.{76}(?=.)/g, '$&\n');
const sha512 = data => crypto.createHash('sha512').update(data).digest('base64');

class CertificateError extends Error {}

// .p12 → { key: PEM, chain: [DER base64 do certificado do signatário, depois os intermediários] }
function loadP12(buffer, password) {
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(buffer.toString('binary')), false, password);
  } catch (error) {
    throw new CertificateError(/mac|password|decrypt|invalid/i.test(error.message) ? 'Senha do certificado incorreta.' : `Certificado inválido: ${error.message}`);
  }
  const bags = type => p12.getBags({ bagType: type })[type] || [];
  const keyBag = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)].find(b => b.key);
  if (!keyBag) throw new CertificateError('O arquivo .p12 não contém chave privada.');
  const certs = bags(forge.pki.oids.certBag).map(b => b.cert).filter(Boolean);
  const modulus = keyBag.key.n.toString(16);
  const leaf = certs.find(c => c.publicKey.n && c.publicKey.n.toString(16) === modulus);
  if (!leaf) throw new CertificateError('O certificado do .p12 não corresponde à chave privada.');
  // Cadeia: signatário → emissores presentes no .p12, sem a raiz autoassinada (a TV já a conhece)
  const chain = [leaf];
  for (let current = leaf; ;) {
    const issuer = certs.find(c => c !== current && !chain.includes(c) && c.subject.hash === current.issuer.hash);
    if (!issuer || issuer.isIssuer(issuer)) break;
    chain.push(issuer); current = issuer;
  }
  const der = cert => forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  return { key: forge.pki.privateKeyToPem(keyBag.key), chain: chain.map(der), subject: leaf.subject.getField('CN')?.value || '' };
}

function propObject(id, role) {
  return '<Object Id="prop"><SignatureProperties xmlns:dsp="http://www.w3.org/2009/xmldsig-properties">'
    + `<SignatureProperty Id="profile" Target="#${id}"><dsp:Profile URI="http://www.w3.org/ns/widgets-digsig#profile"></dsp:Profile></SignatureProperty>`
    + `<SignatureProperty Id="role" Target="#${id}"><dsp:Role URI="http://www.w3.org/ns/widgets-digsig#role-${role}"></dsp:Role></SignatureProperty>`
    + `<SignatureProperty Id="identifier" Target="#${id}"><dsp:Identifier></dsp:Identifier></SignatureProperty>`
    + '</SignatureProperties></Object>';
}

function reference(uri, digest, transform) {
  return `<Reference URI="${uri}">\n`
    + (transform ? `<Transforms>\n<Transform Algorithm="${transform}"></Transform>\n</Transforms>\n` : '')
    + '<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha512"></DigestMethod>\n'
    + `<DigestValue>${wrap(digest)}</DigestValue>\n</Reference>\n`;
}

// files: [{ name, data }] já sem assinaturas; role: 'author' | 'distributor'
function signatureXml(files, signer, id, role) {
  const object = propObject(id, role);
  const refs = [...files].sort((a, b) => (a.name < b.name ? -1 : 1)).map(f => reference(encodeURI(f.name), sha512(f.data))).join('');
  const signedInfo = '<SignedInfo>\n'
    + '<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>\n'
    + '<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha512"></SignatureMethod>\n'
    + refs
    + reference('#prop', sha512(object.replace('<Object Id="prop">', `<Object xmlns="${DSIG}" Id="prop">`)), 'http://www.w3.org/2006/12/xml-c14n11')
    + '</SignedInfo>';
  const canonical = signedInfo.replace('<SignedInfo>', `<SignedInfo xmlns="${DSIG}">`);
  const value = crypto.sign('sha512', Buffer.from(canonical, 'utf8'), signer.key).toString('base64');
  return `<Signature xmlns="${DSIG}" Id="${id}">\n${signedInfo}\n<SignatureValue>\n${wrap(value)}\n</SignatureValue>\n`
    + '<KeyInfo>\n<X509Data>\n' + signer.chain.map(c => `<X509Certificate>\n${wrap(c)}\n</X509Certificate>\n`).join('') + '</X509Data>\n</KeyInfo>\n'
    + `${object}\n</Signature>`;
}

// Devolve os arquivos do widget com author-signature.xml e signature1.xml
function signWidget(files, author, distributor) {
  const content = files.filter(f => !SIGNATURE_FILES.test(f.name));
  const authorFile = { name: 'author-signature.xml', data: Buffer.from(signatureXml(content, author, 'AuthorSignature', 'author'), 'utf8') };
  const distributorFile = { name: 'signature1.xml', data: Buffer.from(signatureXml([...content, authorFile], distributor, 'DistributorSignature', 'distributor'), 'utf8') };
  return [...content, authorFile, distributorFile].sort((a, b) => (a.name < b.name ? -1 : 1));
}

module.exports = { loadP12, signWidget, signatureXml, CertificateError };
