# PathCollab Quick Start Guide

Get PathCollab running in under 5 minutes.

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- 4GB RAM minimum

## Step 1: Clone and Setup

```bash
git clone https://github.com/PABannier/PathCollab.git
cd pathcollab
```

## Step 2: Add Your Slides

Create a directory for your whole-slide images:

```bash
mkdir -p data/slides
```

Copy your WSI files (`.svs`, `.ndpi`, `.tiff`, etc.) to `data/slides/`.

For testing without real slides, the demo mode will use placeholder tiles.

## Step 3: Start the Services

```bash
docker-compose up -d
```

This starts three services:
- **web** (http://localhost:3000) - Frontend application
- **server** (http://localhost:8080) - Backend API
- **wsistreamer** (http://localhost:3001) - Tile server

## Step 4: Access PathCollab

Open http://localhost:3000 in your browser.

- Click **Try Demo** to explore with sample data
- Click **Create Session** to start a new collaborative session

## Basic Usage

### Creating a Session

1. Navigate to the home page
2. Click "Create Session"
3. Enter a slide ID (filename without extension)
4. Share the generated URL with collaborators

### Joining a Session

1. Open the shared session URL
2. You'll automatically join as a follower
3. Click "Follow Presenter" to sync with the presenter's view

### Uploading Overlays

1. As the presenter, click "Upload Overlay"
2. Select a protobuf overlay file (.pb)
3. Once loaded, use the layer panel to toggle visibility

## Stopping the Services

```bash
docker-compose down
```

## Next Steps

- Read the full [README.md](README.md) for configuration options
- See [.env.example](.env.example) for environment variables
- Check the [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for architecture details

## Troubleshooting

**Services won't start:**
```bash
docker-compose logs -f
```

**Tiles not loading:**
- Ensure your slides are in `data/slides/`
- Check WSIStreamer logs: `docker-compose logs wsistreamer`

**WebSocket connection fails:**
- Verify server is healthy: `curl http://localhost:8080/health`
- Check for port conflicts on 3000, 8080, 3001
