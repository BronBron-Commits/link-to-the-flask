import unittest
from pathlib import Path


MAP3D_JS = Path(__file__).resolve().parents[1] / 'static' / 'map3d.js'
SOCKET_CONNECTION_MANAGER_JS = Path(__file__).resolve().parents[1] / 'static' / 'map3d' / 'managers' / 'socketConnectionManager.js'


class FrontendResumeKeyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MAP3D_JS.read_text(encoding='utf-8')
        cls.socket_source = SOCKET_CONNECTION_MANAGER_JS.read_text(encoding='utf-8')
        cls.combined_source = cls.source + '\n' + cls.socket_source

    def test_resume_key_uses_session_storage_not_local_storage(self) -> None:
        self.assertIn('function getResumeKeyStorage()', self.combined_source)
        self.assertIn('windowObj.sessionStorage', self.combined_source)
        self.assertNotIn("localStorage.getItem(CLIENT_RESUME_STORAGE_KEY)", self.combined_source)
        self.assertNotIn("localStorage.setItem(CLIENT_RESUME_STORAGE_KEY", self.combined_source)

    def test_legacy_local_storage_key_is_cleaned_up(self) -> None:
        self.assertIn('windowObj.localStorage?.removeItem(CLIENT_RESUME_STORAGE_KEY);', self.combined_source)

    def test_resume_key_reads_through_storage_helper(self) -> None:
        self.assertIn("const storage = getResumeKeyStorage();", self.combined_source)
        self.assertIn("storage?.getItem(CLIENT_RESUME_STORAGE_KEY)", self.combined_source)
        self.assertIn("storage?.setItem(CLIENT_RESUME_STORAGE_KEY, generated)", self.combined_source)


if __name__ == '__main__':
    unittest.main()