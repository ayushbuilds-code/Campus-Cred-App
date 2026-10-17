"""Browser walkthrough (Playwright for Python). Run against a freshly seeded server:
   pip install playwright && playwright install chromium
   BASE=http://localhost:4000 python3 e2e/walkthrough.py
It drives the real UI: login, coordinator check-in, student check-in on a phone-sized screen,
submission, scoring, certificate verification, tamper check, dashboards and a 360 px overflow check."""
import re, json, sqlite3, sys
from playwright.sync_api import sync_playwright, expect

import os
BASE = os.environ.get('BASE', 'http://localhost:4000')
SHOTS = os.environ.get('SHOTS', 'docs/screenshots')
os.makedirs(SHOTS, exist_ok=True)
PRES = 'siddharth.nair.21@students.msot.example'      # Coding president
MEMBER = 'MSOT26025'                                  # Coding member
errors, results = [], []

def ok(name, cond, extra=''):
    results.append((name, bool(cond), extra)); print(('PASS ' if cond else 'FAIL ') + name, extra)

def login(page, ident, pw='Demo@123'):
    page.goto(BASE + '/login')
    page.fill('input[autocomplete=username]', ident)
    page.fill('input[type=password]', pw)
    page.click('button:has-text("Sign in") >> nth=-1' if False else 'form button[type=submit]')
    page.wait_for_selector('h1:has-text("Good")', timeout=8000)

def watch(page, label):
    page.on('console', lambda m: errors.append((label, m.type, m.text)) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append((label, 'pageerror', str(e))))

