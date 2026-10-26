"""app/webpush.py: P-256 ECDSA (a published test vector, round trips, openssl in both directions when it is installed),
the VAPID JWT, and the empty push request (its HTTP function replaced, nothing leaves this machine)."""
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest

from helpers import REPO, load_module

W = load_module('lsj_webpush', os.path.join(REPO, 'app', 'webpush.py'))

# RFC 6979 A.2.5: ECDSA, 256 bits (prime field), SHA-256, message "sample"
X = 0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721
UX = 0x60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6
UY = 0x7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299
K = 0xA6E3C57DD01ABE90086538398355DD4C3B17AA873382B0F24D6129493D8AAD60
R = 0xEFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716
S = 0xF7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8

SPKI_P256 = bytes.fromhex('3059301306072a8648ce3d020106082a8648ce3d030107034200')  # SubjectPublicKeyInfo up to the point
OPENSSL = shutil.which('openssl')


def der_int(x):
    b = x.to_bytes(32, 'big').lstrip(b'\0') or b'\0'
    if b[0] & 0x80:
        b = b'\0' + b
    return b'\x02' + bytes([len(b)]) + b


def to_der(sig):
    """r ‖ s → the DER ECDSA-Sig-Value openssl reads."""
    body = der_int(int.from_bytes(sig[:32], 'big')) + der_int(int.from_bytes(sig[32:], 'big'))
    return b'\x30' + bytes([len(body)]) + body


def from_der(der):
    assert der[0] == 0x30 and der[1] == len(der) - 2
    out, i = [], 2
    for _ in range(2):
        assert der[i] == 0x02
        n = der[i + 1]
        out.append(int.from_bytes(der[i + 2:i + 2 + n], 'big'))
        i += 2 + n
    return out[0].to_bytes(32, 'big') + out[1].to_bytes(32, 'big')


def pem_public(point):
    b64 = base64.b64encode(SPKI_P256 + W.encode_point(point)).decode()
    return '-----BEGIN PUBLIC KEY-----\n' + '\n'.join(b64[i:i + 64] for i in range(0, len(b64), 64)) + '\n-----END PUBLIC KEY-----\n'


class Curve(unittest.TestCase):
    def test_published_vector(self):
        self.assertEqual(W.public_key(X), (UX, UY))
        self.assertEqual(W.sign_with_k(X, b'sample', K), (R, S))
        self.assertTrue(W.verify((UX, UY), b'sample', R.to_bytes(32, 'big') + S.to_bytes(32, 'big')))

    def test_generator_and_order(self):
        self.assertTrue(W.on_curve(W.G))
        self.assertIsNone(W.mul(W.N))                       # n·G is the point at infinity
        self.assertEqual(W.mul(W.N + 1), W.G)
        self.assertEqual(W.mul(2), W._affine(W._add((*W.G, 1), (*W.G, 1))))

    def test_sign_and_verify(self):
        d = W.new_private_key()
        pub = W.public_key(d)
        sig = W.sign(d, b'hello')
        self.assertEqual(len(sig), 64)
        self.assertTrue(W.verify(pub, b'hello', sig))
        self.assertNotEqual(W.sign(d, b'hello'), sig)        # a fresh nonce every time
        self.assertFalse(W.verify(pub, b'hellp', sig))
        self.assertFalse(W.verify(pub, b'hello', sig[:-1] + bytes([sig[-1] ^ 1])))
        self.assertFalse(W.verify(W.public_key(W.new_private_key()), b'hello', sig))
        self.assertFalse(W.verify(pub, b'hello', bytes(64)))  # r = s = 0
        self.assertFalse(W.verify(pub, b'hello', sig[:63]))

    def test_points_and_keys(self):
        keys = W.new_keys()
        raw = W.unb64u(keys['public'])
        self.assertEqual((len(raw), raw[0], len(keys['public'])), (65, 4, 87))
        self.assertEqual(W.encode_point(W.public_key(W.private_from_b64(keys['private']))), raw)
        self.assertEqual(W.decode_point(raw), W.public_key(W.private_from_b64(keys['private'])))
        bad = raw[:-1] + bytes([raw[-1] ^ 1])
        for junk in (bad, raw[1:], b'\x02' + raw[1:]):
            with self.assertRaises(ValueError):
                W.decode_point(junk)
        for text in ('', 'a', 'ab$c', None):
            with self.assertRaises(ValueError):
                W.unb64u(text)
        with self.assertRaises(ValueError):
            W.private_from_b64(W.b64u(W.N.to_bytes(32, 'big')))


