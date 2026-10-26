#!/usr/bin/env python3
"""Build the 「同步健康」 iOS Shortcut, sign it, and check the signed file.

    deploy/make-shortcut.py [URL]                 build, sign with macOS `shortcuts sign`, check → app/web/lianshiji-health.shortcut
    deploy/make-shortcut.py [URL] --signer        sign with deploy/local/signer.py instead (not in the repository)
    deploy/make-shortcut.py [URL] --check FILE    only check an already signed FILE against a fresh build
    deploy/make-shortcut.py [URL] --unsigned FILE only write the unsigned Shortcut (to sign it on another Mac)
    --out FILE                                    write the signed Shortcut somewhere else
    --times 08:00,14:40,23:10                     also carry daily automations at these times (iOS 27; see below)

URL is the site's public https address: the argument, else $LSJ_URL, else LSJ_URL in deploy/.deploy.env.
Then run deploy/deploy.sh; the server hands the file out at /shortcut.

The Shortcut reads Apple Health (sleep, steps, active energy, resting heart rate, HRV, weight, body fat, and the last two
days' heart rate and active energy samples, which the server only uses for workouts logged in 训练中) and posts each metric
to /api/ingest/health as {"metric", "v", "s", "e"} (values and ISO 8601 dates, one per line). The heart rate and active
energy samples also send "src", each sample's source (iPhone or Watch, one per line), so the server can count only the
Watch's during a workout instead of adding the iPhone's on top. That uses the Health Sample property 'Source', named
after 「来源」 in Shortcuts' 「获取健康样本的详细信息」; it has not been tried on a real iPhone yet. The upload token is
not in the file: the first action is a Text the user replaces with their token after adding the shortcut. (Import
questions are not used: with them, 「添加快捷指令」 did nothing on an iPhone we tested.)

Automations (--times): from iOS 27 a Shortcut file can carry its own automations, WFWorkflowTriggers. The shape is copied
from a time-of-day automation shared from iOS 27: {WFTriggerIdentifier: WFTimeOfDayTrigger,
WFTriggerSerializedParameters: {WFTime: <date>}, WFTriggerUUID}; only WFTime's local time of day counts (LSJ_TZ). Off by
default: a signer running an older Shortcuts drops the key, so the check fails; it needs `shortcuts sign` on a Mac with Shortcuts 27 signed into iCloud. Until then people add the automation on the
iPhone (the page's 「② 让它每天自动跑」). Health data can't be read while the iPhone is locked: such a run fails.

iOS only imports signed files. `shortcuts sign` needs a Mac signed into iCloud. --signer loads deploy/local/signer.py,
which must define sign(xml: bytes, name: str) -> bytes (for example a wrapper around another signing service). Whatever
signs it, the signed file is unpacked (aea decrypt with the public key from its own signing certificate, then aa
extract) and compared with the local build: only signer metadata (SIGNER_KEYS) may differ, and every URL in it must be
on URL. If the check fails, the output file is left untouched.
The plist shapes follow real exported shortcuts (MacStories Health shortcuts, Heartbridge, iOS 26 exports).
"""
import argparse
import importlib.util
import os
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'app', 'web', 'lianshiji-health.shortcut')
DEPLOY_ENV = os.path.join(HERE, '.deploy.env')
SIGNER = os.path.join(HERE, 'local', 'signer.py')
NAME = '同步健康'
OBJ = '￼'  # the placeholder character a variable occupies inside a text field
# top-level keys a signer rewrites (another signer may set WFWorkflowClientVersion to its own Shortcuts version)
SIGNER_KEYS = {'WFWorkflowClientVersion', 'WFWorkflowClientRelease'}
UUID_RE = re.compile(r'^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$', re.I)
URL_RE = re.compile(r'https?://[A-Za-z0-9._~:/?#@!$&()*+,;=%\[\]-]+', re.I)  # ASCII only: stops at 「。」

# metric, Shortcuts health type, days to look back, group by day, unit, label
METRICS = [
    ('sleep', 'Sleep', 1, False, None, '睡眠'),
    ('steps', 'Steps', 3, True, 'count', '步数（按天合计）'),
    ('active', 'Active Calories', 3, True, 'kcal', '活动能量（按天合计）'),
    ('rhr', 'Resting Heart Rate', 3, False, 'count/min', '静息心率'),
    ('hrv', 'Heart Rate Variability', 3, False, 'ms', 'HRV'),
    ('weight', 'Weight', 3, False, 'kg', '体重（没有智能体重秤就没有数据，不影响）'),
    ('bodyfat', 'Body Fat Percentage', 3, False, '%', '体脂率（体脂秤才有，没有不影响）'),
    ('hr', 'Heart Rate', 2, False, 'count/min', '心率明细（对到薄肌研究所「训练中」记的训练上）'),
    ('kcals', 'Active Calories', 2, False, 'kcal', '活动能量明细（算每次训练的消耗）'),
]
SOURCE_METRICS = ('hr', 'kcals')  # these also send each sample's source ("src")


