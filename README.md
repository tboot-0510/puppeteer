# Puppeteer Microservice

A ready-to-deploy Puppeteer microservice built with Node.js and Docker, designed for AWS Lightsail deployment. This service provides REST API endpoints for web automation tasks including screenshot generation, PDF creation, and web scraping.

## Features

- 🖼️ **Screenshot Generation**: Capture full-page or viewport screenshots
- 📄 **PDF Generation**: Convert web pages or HTML content to PDF
- 🔍 **Web Scraping**: Extract content and data from web pages
- 🏥 **Health Monitoring**: Built-in health check endpoints
- 🐳 **Docker Ready**: Containerized with Docker and Docker Compose
- ☁️ **Cloud Deploy**: Optimized for AWS Lightsail deployment
- 🔒 **Security**: Non-root container execution and security headers
- 🚀 **Performance**: Nginx reverse proxy and resource optimization

## Quick Start

### Local Development

1. **Clone and Setup**
```bash
git clone <repository-url>
cd puppeteer
npm install
```

2. **Run with Docker Compose**
```bash
docker-compose up -d
```

3. **Test the Service**
```bash
# Health check
curl http://localhost:3000/health

# Generate screenshot
curl -X POST http://localhost:3000/screenshot \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  --output screenshot.png
```

### AWS Lightsail Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete deployment instructions.

## API Endpoints

### Health Check
```
GET /health
```
Returns service health status.

### Screenshot Generation
```
POST /screenshot
```
**Body:**
```json
{
  "url": "https://example.com",
  "options": {
    "viewport": {"width": 1200, "height": 800},
    "fullPage": true,
    "screenshotOptions": {
      "quality": 90
    }
  }
}
```

### PDF Generation
```
POST /pdf
```
**Body:**
```json
{
  "url": "https://example.com",
  "options": {
    "format": "A4",
    "printBackground": true,
    "margin": {
      "top": "1cm",
      "bottom": "1cm"
    }
  }
}
```

**Or with HTML content:**
```json
{
  "html": "<html><body><h1>Hello World</h1></body></html>",
  "options": {
    "format": "A4"
  }
}
```

### Web Scraping
```
POST /scrape
```
**Body:**
```json
{
  "url": "https://example.com",
  "selector": "h1, p, .content"
}
```

## Configuration

### Environment Variables

- `NODE_ENV`: Environment (production/development)
- `PORT`: Server port (default: 3000)

### Docker Compose Profiles

- **Default**: Basic service with health checks
- **Production**: Includes Nginx reverse proxy with SSL support

```bash
# Basic deployment
docker-compose up -d

# Production with Nginx
docker-compose --profile production up -d
```

## File Structure

```
├── server.js              # Main application server
├── package.json           # Node.js dependencies
├── Dockerfile             # Container configuration
├── docker-compose.yml     # Multi-container setup
├── nginx.conf             # Nginx reverse proxy config
├── .dockerignore          # Docker build exclusions
├── .env.example           # Environment variables template
├── DEPLOYMENT.md          # AWS Lightsail deployment guide
└── README.md             # This file
```

## Security Features

- Container runs as non-root user
- Security headers (helmet.js)
- Rate limiting (nginx)
- Resource limits and health checks
- No-new-privileges security option

## Performance Optimization

- Chrome process arguments optimized for containers
- Compression middleware
- Resource limits in docker-compose
- Nginx buffering and caching
- Shared memory size optimization for Chrome

## Development

### Local Development
```bash
npm run dev  # Start with nodemon for auto-reload
```

### Production Build
```bash
docker build -t puppeteer-microservice .
docker run -p 3000:3000 puppeteer-microservice
```

## Monitoring

### Health Checks
- Docker health checks every 30s
- HTTP health endpoint at `/health`
- Container restart policies

### Logging
```bash
# View service logs
docker-compose logs -f puppeteer-service

# View all logs
docker-compose logs -f
```

## Requirements

- Node.js 18+
- Docker & Docker Compose
- 1GB+ RAM (recommended 2GB+ for production)
- Chrome/Chromium dependencies (handled in Dockerfile)

## License

MIT License - see package.json for details.

## Support

For AWS Lightsail deployment issues, see [DEPLOYMENT.md](./DEPLOYMENT.md).
For API usage examples and troubleshooting, check the deployment guide.