@unittest.skipUnless(OPENSSL, 'openssl is not installed')
class OpenSSL(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='lsj-p256-')
        self.msg = os.path.join(self.dir, 'msg')
        with open(self.msg, 'wb') as f:
            f.write(b'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL2ZjbS5nb29nbGVhcGlzLmNvbSJ9')

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_openssl(self, *args):
        return subprocess.run([OPENSSL, *args], capture_output=True, timeout=30)

    def test_openssl_accepts_our_signatures(self):
        for _ in range(5):
            d = W.new_private_key()
            with open(self.msg, 'rb') as f:
                sig = W.sign(d, f.read())
            pub, der = os.path.join(self.dir, 'pub.pem'), os.path.join(self.dir, 'sig.der')
            with open(pub, 'w') as f:
                f.write(pem_public(W.public_key(d)))
            with open(der, 'wb') as f:
                f.write(to_der(sig))
            r = self.run_openssl('dgst', '-sha256', '-verify', pub, '-signature', der, self.msg)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn(b'Verified OK', r.stdout)
            with open(der, 'wb') as f:
                f.write(to_der(sig[:32] + (int.from_bytes(sig[32:], 'big') ^ 1).to_bytes(32, 'big')))
            self.assertNotEqual(self.run_openssl('dgst', '-sha256', '-verify', pub, '-signature', der, self.msg).returncode, 0)

    def test_we_accept_openssl_signatures(self):
        key, pub, der = (os.path.join(self.dir, n) for n in ('key.pem', 'pub.der', 'sig.der'))
        self.assertEqual(self.run_openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key).returncode, 0)
        self.assertEqual(self.run_openssl('ec', '-in', key, '-pubout', '-outform', 'DER', '-out', pub).returncode, 0)
        with open(pub, 'rb') as f:
            spki = f.read()
        self.assertEqual(spki[:len(SPKI_P256)], SPKI_P256)
        point = W.decode_point(spki[len(SPKI_P256):])
        for _ in range(3):
            self.assertEqual(self.run_openssl('dgst', '-sha256', '-sign', key, '-out', der, self.msg).returncode, 0)
            with open(der, 'rb') as f:
                sig = from_der(f.read())
            with open(self.msg, 'rb') as f:
                msg = f.read()
            self.assertTrue(W.verify(point, msg, sig))
            self.assertFalse(W.verify(point, msg + b'x', sig))


class Vapid(unittest.TestCase):
    def test_jwt(self):
        d = W.new_private_key()
        now = 1_760_000_000
        jwt = W.vapid_jwt(d, 'https://web.push.apple.com/QGuQyavXutnMH?x=1', 'mailto:me@example.com', now=now)
        head, claims, sig = jwt.split('.')
        self.assertEqual(json.loads(W.unb64u(head)), {'typ': 'JWT', 'alg': 'ES256'})
        self.assertEqual(json.loads(W.unb64u(claims)), {'aud': 'https://web.push.apple.com', 'exp': now + 3600, 'sub': 'mailto:me@example.com'})
        self.assertNotIn('=', jwt)
        self.assertEqual(len(W.unb64u(sig)), 64)
        self.assertTrue(W.verify(W.public_key(d), f'{head}.{claims}'.encode(), W.unb64u(sig)))

    def test_empty_push_request(self):
        calls = []
        saved = W._http
        W._http = lambda url, headers, timeout: calls.append((url, headers, timeout)) or (201, b'')
        try:
            keys = W.new_keys()
            d = W.private_from_b64(keys['private'])
            self.assertEqual(W.push('https://fcm.googleapis.com/fcm/send/abc', d, keys['public'], 'mailto:x@example.com'), (201, b''))
        finally:
            W._http = saved
        (url, headers, timeout), = calls
        self.assertEqual((url, timeout), ('https://fcm.googleapis.com/fcm/send/abc', 5))
        self.assertEqual((headers['TTL'], headers['Urgency'], headers['Content-Length']), ('86400', 'normal', '0'))
        auth = headers['Authorization']
        self.assertTrue(auth.startswith('vapid t='))
        t, k = auth[len('vapid t='):].split(', k=')
        self.assertEqual(k, keys['public'])
        head, claims, sig = t.split('.')
        self.assertTrue(W.verify(W.decode_point(W.unb64u(k)), f'{head}.{claims}'.encode(), W.unb64u(sig)))
        exp = json.loads(W.unb64u(claims))['exp']
        self.assertLess(abs(exp - (time.time() + 3600)), 30)


if __name__ == '__main__':
    unittest.main()
