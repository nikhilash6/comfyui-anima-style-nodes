import os

from aiohttp import web

from . import artist_data


def register_core_routes(server, require_local_token=None):
    try:
        img_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "js", "images"))
        os.makedirs(img_path, exist_ok=True)
        server.instance.app.router.add_static("/anima/images/", img_path, show_index=False, follow_symlinks=False)
        print(f" [AnimaStyleExplorer] Static route registered: /anima/images/ -> {img_path}")
    except Exception as e:
        print(f" [AnimaStyleExplorer] Static route error: {e}")

    @server.instance.routes.get("/anima/test")
    async def test_route(request):
        return web.json_response({"status": "ok", "message": "Anima routes are active"})

    @server.instance.routes.get("/anima/artists")
    async def get_artists(request):
        return web.json_response(artist_data.load())

    @server.instance.routes.get("/anima/random")
    async def get_random(request):
        artist = artist_data.pick_random()
        if not artist:
            return web.json_response({"error": "No artists loaded"}, status=404)
        return web.json_response(artist)

    @server.instance.routes.post("/anima/update")
    async def update_artists(request):
        if require_local_token is not None:
            denied = require_local_token(request)
            if denied is not None:
                return denied
        success = artist_data.download()
        return web.json_response({"success": success})

    @server.instance.routes.post("/anima/download_images")
    async def download_images(request):
        if require_local_token is not None:
            denied = require_local_token(request)
            if denied is not None:
                return denied
        success = artist_data.start_image_download()
        return web.json_response({"success": success})

    @server.instance.routes.get("/anima/download_status")
    async def download_status(request):
        return web.json_response(artist_data.get_download_status())

