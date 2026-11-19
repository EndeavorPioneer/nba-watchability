"""Load small in-app logos so browsers do not have to fetch images for Vega."""

from base64 import b64encode
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

from PIL import Image
import requests
import streamlit as st

from core.team_meta import get_logo_url, get_team_abbr


@st.cache_data(ttl=3600, max_entries=64, show_spinner=False)
def _logo_data_uri(team: str) -> str | None:
    # Generate the URL from the team's known name, not a URL from a feed/artifact.
    url = get_logo_url(team)
    if not url:
        return None
    try:
        with requests.get(url, timeout=(2, 3), stream=True, allow_redirects=False) as response:
            if response.status_code != 200 or response.headers.get("Content-Type", "").split(";")[0] != "image/png":
                return None
            max_bytes = 256 * 1024
            raw = BytesIO()
            for chunk in response.iter_content(chunk_size=16 * 1024):
                raw.write(chunk)
                if raw.tell() > max_bytes:
                    return None
            raw.seek(0)
        with Image.open(raw) as source:
            if source.format != "PNG" or max(source.size) > 1024:
                return None
            logo = source.convert("RGBA")
            logo.thumbnail((112, 112), Image.Resampling.LANCZOS)
            out = BytesIO()
            logo.save(out, format="PNG", optimize=True)
        return "data:image/png;base64," + b64encode(out.getvalue()).decode("ascii")
    except (requests.RequestException, OSError, ValueError):
        return None


def load_team_logos(teams: list[str]) -> dict[str, str | None]:
    names = list(dict.fromkeys(team for team in teams if get_team_abbr(team)))
    if not names:
        return {}
    with ThreadPoolExecutor(max_workers=min(10, len(names))) as pool:
        return dict(zip(names, pool.map(_logo_data_uri, names)))
