# AWS Lightsail Deployment Guide

This guide will help you deploy the Puppeteer microservice on AWS Lightsail.

## Prerequisites

- AWS account with Lightsail access
- Basic understanding of Docker and Docker Compose
- SSH key pair for server access

## Quick Start

### 1. Create Lightsail Instance

1. Go to [AWS Lightsail Console](https://lightsail.aws.amazon.com/)
2. Click "Create Instance"
3. Choose "Linux/Unix" platform
4. Select "Ubuntu 22.04 LTS" blueprint
5. Choose instance plan (recommended: $10/month or higher for better performance)
6. Add your SSH key
7. Name your instance (e.g., "puppeteer-microservice")
8. Click "Create Instance"

### 2. Connect to Your Instance

```bash
ssh -i your-key.pem ubuntu@YOUR_INSTANCE_IP
```

### 3. Install Docker and Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login to apply docker group changes
logout
```

### 4. Deploy the Application

```bash
# Clone or upload your code
git clone <your-repo-url>
cd puppeteer

# Or upload files manually
# scp -i your-key.pem -r . ubuntu@YOUR_INSTANCE_IP:~/puppeteer/

# Build and run
docker-compose up -d

# Check logs
docker-compose logs -f
```

### 5. Configure Firewall

In Lightsail console:
1. Go to your instance → Networking tab
2. Add firewall rules:
   - HTTP: Port 80
   - HTTPS: Port 443 (if using SSL)
   - Custom: Port 3000 (for direct API access)

### 6. Test Your Service

```bash
# Health check
curl http://YOUR_INSTANCE_IP/health

# Test screenshot endpoint
curl -X POST http://YOUR_INSTANCE_IP/screenshot \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  --output screenshot.png
```

## Production Deployment with SSL

### 1. Use Production Profile

```bash
# Deploy with Nginx reverse proxy
docker-compose --profile production up -d
```

### 2. Setup SSL Certificate

```bash
# Install Certbot
sudo apt install certbot

# Generate SSL certificate
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates
sudo mkdir -p /home/ubuntu/puppeteer/ssl
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem /home/ubuntu/puppeteer/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem /home/ubuntu/puppeteer/ssl/
sudo chown -R ubuntu:ubuntu /home/ubuntu/puppeteer/ssl
```

### 3. Update Nginx Configuration

Add SSL configuration to `nginx.conf`:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    
    # ... rest of configuration
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

## Performance Optimization

### 1. Instance Sizing

- **Development**: $5/month (512 MB RAM, 1 vCPU)
- **Light Production**: $10/month (1 GB RAM, 1 vCPU)
- **Production**: $20/month (2 GB RAM, 1 vCPU) - Recommended
- **High Traffic**: $40/month (4 GB RAM, 2 vCPUs)

### 2. Memory Management

```bash
# Monitor memory usage
docker stats

# If running out of memory, add swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 3. Auto-restart on Boot

```bash
# Create systemd service
sudo tee /etc/systemd/system/puppeteer.service > /dev/null <<EOF
[Unit]
Description=Puppeteer Microservice
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=true
WorkingDirectory=/home/ubuntu/puppeteer
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF

# Enable service
sudo systemctl daemon-reload
sudo systemctl enable puppeteer.service
```

## Monitoring and Maintenance

### 1. Health Monitoring

```bash
# Check service status
curl http://localhost/health

# View logs
docker-compose logs --tail=100 -f puppeteer-service
```

### 2. Backup Strategy

```bash
# Create backup script
cat > backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker-compose down
tar -czf puppeteer_backup_$DATE.tar.gz .
docker-compose up -d
EOF

chmod +x backup.sh

# Schedule weekly backups
(crontab -l 2>/dev/null; echo "0 2 * * 0 /home/ubuntu/puppeteer/backup.sh") | crontab -
```

### 3. Updates

```bash
# Update and redeploy
git pull origin main
docker-compose pull
docker-compose up -d --force-recreate
```

## Troubleshooting

### Common Issues

1. **Out of Memory**: Increase instance size or add swap
2. **Chrome Crashes**: Ensure sufficient RAM and proper Docker arguments
3. **Timeout Errors**: Increase timeout values in nginx.conf
4. **Permission Issues**: Check container user permissions

### Debug Commands

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs puppeteer-service

# Access container shell
docker exec -it puppeteer-microservice /bin/bash

# Check system resources
htop
df -h
free -h
```

## Security Considerations

1. **Firewall**: Only open necessary ports
2. **Updates**: Regularly update system packages
3. **SSL**: Always use HTTPS in production
4. **API Security**: Consider adding authentication
5. **Container Security**: Run containers as non-root user (already configured)

## API Usage Examples

### Screenshot
```bash
curl -X POST http://your-server/screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "viewport": {"width": 1200, "height": 800},
      "fullPage": true
    }
  }' --output screenshot.png
```

### PDF Generation
```bash
curl -X POST http://your-server/pdf \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "format": "A4",
      "printBackground": true
    }
  }' --output document.pdf
```

### Web Scraping
```bash
curl -X POST http://your-server/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "selector": "h1, p"
  }'
```