class CheckError(Exception):
    pass


def new_uuid():
    return str(uuid.uuid4()).upper()


def ref(uid, name, *props, iso=False):
    r = {'Type': 'ActionOutput', 'OutputUUID': uid, 'OutputName': name}
    aggs = [{'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': p} for p in props]
    if iso:
        aggs.append({'Type': 'WFDateFormatVariableAggrandizement', 'WFDateFormatStyle': 'ISO 8601', 'WFISO8601IncludeTime': True})
    if aggs:
        r['Aggrandizements'] = aggs
    return r


def attachment(r):
    return {'WFSerializationType': 'WFTextTokenAttachment', 'Value': r}


def text(s, *refs):
    """A text field; each OBJ in s is replaced by the next variable. Ranges count UTF-16 units."""
    att, i = {}, 0
    for pos, ch in enumerate(s):
        if ch == OBJ:
            att[f'{{{len(s[:pos].encode("utf-16-le")) // 2}, 1}}'] = refs[i]
            i += 1
    return {'WFSerializationType': 'WFTextTokenString', 'Value': {'string': s, 'attachmentsByRange': att}}


def fields(*pairs):
    return {'WFSerializationType': 'WFDictionaryFieldValue', 'Value': {'WFDictionaryFieldValueItems': [
        {'WFItemType': 0, 'WFKey': text(k), 'WFValue': v} for k, v in pairs]}}


def action(ident, **params):
    return {'WFWorkflowActionIdentifier': 'is.workflow.actions.' + ident, 'WFWorkflowActionParameters': params}


def find_samples(uid, hk_type, days, group, unit):
    # rows exactly as current exports write them (Heartbridge, iOS 26 gallery); never mix in the old flat keys
    p = {'UUID': uid,
         'WFContentItemFilter': {'WFSerializationType': 'WFContentPredicateTableTemplate', 'Value': {
             'WFActionParameterFilterPrefix': 1, 'WFContentPredicateBoundedDate': False,
             'WFActionParameterFilterTemplates': [
                 {'Bounded': True, 'Operator': 4, 'Property': 'Type', 'Removable': False,
                  'Values': {'Enumeration': {'Value': hk_type, 'WFSerializationType': 'WFStringSubstitutableState'}}},
                 {'Bounded': True, 'Operator': 1001, 'Property': 'Start Date', 'Removable': False,  # is in the last
                  'Values': {'Number': str(days), 'Unit': 16}}]}},
         'WFContentItemSortProperty': 'Start Date', 'WFContentItemSortOrder': 'Oldest First',
         'WFContentItemLimitEnabled': False}
    if group:
        p.update({'WFHKSampleFilteringGroupBy': 'Day', 'WFHKSampleFilteringFillMissing': False})
    if unit:
        p['WFHKSampleFilteringUnit'] = unit
    return action('filter.health.quantity', **p)


def triggers(times, tz):
    """Daily time-of-day automations, as iOS 27 exports them: WFTime is a date whose local time of day is the time."""
    out = []
    for t in times:
        h, m = (int(x) for x in t.split(':'))
        at = datetime(2026, 10, 15, h, m, tzinfo=ZoneInfo(tz)).astimezone(timezone.utc).replace(tzinfo=None)
        out.append({'WFTriggerIdentifier': 'WFTimeOfDayTrigger', 'WFTriggerSerializedParameters': {'WFTime': at},
                    'WFTriggerUUID': new_uuid()})
    return out


