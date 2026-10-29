from fastapi import FastAPI

app = FastAPI(title="cupom-fiscal ai")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
