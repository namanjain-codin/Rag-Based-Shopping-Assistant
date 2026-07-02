# ShopLens — Deployment Guide

## Repo structure

```
shoplens/
├── api.py              ← FastAPI backend (add CORS from api_with_cors.py)
├── worker.py
├── ingest.py
├── products.json
├── requirements.txt    ← use backend/requirements.txt (has uvicorn[standard])
├── start.sh            ← Render start command
├── src/
│   ├── main.jsx
│   └── App.jsx
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```

---

## Step 1 — Prep your repo

1. Create a single GitHub repo (`shoplens`).
2. Put ALL files (backend + frontend) in the root.
3. Add a `.env.example`:
   ```
   MISTRAL_API_KEY=your_key_here
   ```
4. Add `.env` to `.gitignore`.

---

## Step 2 — Deploy backend on Render

### 2a. Create a Web Service
- Go to https://render.com → New → Web Service
- Connect your GitHub repo
- **Runtime**: Python 3.11
- **Build command**: `pip install -r requirements.txt`
- **Start command**: `bash start.sh`
  - `start.sh` auto-runs `ingest.py` on first deploy, then starts uvicorn

### 2b. Set environment variables on Render
Under your service → Environment:
```
MISTRAL_API_KEY = sk-...your-key...
```

### 2c. Important: Persistent disk for FAISS index
Render free tier doesn't persist files between deploys.
Two options:
- **Option A (free)**: Commit `faiss_index/` and `docs_cache.json` to git after running
  `python ingest.py` locally. The start.sh checks if they exist and skips re-ingestion.
- **Option B (paid)**: Add a Render Disk (512 MB, ~$1/month) mounted at `/opt/render/project/src`
  so the FAISS index survives deploys.

**Recommended for your portfolio**: Use Option A — commit the index. It's ~2–5 MB.

### 2d. Copy your Render URL
After deploy it'll look like: `https://shoplens-api.onrender.com`

---

## Step 3 — Add CORS to api.py

Open `api.py` and:

1. Add import at top:
   ```python
   from fastapi.middleware.cors import CORSMiddleware
   ```

2. After `app = FastAPI(...)`, add:
   ```python
   app.add_middleware(
       CORSMiddleware,
       allow_origins=[
           "http://localhost:5173",
           "https://your-app.vercel.app",   # ← your Vercel URL (step 4)
       ],
       allow_credentials=True,
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

---

## Step 4 — Deploy frontend on Vercel

### 4a. Push frontend files
The frontend files (src/, index.html, package.json, vite.config.js, vercel.json)
should be in the root of your repo.

### 4b. Import on Vercel
- Go to https://vercel.com → New Project → Import your GitHub repo
- Framework: **Vite** (auto-detected)
- Build command: `npm run build`
- Output directory: `dist`

### 4c. Set environment variable on Vercel
Under Project → Settings → Environment Variables:
```
VITE_API_URL = https://shoplens-api.onrender.com
```
(This is the Render URL from Step 2d)

### 4d. Deploy
Click Deploy. Vercel builds in ~30 seconds.
Your frontend URL: `https://shoplens.vercel.app` (or similar)

---

## Step 5 — Wire CORS back in

Now that you have your Vercel URL, go back to `api.py` and update `allow_origins`
with the real URL. Commit and push — Render redeploys automatically.

---

## Step 6 — Local dev workflow

```bash
# Terminal 1 — backend
uvicorn api:app --reload --port 8000

# Terminal 2 — frontend
npm install
npm run dev     # runs on http://localhost:5173
```

`vite.config.js` proxies `/api/*` → `localhost:8000` in dev.
In dev, `VITE_API_URL` defaults to `http://localhost:8000` (see App.jsx line 1).

---

## Render free tier caveats

- **Spin-down**: Free instances sleep after 15 min of inactivity. First request after sleep
  takes ~30s (cold start). This is normal — acceptable for a portfolio project.
- **Tip for interviews**: Keep the tab open or use https://uptimerobot.com (free) to ping
  your API every 10 minutes to keep it warm.

---

## Checklist

- [ ] `faiss_index/` and `docs_cache.json` committed (run `python ingest.py` locally first)
- [ ] `MISTRAL_API_KEY` set on Render
- [ ] CORS `allow_origins` includes your Vercel URL
- [ ] `VITE_API_URL` set on Vercel pointing to Render
- [ ] `/health` endpoint returns `"status": "healthy"` on Render
- [ ] Frontend loads and can call `/recommend`