def build(base, times=(), tz='Asia/Shanghai'):
    token = new_uuid()
    acts = [action('comment', WFCommentActionText=f'薄肌研究所 · 同步健康\n把「健康」里的睡眠、步数、活动能量、静息心率、HRV、体重和体脂率，'
                   f'以及最近两天的心率和活动能量明细（只用来算每次训练的心率和消耗）传到 {base}。'
                   '\n下面这个文本框：删掉里面的字，粘贴薄肌研究所「我的 → Apple 健康同步」里复制的同步令牌。'),
            action('gettext', UUID=token, CustomOutputName='同步令牌', WFTextActionText='把这里换成同步令牌')]
    last_post = None
    for metric, hk_type, days, group, unit, label in METRICS:
        f, cv, cs, ce, post = new_uuid(), new_uuid(), new_uuid(), new_uuid(), new_uuid()
        acts.append(action('comment', WFCommentActionText=label))
        acts.append(find_samples(f, hk_type, days, group, unit))
        acts.append(action('text.combine', UUID=cv, WFTextSeparator='New Lines', text=attachment(ref(f, 'Health Samples', 'Value'))))
        acts.append(action('text.combine', UUID=cs, WFTextSeparator='New Lines', text=attachment(ref(f, 'Health Samples', 'Start Date', iso=True))))
        body = [('metric', text(metric)), ('v', text(OBJ, ref(cv, 'Combined Text'))), ('s', text(OBJ, ref(cs, 'Combined Text')))]
        if metric == 'sleep':
            acts.append(action('text.combine', UUID=ce, WFTextSeparator='New Lines', text=attachment(ref(f, 'Health Samples', 'End Date', iso=True))))
            body.append(('e', text(OBJ, ref(ce, 'Combined Text'))))
        if metric in SOURCE_METRICS:  # each sample's source, so the server can tell the Watch from the iPhone
            csrc = new_uuid()
            acts.append(action('text.combine', UUID=csrc, WFTextSeparator='New Lines', text=attachment(ref(f, 'Health Samples', 'Source'))))
            body.append(('src', text(OBJ, ref(csrc, 'Combined Text'))))
        acts.append(action('downloadurl', UUID=post, WFURL=base + '/api/ingest/health', WFHTTPMethod='POST', ShowHeaders=True,
                           WFHTTPHeaders=fields(('Authorization', text(OBJ, ref(token, '同步令牌')))),
                           WFHTTPBodyType='JSON', WFJSONValues=fields(*body)))
        last_post = post
    msg = new_uuid()
    acts.append(action('getvalueforkey', UUID=msg, WFGetDictionaryValueType='Value', WFDictionaryKey='message',
                       WFInput=attachment(ref(last_post, 'Contents of URL'))))
    acts.append(action('notification', UUID=new_uuid(), WFNotificationActionTitle='薄肌研究所', WFNotificationActionSound=False,
                       WFNotificationActionBody=text(OBJ, ref(msg, 'Dictionary Value'))))
    return {
        'WFWorkflowActions': acts,
        'WFWorkflowClientVersion': '3036.0.4.2',
        'WFWorkflowMinimumClientVersion': 900, 'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59764, 'WFWorkflowIconStartColor': 4282601983},
        'WFWorkflowImportQuestions': [],
        'WFWorkflowInputContentItemClasses': [
            'WFAppStoreAppContentItem', 'WFArticleContentItem', 'WFContactContentItem', 'WFDateContentItem',
            'WFEmailAddressContentItem', 'WFGenericFileContentItem', 'WFImageContentItem', 'WFiTunesProductContentItem',
            'WFLocationContentItem', 'WFDCMapsLinkContentItem', 'WFAVAssetContentItem', 'WFPDFContentItem',
            'WFPhoneNumberContentItem', 'WFRichTextContentItem', 'WFSafariWebPageContentItem', 'WFStringContentItem',
            'WFURLContentItem'],
        'WFWorkflowOutputContentItemClasses': [], 'WFWorkflowTypes': [], 'WFQuickActionSurfaces': [],
        'WFWorkflowHasShortcutInputVariables': False, 'WFWorkflowHasOutputFallback': False,
        **({'WFWorkflowTriggers': triggers(times, tz)} if times else {}),
    }


# ---------------------------------------------------------------- configuration

def read_env_file(path):
    vals = {}
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    vals[k.strip()] = v.strip().strip('"\'')
    return vals


def resolve_url(arg):
    base = arg or os.environ.get('LSJ_URL') or read_env_file(DEPLOY_ENV).get('LSJ_URL')
    if not base:
        sys.exit('no server address: pass it as the first argument, or set LSJ_URL (environment or deploy/.deploy.env)')
    base = base.rstrip('/')
    if not re.match(r'^https://[^/\s]+$', base):
        sys.exit(f'the address must look like https://host (no path): {base}')
    return base


