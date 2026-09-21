import pytest
import asyncio


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
def clear_scan_cache():
    """Isolate in-process cache between tests."""
    import src.routers.scan as scan_module
    scan_module._local_cache.clear()
    yield
    scan_module._local_cache.clear()
