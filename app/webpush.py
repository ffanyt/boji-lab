"""Web Push for 薄肌研究所: empty pushes signed with VAPID (RFC 8292, ES256). Standard library only.

The server only sends pushes without a payload, so there is no RFC 8291 encryption: the service worker wakes up and
asks the server (GET /api/push/next) what to show. VAPID needs ECDSA on P-256, which the standard library doesn't
have, so it is implemented here: Jacobian coordinates, a Montgomery ladder for scalar multiplication, a fresh random
nonce from `secrets` for every signature. app/server.py keeps the key pair in LSJ_DATA/vapid.json and hands out only the
public key. Deployed next to server.py (it imports this file from its own directory).
"""
import base64
import hashlib
import http.client
import json
import secrets
import ssl
import time
from urllib.parse import urlsplit

# ---------------------------------------------------------------- P-256 (secp256r1, FIPS 186-4 D.1.2.3)

P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
A = P - 3
B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b
N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
G = (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296,
     0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5)
INF = (1, 1, 0)  # the point at infinity in Jacobian coordinates (Z = 0)


def on_curve(pt):
    x, y = pt
    return 0 <= x < P and 0 <= y < P and (y * y - (x * x * x + A * x + B)) % P == 0


def _double(p1):
    """2·p1 in Jacobian coordinates (X/Z², Y/Z³), using a = −3."""
    x1, y1, z1 = p1
    if z1 == 0 or y1 == 0:
        return INF
    delta = z1 * z1 % P
    gamma = y1 * y1 % P
    beta = x1 * gamma % P
    alpha = 3 * (x1 - delta) * (x1 + delta) % P
    x3 = (alpha * alpha - 8 * beta) % P
    z3 = ((y1 + z1) * (y1 + z1) - gamma - delta) % P
    y3 = (alpha * (4 * beta - x3) - 8 * gamma * gamma) % P
    return x3, y3, z3


def _add(p1, p2):
    """p1 + p2 in Jacobian coordinates."""
    x1, y1, z1 = p1
    x2, y2, z2 = p2
    if z1 == 0:
        return p2
    if z2 == 0:
        return p1
    z1z1, z2z2 = z1 * z1 % P, z2 * z2 % P
    u1, u2 = x1 * z2z2 % P, x2 * z1z1 % P
    s1, s2 = y1 * z2 * z2z2 % P, y2 * z1 * z1z1 % P
    h, r = (u2 - u1) % P, (s2 - s1) % P
    if h == 0:
        return _double(p1) if r == 0 else INF
    hh = h * h % P
    hhh = h * hh % P
    v = u1 * hh % P
    x3 = (r * r - hhh - 2 * v) % P
    y3 = (r * (v - x3) - s1 * hhh) % P
    z3 = z1 * z2 * h % P
    return x3, y3, z3


def _affine(p):
    """(x, y), or None for the point at infinity."""
    x, y, z = p
    if z == 0:
        return None
    zi = pow(z, -1, P)
    zi2 = zi * zi % P
    return x * zi2 % P, y * zi2 * zi % P


def _ladder(k, pt):
    """k·pt (Jacobian) by a Montgomery ladder over all 256 bits: the same steps whatever the bits of k are."""
    r0, r1 = INF, (pt[0], pt[1], 1)
    for i in range(255, -1, -1):
        if (k >> i) & 1:
            r0, r1 = _add(r0, r1), _double(r1)
        else:
            r0, r1 = _double(r0), _add(r0, r1)
    return r0


def mul(k, pt=G):
    """k·pt as an affine point (None for infinity)."""
    return _affine(_ladder(k % N, pt))


# ---------------------------------------------------------------- keys and ES256

def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def unb64u(text):
    """base64url without padding (padding tolerated) → bytes. ValueError for anything else."""
    if not isinstance(text, str):
        raise ValueError('expected base64url text')
    s = text.strip().rstrip('=')
    if not s or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_' for c in s) or len(s) % 4 == 1:
        raise ValueError('not base64url')
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def new_private_key():
    """A private key: a random integer in [1, n − 1]."""
    return secrets.randbelow(N - 1) + 1


def encode_point(pt):
    """The uncompressed point 0x04 ‖ X ‖ Y, 65 bytes (what browsers take as applicationServerKey)."""
    return b'\x04' + pt[0].to_bytes(32, 'big') + pt[1].to_bytes(32, 'big')