def how_to_sign(base):
    return (
        'Sign it with macOS instead (needs a Mac signed into iCloud):\n'
        f'  deploy/make-shortcut.py {base}\n'
        'or build here and sign on another Mac:\n'
        f'  deploy/make-shortcut.py {base} --unsigned {NAME}.shortcut\n'
        f'  shortcuts sign --mode anyone --input {NAME}.shortcut --output app/web/lianshiji-health.shortcut\n'
        f'  deploy/make-shortcut.py {base} --check app/web/lianshiji-health.shortcut')


# ---------------------------------------------------------------- signing

def sign_with_shortcuts(xml, out, base):
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, NAME + '.shortcut')
        with open(raw, 'wb') as f:
            f.write(xml)
        try:
            r = subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', raw, '--output', out], capture_output=True, text=True)
        except FileNotFoundError:
            sys.exit('`shortcuts` not found: signing needs macOS 12 or later.\n' + how_to_sign(base))
    if r.returncode != 0 or not os.path.exists(out):
        sys.exit(f'shortcuts sign failed: {r.stderr.strip() or r.stdout.strip()}\n'
                 '(it needs this Mac signed into iCloud)\n' + how_to_sign(base))


def sign_with_signer(xml, out, base):
    if not os.path.isfile(SIGNER):
        sys.exit(f'--signer needs {os.path.relpath(SIGNER, ROOT)}, which is not in the repository.\n' + how_to_sign(base))
    spec = importlib.util.spec_from_file_location('lsj_signer', SIGNER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with open(out, 'wb') as f:
        f.write(mod.sign(xml, NAME))


# ---------------------------------------------------------------- check

def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise CheckError(f'{cmd[0]} {cmd[1]} failed: {(r.stderr or r.stdout).decode(errors="replace").strip()}')
    return r.stdout.decode(errors='replace')


def unpack(path, tmp):
    """Verify the signature with the key from the file's own certificate and return (workflow plist, cert subjects)."""
    try:
        with open(path, 'rb') as f:
            b = f.read()
    except OSError as e:
        raise CheckError(str(e)) from None
    if b[:4] != b'AEA1' or len(b) < 12:
        raise CheckError('not a signed Shortcut (no AEA1 header)')
    n = struct.unpack('<I', b[8:12])[0]
    try:
        auth = plistlib.loads(b[12:12 + n])
        chain = auth['SigningCertificateChain']
    except Exception as e:
        raise CheckError(f'no signing certificate chain in the file ({e})') from None
    subjects = []
    for i, der in enumerate(chain):
        p = os.path.join(tmp, f'cert{i}.der')
        with open(p, 'wb') as f:
            f.write(der)
        subjects.append(run(['openssl', 'x509', '-inform', 'DER', '-in', p, '-noout', '-subject']).strip())
    pem = os.path.join(tmp, 'leaf.pub.pem')
    with open(pem, 'w') as f:
        f.write(run(['openssl', 'x509', '-inform', 'DER', '-in', os.path.join(tmp, 'cert0.der'), '-noout', '-pubkey']))
    aar = os.path.join(tmp, 'payload.aar')
    run(['aea', 'decrypt', '-i', path, '-o', aar, '-sign-pub', pem])
    entries = [e for e in run(['aa', 'list', '-i', aar]).splitlines() if e.strip()]
    if entries != ['Shortcut.wflow']:
        raise CheckError(f'unexpected archive contents: {entries}')
    out = os.path.join(tmp, 'x')
    os.mkdir(out)
    run(['aa', 'extract', '-i', aar, '-d', out])
    with open(os.path.join(out, 'Shortcut.wflow'), 'rb') as f:
        return plistlib.load(f), subjects


def normalize(x, ids):
    """Sort dict keys and replace each UUID by its order of first appearance (UUIDs are random per build)."""
    if isinstance(x, dict):
        return {k: normalize(x[k], ids) for k in sorted(x)}
    if isinstance(x, list):
        return [normalize(v, ids) for v in x]
    if isinstance(x, str) and UUID_RE.match(x):
        return ids.setdefault(x.upper(), f'<uuid {len(ids)}>')
    return x


def differences(a, b, path=''):
    if type(a) is not type(b):
        return [f'{path or "/"}: {a!r} → {b!r}']
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f'{path}/{k}: added {b[k]!r}')
            elif k not in b:
                out.append(f'{path}/{k}: removed')
            else:
                out += differences(a[k], b[k], f'{path}/{k}')
        return out
    if isinstance(a, list):
        out = [f'{path}: {len(a)} items → {len(b)}'] if len(a) != len(b) else []
        for i, (u, v) in enumerate(zip(a, b)):
            out += differences(u, v, f'{path}[{i}]')
        return out
    return [] if a == b else [f'{path}: {a!r} → {b!r}']


