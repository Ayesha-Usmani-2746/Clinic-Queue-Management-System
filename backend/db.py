from dotenv import load_dotenv
import os

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

_client = None

def _create_client():
    # Monkey-patch httpx.Client and AsyncClient to ignore 'proxy' kwarg
    import httpx
    _orig_client_init = httpx.Client.__init__
    _orig_async_init  = httpx.AsyncClient.__init__

    def _patched_client(*args, **kwargs):
        kwargs.pop('proxy', None)
        return _orig_client_init(*args, **kwargs)

    def _patched_async(*args, **kwargs):
        kwargs.pop('proxy', None)
        return _orig_async_init(*args, **kwargs)

    httpx.Client.__init__      = _patched_client
    httpx.AsyncClient.__init__ = _patched_async

    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def get_db():
    global _client
    if _client is None:
        _client = _create_client()
    return _client

def reset_db():
    global _client
    _client = None
    return get_db()