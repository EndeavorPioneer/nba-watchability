import base64
from io import BytesIO
import unittest
from unittest.mock import MagicMock, patch

from PIL import Image
import pandas as pd
import requests

from app import dashboard_views, team_logos
from core.team_meta import get_logo_url


class TeamLogoTests(unittest.TestCase):
    def setUp(self):
        team_logos._logo_data_uri.clear()
        self.addCleanup(team_logos._logo_data_uri.clear)

    def test_url_uses_known_canonical_team_and_lowercase_filename(self):
        self.assertEqual(get_logo_url("LA Lakers"), "https://a.espncdn.com/i/teamlogos/nba/500/lal.png")
        self.assertIsNone(get_logo_url("https://not-a-team.example/"))

    def test_known_logo_is_bounded_and_reused(self):
        art = BytesIO()
        Image.new("RGBA", (500, 300), color="blue").save(art, format="PNG")
        response = MagicMock(status_code=200, headers={"Content-Type": "image/png"})
        response.__enter__.return_value = response
        response.iter_content.return_value = [art.getvalue()]
        with patch.object(team_logos.requests, "get", return_value=response) as get:
            first = team_logos.load_team_logos(["Boston Celtics", "Boston Celtics", "unknown"])
            second = team_logos.load_team_logos(["Boston Celtics"])
        self.assertEqual(first, second)
        get.assert_called_once_with(
            "https://a.espncdn.com/i/teamlogos/nba/500/bos.png",
            timeout=(2, 3), stream=True, allow_redirects=False,
        )
        uri = first["Boston Celtics"]
        self.assertTrue(uri.startswith("data:image/png;base64,"))
        with Image.open(BytesIO(base64.b64decode(uri.partition(",")[2]))) as out:
            self.assertEqual(out.size, (112, 67))

    def test_network_failure_keeps_team_badge_instead_of_broken_image(self):
        df = pd.DataFrame([{
            "Away team": "Boston Celtics", "Home team": "Los Angeles Lakers",
            "Away logo": "old-artifact.png", "aWI": 49.2,
        }])
        with patch.object(team_logos.requests, "get", side_effect=requests.Timeout):
            attached = dashboard_views._attach_team_logos(df)
        self.assertEqual(attached["aWI"].tolist(), df["aWI"].tolist())
        self.assertEqual(attached["Away logo"].tolist(), ["old-artifact.png"])
        self.assertIsNone(attached.loc[0, "_Away logo"])
        badge = dashboard_views._team_logo_html("Boston Celtics", attached.loc[0, "_Away logo"])
        self.assertIn(">BOS</span>", badge)
        self.assertNotIn("<img", badge)

    def test_chart_uses_picture_and_fallback_in_separate_layers(self):
        row = {
            "Local date": "2026-11-19", "Away team": "Boston Celtics",
            "Home team": "Los Angeles Lakers", "Team quality": 1.0,
            "Closeness": 0.5, "aWI": 72.0, "Region": "Watchable",
            "Matchup": "Celtics @ Lakers", "Tip display": "7 PM",
        }
        with (
            patch.object(dashboard_views, "load_team_logos", return_value={"Boston Celtics": "data:image/png;base64,abc"}),
            patch.object(dashboard_views.st, "altair_chart") as render,
        ):
            dashboard_views.render_chart(pd.DataFrame([row]), [], {}, False, None)
        chart = render.call_args.args[0].to_dict()
        pic = next(layer for layer in chart["layer"] if layer.get("mark", {}).get("type") == "image")
        badge = next(
            layer for layer in chart["layer"]
            if layer.get("encoding", {}).get("text", {}).get("field") == "_abbr"
        )
        self.assertEqual(pic["mark"]["xOffset"], badge["mark"]["xOffset"])
        self.assertIn("clamp", pic["mark"]["xOffset"]["expr"])
        self.assertEqual(chart["datasets"][pic["data"]["name"]][0]["_side"], "away")
        self.assertEqual(chart["datasets"][badge["data"]["name"]][0]["_abbr"], "LAL")

    def test_empty_selected_slate_does_not_fetch_assets(self):
        df = pd.DataFrame([{"Local date": "2026-11-19", "Team quality": 0.4, "Closeness": 0.5}])
        with patch.object(dashboard_views, "load_team_logos") as fetch, patch.object(dashboard_views.st, "info"):
            result = dashboard_views.render_chart(df, ["2026-11-20"], {}, False, "2026-11-20")
        self.assertEqual(result, "2026-11-20")
        fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
