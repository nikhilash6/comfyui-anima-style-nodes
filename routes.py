from .routes_core import register_core_routes
from .routes_favorites import register_favorite_routes
from .routes_fullet import load_fullet_token, register_fullet_routes, require_local_token


def register(server):
    load_fullet_token()
    register_core_routes(server, require_local_token=require_local_token)
    register_favorite_routes(server, require_local_token=require_local_token)
    register_fullet_routes(server)
