import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.api import create_multi_app


def test_create_multi_app_mounts_all_example_domains():
    app = create_multi_app(
        ROOT / "domains",
        {
            "api_key": "sk-placeholder",
            "api_url": "http://localhost:8090/v1",
            "model": "dummy",
        },
    )

    domains_route = next(
        route for route in app.routes
        if getattr(route, "path", "") == "/domains"
    )
    domains = domains_route.endpoint()
    names = {domain["name"] for domain in domains}
    mounted_paths = {
        getattr(route, "path", "")
        for route in app.routes
        if getattr(route, "path", "").startswith("/d/")
    }

    assert {"drone", "fee", "hv_access", "icf"} <= names
    assert {
        "/d/drone",
        "/d/fee",
        "/d/hv_access",
        "/d/icf",
    } <= mounted_paths
