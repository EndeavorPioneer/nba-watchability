import unittest
from unittest.mock import patch

from app.dashboard_views import inject_live_score_refresh


class LiveScoreComponentTests(unittest.TestCase):
    @patch("streamlit.components.v1.html")
    def test_does_not_reload_dashboard_or_reapply_legacy_timer(self, component):
        inject_live_score_refresh()
        markup = component.call_args.args[0]
        self.assertIn("startNbaDuoLiveScores(page)", markup)
        self.assertIn("const page = window.parent", markup)
        self.assertIn("page[key]()", markup)
        self.assertIn('addEventListener("visibilitychange"', markup)
        self.assertIn("prefers-reduced-motion", markup)
        self.assertNotIn("location.reload", markup)


if __name__ == "__main__":
    unittest.main()