def decode_point(raw):
    """65 bytes 0x04 ‖ X ‖ Y → (x, y) on the curve. ValueError otherwise."""
    if len(raw) != 65 or raw[0] != 4:
        raise ValueError('not an uncompressed P-256 point')
    pt = (int.from_bytes(raw[1:33], 'big'), int.from_bytes(raw[33:], 'big'))
    if not on_curve(pt):
        raise ValueError('point is not on P-256')
    return pt


def public_key(d):
    """The public point d·G."""
    if not 1 <= d < N:
        raise ValueError('private key out of range')
    return mul(d)


def private_from_b64(text):
    d = int.from_bytes(unb64u(text), 'big')
    if not 1 <= d < N:
        raise ValueError('private key out of range')
    return d


def new_keys():
    """A fresh key pair as stored in vapid.json: {"private": 32 bytes, "public": 65 bytes}, both base64url."""
    d = new_private_key()
    return {'private': b64u(d.to_bytes(32, 'big')), 'public': b64u(encode_point(public_key(d)))}


def _digest(msg):
    return int.from_bytes(hashlib.sha256(msg).digest(), 'big')  # 256 bits: no truncation for P-256


def sign_with_k(d, msg, k):
    """(r, s) of an ECDSA P-256 / SHA-256 signature with the nonce k (None when k gives r or s = 0). Tests use it with
    known nonces; sign() picks k at random."""
    pt = mul(k)
    if pt is None:
        return None
    r = pt[0] % N
    s = pow(k, -1, N) * (_digest(msg) + r * d) % N
    return (r, s) if r and s else None


def sign(d, msg):
    """ES256 signature of msg: r ‖ s, 32 bytes each (the JWS form, not DER)."""
    while True:
        rs = sign_with_k(d, msg, secrets.randbelow(N - 1) + 1)
        if rs:
            return rs[0].to_bytes(32, 'big') + rs[1].to_bytes(32, 'big')


def verify(pub, msg, sig):
    """Whether sig (r ‖ s, 64 bytes) is a valid signature of msg by the public point pub."""
    if len(sig) != 64 or pub is None or not on_curve(pub):
        return False
    r, s = int.from_bytes(sig[:32], 'big'), int.from_bytes(sig[32:], 'big')
    if not (1 <= r < N and 1 <= s < N):
        return False
    w = pow(s, -1, N)
    u1, u2 = _digest(msg) * w % N, r * w % N
    pt = _affine(_add(_ladder(u1, G), _ladder(u2, pub)))
    return pt is not None and pt[0] % N == r


# ---------------------------------------------------------------- VAPID and the push request

def origin(endpoint):
    u = urlsplit(endpoint)
    return f'{u.scheme}://{u.netloc}'


def vapid_jwt(d, endpoint, contact, now=None, ttl=3600):
    """The VAPID JWT for one push service: aud = the endpoint's origin, exp = now + ttl, sub = contact (mailto: or https:)."""
    def part(obj):
        return b64u(json.dumps(obj, separators=(',', ':')).encode())
    head = part({'typ': 'JWT', 'alg': 'ES256'})
    claims = part({'aud': origin(endpoint), 'exp': int(now if now is not None else time.time()) + ttl, 'sub': contact})
    signing_input = f'{head}.{claims}'
    return f'{signing_input}.{b64u(sign(d, signing_input.encode("ascii")))}'


def _http(url, headers, timeout):
    """POST an empty body. (status, the first bytes of the answer). Raises OSError / http.client errors when the push
    service can't be reached (timeouts included). Tests replace this."""
    u = urlsplit(url)
    c = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=timeout, context=ssl.create_default_context())
    try:
        c.request('POST', (u.path or '/') + (f'?{u.query}' if u.query else ''), body=b'', headers=headers)
        r = c.getresponse()
        return r.status, r.read(1024)
    finally:
        c.close()


def push(endpoint, d, public_b64, contact, ttl=86400, urgency='normal', timeout=5, now=None):
    """Wake one subscription with an empty push. Returns (HTTP status, the start of the answer); raises like _http."""
    headers = {'Authorization': f'vapid t={vapid_jwt(d, endpoint, contact, now)}, k={public_b64}',
               'TTL': str(ttl), 'Urgency': urgency, 'Content-Length': '0'}
    return _http(endpoint, headers, timeout)