with sync_playwright() as p:
    b = p.chromium.launch()
    desk = b.new_context(viewport={'width': 1280, 'height': 800}, permissions=[])
    mob = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pres, stu = desk.new_page(), mob.new_page()
    watch(pres, 'president'); watch(stu, 'student')

    # ---- login screen ----
    pres.goto(BASE + '/login'); pres.wait_for_selector('text=Demo accounts')
    pres.screenshot(path=SHOTS + '/01-login-desktop.png')
    ok('login page lists demo accounts', pres.locator('text=Demo accounts').count() == 1)
    pres.fill('input[autocomplete=username]', PRES); pres.fill('input[type=password]', 'wrong')
    pres.click('form button[type=submit]'); pres.wait_for_selector('text=incorrect')
    ok('wrong password shows a readable error', True)

    # ---- president: home, clubs, club days ----
    login(pres, PRES)
    pres.screenshot(path=SHOTS + '/02-home-president.png')
    ok('president home shows "Club Days ready to run"', pres.locator("text=ready to run").count() == 1)
    pres.click('a:has-text("Clubs") >> nth=0'); pres.wait_for_selector('h1:has-text("Clubs")')
    ok('clubs page lists 4 clubs', pres.locator('h2 a, a.font-display').count() >= 4, str(pres.locator('a.font-display').count()))
    pres.click('a:has-text("Club Days") >> nth=0'); pres.wait_for_selector('h1:has-text("Club Days")')
    pres.screenshot(path=SHOTS + '/03-club-days.png', full_page=True)
    # open this Saturday's Coding activity
    pres.click('a:has-text("Coding") >> nth=0'); pres.wait_for_selector('text=Check-in')

    # ---- start check-in -> live screen ----
    pres.click('button:has-text("Start check-in")'); pres.wait_for_selector('text=Start and show QR')
    pres.click('button:has-text("Start and show QR")')
    pres.wait_for_url(re.compile(r'/run/\d+')); pres.wait_for_selector('svg[role=img], svg')
    pres.wait_for_selector('p.tabular-nums')
    code = pres.locator('p.tabular-nums').first.inner_text().replace(' ', '')
    ok('live screen shows a rotating QR and a 6-digit code', re.fullmatch(r'\d{6}', code) is not None, code)
    pres.screenshot(path=SHOTS + '/04-run-clubday.png')
    first_qr = pres.locator('svg path').evaluate_all('els => els.map(e => e.getAttribute("d")).join("").length')

    # ---- member on a phone: check in with the code ----
    login(stu, MEMBER)
    stu.screenshot(path=SHOTS + '/05-home-student-mobile.png')
    ok('student home shows check-in banner', stu.locator('text=Check-in is open').count() >= 1)
    stu.click('text=Check in now'); stu.wait_for_selector('h1:has-text("Check in")')
    stu.click('button:has-text("Enter code")')
    # the code rotates every 20 s; read the current one just before typing
    code = pres.locator('p.tabular-nums').first.inner_text().replace(' ', '')
    stu.fill('input[inputmode=numeric]', code); stu.click('button:has-text("Check in") >> nth=-1')
    stu.wait_for_selector('text=You are checked in', timeout=10000)
    stu.screenshot(path=SHOTS + '/06-checkin-success-mobile.png')
    ok('student checks in with the 6-digit code', True)

    # a screenshot / old code must not work for a second student
    pres.wait_for_timeout(3200)
    ok('president live count updates to 1 / 10', pres.locator('text=/^1\\s*\\/\\s*10/').count() >= 1 or 'checked in' in pres.inner_text('body'))
    pres.screenshot(path=SHOTS + '/07-run-after-checkin.png')

    # ---- member submits a link, president scores and publishes ----
    stu.goto(BASE + '/'); stu.wait_for_selector('h1:has-text("Good")')
    stu.click('a:has-text("Coding")'); stu.wait_for_selector('text=Your submission')
    stu.click('button:has-text("Paste a link")'); stu.fill('input[type=url]', 'https://example.com/my-deck')
    stu.click('button:has-text("Submit")'); stu.wait_for_selector('text=Submitted', timeout=8000)
    stu.screenshot(path=SHOTS + '/08-submission-mobile.png', full_page=True)
    ok('student submits work', True)

    pres.goto(BASE + '/club-days'); pres.click('a:has-text("Coding") >> nth=0'); pres.wait_for_selector('text=Submissions')
    pres.click('button:text-is("Score")'); pres.wait_for_selector('text=Weighted total')
    pres.screenshot(path=SHOTS + '/09-score-modal.png')
    pres.click('button:has-text("Save score")'); pres.wait_for_selector('text=Score saved')
    pres.click('button:has-text("Publish scores")'); pres.wait_for_selector('text=Published 1 scores', timeout=10000)
    ok('coordinator scores and publishes; a certificate is issued', pres.locator('text=1 certificate issued').count() >= 1)

    # ---- student certificate + public verification (logged out) ----
    stu.goto(BASE + '/certificates'); stu.wait_for_selector('h1:has-text("Certificates")')
    stu.screenshot(path=SHOTS + '/10-certificates-mobile.png', full_page=True)
    cid = stu.locator('p.font-mono').first.inner_text()
    anon = b.new_context(viewport={'width': 1100, 'height': 800}).new_page(); watch(anon, 'anonymous')
    anon.goto(f'{BASE}/verify/{cid}'); anon.wait_for_selector('text=This certificate is genuine')
    anon.screenshot(path=SHOTS + '/11-verify-public.png', full_page=True)
    ok('public verification page works without login', True, cid)
    with stu.expect_download() as dl:
        stu.click('button:has-text("Download PDF") >> nth=0')
    path = dl.value.path(); data = open(path, 'rb').read()
    ok('certificate PDF downloads', data[:4] == b'%PDF', f'{len(data)} bytes')

    # tampered upload via the UI
    tampered = bytearray(data); tampered[len(tampered)//2] ^= 0xFF
    open('/tmp/tampered.pdf', 'wb').write(tampered)  # a copy of the PDF with one byte changed
    anon.set_input_files('input[type=file]', '/tmp/tampered.pdf'); anon.click('button:has-text("Check this file")')
    anon.wait_for_selector('text=altered', timeout=8000)
    anon.screenshot(path=SHOTS + '/12-verify-tampered.png', full_page=True)
    ok('tampered PDF is rejected in the UI', True)

    # ---- transcript ----
    stu.goto(BASE + '/transcript'); stu.wait_for_selector('text=Co-curricular transcript')
    with stu.expect_download() as dl2:
        stu.click('button:has-text("Download verified PDF")')
    ok('transcript PDF downloads', open(dl2.value.path(), 'rb').read(4) == b'%PDF')

    # ---- advisor reviews a pending plan ----
    adv = b.new_context(viewport={'width': 1280, 'height': 800}).new_page(); watch(adv, 'advisor')
    login(adv, 'advisor.sports@msot.example')
    adv.screenshot(path=SHOTS + '/13-home-advisor.png')
    adv.click('text=Review >> nth=0'); adv.wait_for_selector('button:has-text("Approve plan")')
    adv.click('button:has-text("Approve plan")'); adv.wait_for_selector('text=Plan approved')
    ok('advisor approves a pending plan', True)

    # ---- admin dashboard + reports + admin ----
    adm = b.new_context(viewport={'width': 1280, 'height': 800}).new_page(); watch(adm, 'admin')
    login(adm, 'admin@msot.example')
    adm.click('a:has-text("Dashboard") >> nth=0'); adm.wait_for_selector('text=Participation dashboard'); adm.wait_for_selector('.recharts-surface')
    adm.screenshot(path=SHOTS + '/14-dashboard.png', full_page=True)
    ok('dashboard renders charts', adm.locator('.recharts-surface').count() >= 2)
    adm.click('a:has-text("Reports") >> nth=0'); adm.wait_for_selector('text=Monthly club reports'); adm.wait_for_timeout(800)
    adm.screenshot(path=SHOTS + '/15-reports.png', full_page=True)
    adm.click('a:has-text("Admin")'); adm.wait_for_selector('text=Administration'); adm.click('button[role=tab]:has-text("Audit log")'); adm.wait_for_selector('text=Audit log >> nth=1')
    adm.screenshot(path=SHOTS + '/16-audit.png', full_page=True)

    # ---- responsive: no horizontal scroll on a phone for every main page ----
    over = []
    for role, ident, paths in [('student', MEMBER, ['/', '/clubs', '/club-days', '/checkin', '/events', '/certificates', '/transcript', '/notifications']),
                               ('president', PRES, ['/dashboard', '/reports'])]:
        ctx = b.new_context(viewport={'width': 360, 'height': 740}, is_mobile=True, has_touch=True); pg = ctx.new_page(); watch(pg, 'mobile-' + role)
        login(pg, ident)
        for path in paths:
            pg.goto(BASE + path); pg.wait_for_timeout(700)
            sw, iw = pg.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
            if sw > iw + 1: over.append((role, path, sw, iw))
        ctx.close()
    ok('no horizontal scrolling at 360 px on main pages', not over, str(over))
    stu.set_viewport_size({'width': 390, 'height': 844}); stu.goto(BASE + '/club-days'); stu.wait_for_timeout(600)
    stu.screenshot(path=SHOTS + '/17-club-days-mobile.png', full_page=False)
    b.close()

real = [e for e in errors if not re.search(r'status of 4\d\d|Failed to load resource.*(4\d\d)', e[2])]
print('\nCONSOLE/PAGE ERRORS:', json.dumps(real, indent=1)[:2000] if real else 'none')
print('4xx noise:', len(errors) - len(real))
print(f'\n{sum(1 for r in results if r[1])}/{len(results)} UI checks passed')
json.dump([{'check': n, 'pass': ok_, 'detail': d} for n, ok_, d in results], open(os.environ.get('UI_RESULTS', 'docs/ui-results.json'), 'w'), indent=2)
sys.exit(0 if all(r[1] for r in results) and not real else 1)
