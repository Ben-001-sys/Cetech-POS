from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'apps' / 'pos-web'
PACKAGE = APP / 'package.json'
CONFIG = next(iter(APP.glob('vitest.config.*')), None)

REQUIRED_INCLUDE_AREAS = (
    'src/app/',
    'src/features/',
    'src/ui/',
    'src/core/',
    'src/server/',
    'src/local/',
    'tests/frontend/',
    'tests/integration/auth/',
    'tests/integration/health/',
    'tests/integration/sync/',
    'tests/integration/sales/',
    'tests/integration/payments/',
    'tests/integration/returns/',
    'tests/contracts/',
)

REQUIRED_EXCLUDE_MARKERS = (
    'node_modules',
    '.next',
    'playwright-report',
    'test-results',
    'coverage',
    'e2e',
    '*.pw.*',
    'tests/frontend/evidence',
)

SHOULD_MATCH = (
    'src/app/page.test.tsx',
    'src/features/auth/LoginScreen.test.tsx',
    'src/ui/shell/AppShell.test.tsx',
    'src/core/money.test.ts',
    'src/server/quote.test.ts',
    'src/local/draft.test.ts',
    '../../tests/frontend/no-demo.test.ts',
    '../../tests/frontend/tokens.test.ts',
    '../../tests/frontend/visual-harness.test.ts',
    '../../tests/integration/auth/staff-authorization.test.ts',
    '../../tests/integration/health/store-health.test.ts',
    '../../tests/integration/sync/catalog-projection.test.ts',
    '../../tests/integration/sales/durable-checkout-store.test.ts',
    '../../tests/integration/payments/electronic-payment.test.ts',
    '../../tests/integration/returns/return-runtime.test.ts',
    '../../tests/contracts/producer-consumer.test.ts',
)

SHOULD_NOT_MATCH = (
    '../../tests/frontend/visual/shell-viewports.pw.ts',
    '../../tests/frontend/visual/playwright.config.ts',
    '../../tests/frontend/evidence/shell-desktop.html',
    'e2e/scaffold.spec.ts',
    'e2e/invite-acceptance-strict.spec.ts',
    'e2e/thermal-receipt-print.spec.ts',
    'node_modules/pkg/index.test.js',
    '.next/types/routes.test.ts',
    'playwright-report/index.test.ts',
    'coverage/unit.test.ts',
)


def _string_array(source, key):
    match = re.search(rf'{re.escape(key)}\s*:\s*\[(.*?)\]', source, re.S)
    if not match:
        raise AssertionError('missing %s array in %s' % (key, CONFIG.name))
    return re.findall(r'"([^"]+)"', match.group(1))


def glob_to_re(pattern):
    pattern = pattern.replace('\\', '/')
    out = ['^']
    i = 0
    while i < len(pattern):
        if pattern.startswith('**/', i):
            out.append('(?:.*/)?')
            i += 3
        elif pattern.startswith('**', i):
            out.append('.*')
            i += 2
        elif pattern[i] == '*':
            out.append('[^/]*')
            i += 1
        elif pattern[i] == '?':
            out.append('[^/]')
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    out.append('$')
    return re.compile(''.join(out))


def discovered(rel, includes, excludes):
    path = rel.replace('\\', '/')
    if any(glob_to_re(pattern).search(path) for pattern in excludes):
        return False
    return any(glob_to_re(pattern).search(path) for pattern in includes)


class VitestDiscoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if CONFIG is None:
            raise AssertionError('missing apps/pos-web/vitest.config.*')
        cls.package = json.loads(PACKAGE.read_text(encoding='utf-8'))
        cls.config = CONFIG.read_text(encoding='utf-8')
        cls.includes = _string_array(cls.config, 'include')
        cls.excludes = _string_array(cls.config, 'exclude')

    def test_canonical_script_is_not_narrowed_to_src_app(self):
        script = self.package['scripts']['test']
        self.assertEqual(script, 'vitest run')
        self.assertNotIn('--dir', script)
        self.assertNotIn('src/app', script)

    def test_discovery_config_exists_and_uses_node_environment(self):
        self.assertIsNotNone(CONFIG)
        self.assertTrue(CONFIG.is_file())
        self.assertRegex(self.config, r'environment:\s*["\']node["\']')
        self.assertNotRegex(self.config, r'\bjsdom\b')
        self.assertNotRegex(self.config, r'\bhappy-dom\b')

    def test_include_covers_intended_application_areas(self):
        joined = '\n'.join(self.includes)
        self.assertTrue(self.includes)
        for area in REQUIRED_INCLUDE_AREAS:
            with self.subTest(area=area):
                self.assertIn(area, joined)

    def test_exclude_covers_playwright_and_generated_trees(self):
        joined = '\n'.join(self.excludes)
        for marker in REQUIRED_EXCLUDE_MARKERS:
            with self.subTest(marker=marker):
                self.assertIn(marker, joined)

    def test_representative_unit_paths_are_discovered(self):
        for rel in SHOULD_MATCH:
            with self.subTest(path=rel):
                self.assertTrue(discovered(rel, self.includes, self.excludes), rel)

    def test_playwright_and_generated_paths_are_not_discovered(self):
        for rel in SHOULD_NOT_MATCH:
            with self.subTest(path=rel):
                self.assertFalse(discovered(rel, self.includes, self.excludes), rel)

    def test_browser_qualification_specs_belong_to_playwright(self):
        specs = (
            'e2e/invite-acceptance-strict.spec.ts',
            'e2e/thermal-receipt-print.spec.ts',
        )
        playwright = (APP / 'playwright.config.ts').read_text(encoding='utf-8')
        self.assertIn('testDir: "./e2e"', playwright)
        self.assertNotIn('testIgnore', playwright)
        self.assertNotIn('testMatch', playwright)
        for rel in specs:
            with self.subTest(path=rel):
                self.assertTrue((APP / rel).is_file(), rel)
                self.assertTrue(rel.endswith('.spec.ts'), rel)
                self.assertFalse(discovered(rel, self.includes, self.excludes), rel)
