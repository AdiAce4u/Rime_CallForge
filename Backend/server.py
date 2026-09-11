"""
Server proxy executing the unified backend in final.py.
"""
from final import app

if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"Starting Saarthi Unified Voice Agent via server.py on http://localhost:{port}")
    uvicorn.run("final:app", host=host, port=port, reload=True)