def strings(x):
    if isinstance(x, dict):
        for k, v in x.items():
            yield k
            yield from strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from strings(v)
    elif isinstance(x, str):
        yield x


def check(path, local, base):
    with tempfile.TemporaryDirectory() as tmp:
        signed, subjects = unpack(path, tmp)
    problems = differences(normalize({k: v for k, v in local.items() if k not in SIGNER_KEYS}, {}),
                           normalize({k: v for k, v in signed.items() if k not in SIGNER_KEYS}, {}))
    urls = sorted({u for s in strings(signed) for u in URL_RE.findall(s)})
    problems += [f'URL not on {base}: {u}' for u in urls if u != base and not u.startswith(base + '/')]
    if problems:
        raise CheckError('the signed Shortcut differs from the local build:\n  ' + '\n  '.join(problems[:40]))
    meta = {k: signed[k] for k in SIGNER_KEYS if k in signed and signed.get(k) != local.get(k)}
    return subjects, urls, meta


def report(path, base, subjects, urls, meta):
    print(f'check ok: {os.path.relpath(path)} matches the local build for {base}')
    print(f'  URLs: {", ".join(urls)}')
    if meta:
        print('  changed by the signer (allowed): ' + ', '.join(f'{k}={v}' for k, v in sorted(meta.items())))
    print('  signed by: ' + ' ← '.join(s.replace('subject=', '').strip() for s in subjects))


def parse_times(arg):
    times = tuple(t.strip() for t in arg.split(',') if t.strip())
    for t in times:
        if not re.fullmatch(r'([01]?\d|2[0-3]):[0-5]\d', t):
            sys.exit(f'--times: {t!r} is not HH:MM')
    return times


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('url', nargs='?', help='https://your-server (default: $LSJ_URL or deploy/.deploy.env)')
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--signer', action='store_true', help='sign with deploy/local/signer.py instead of `shortcuts sign`')
    g.add_argument('--check', metavar='FILE', help='only check an already signed file against a fresh build')
    g.add_argument('--unsigned', metavar='FILE', help='only write the unsigned Shortcut')
    ap.add_argument('--out', metavar='FILE', default=OUT, help='where the signed Shortcut goes')
    ap.add_argument('--times', default='', help='daily automations at HH:MM,… (iOS 27; needs a signer that keeps them)')
    a = ap.parse_args()
    base = resolve_url(a.url)
    times = parse_times(a.times)
    tz = os.environ.get('LSJ_TZ') or read_env_file(DEPLOY_ENV).get('LSJ_TZ') or 'Asia/Shanghai'
    wf = build(base, times, tz)

    if a.unsigned:
        with open(a.unsigned, 'wb') as f:
            f.write(plistlib.dumps(wf, fmt=plistlib.FMT_XML))
        print(f'{a.unsigned}: unsigned, {len(wf["WFWorkflowActions"])} actions, uploads to {base}/api/ingest/health, '
              f'runs daily at {", ".join(times) or "(no automations)"}')
        print(f'sign it on a Mac signed into iCloud:\n  shortcuts sign --mode anyone --input {a.unsigned} --output app/web/lianshiji-health.shortcut\n'
              f'then check it here:\n  deploy/make-shortcut.py {base} --check app/web/lianshiji-health.shortcut')
        return
    if a.check:
        try:
            report(a.check, base, *check(a.check, wf, base))
        except CheckError as e:
            sys.exit(f'check FAILED: {e}')
        return

    out = os.path.abspath(a.out)
    with tempfile.TemporaryDirectory() as tmp:
        signed = os.path.join(tmp, 'signed.shortcut')
        (sign_with_signer if a.signer else sign_with_shortcuts)(plistlib.dumps(wf, fmt=plistlib.FMT_XML), signed, base)
        try:
            result = check(signed, wf, base)
        except CheckError as e:
            sys.exit(f'check FAILED, {out} left unchanged: {e}')
        shutil.copyfile(signed, out + '.tmp')
        os.replace(out + '.tmp', out)
    report(out, base, *result)
    print(f'{out} ({os.path.getsize(out)} bytes, {len(wf["WFWorkflowActions"])} actions, uploads to {base}/api/ingest/health'
          f'{", runs daily at " + ", ".join(times) + " " + tz if times else ""})')


if __name__ == '__main__':
    main()
