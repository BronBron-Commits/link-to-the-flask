import unittest
from pathlib import Path


MAP3D_JS = Path(__file__).resolve().parents[1] / 'static' / 'map3d.js'


class FrontendResumeKeyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MAP3D_JS.read_text(encoding='utf-8')

    def test_resume_key_uses_session_storage_not_local_storage(self) -> None:
        self.assertIn('function getResumeKeyStorage()', self.source)
        self.assertIn('window.sessionStorage', self.source)
        self.assertNotIn("localStorage.getItem(CLIENT_RESUME_STORAGE_KEY)", self.source)
        self.assertNotIn("localStorage.setItem(CLIENT_RESUME_STORAGE_KEY", self.source)

    def test_legacy_local_storage_key_is_cleaned_up(self) -> None:
        self.assertIn('window.localStorage?.removeItem(CLIENT_RESUME_STORAGE_KEY);', self.source)

    def test_resume_key_reads_through_storage_helper(self) -> None:
        self.assertIn("const storage = getResumeKeyStorage();", self.source)
        self.assertIn("storage?.getItem(CLIENT_RESUME_STORAGE_KEY)", self.source)
        self.assertIn("storage?.setItem(CLIENT_RESUME_STORAGE_KEY, generated)", self.source)


if __name__ == '__main__':
    unittest.main()