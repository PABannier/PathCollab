#!/bin/bash

# PathCollab Let's Encrypt Certificate Initialization Script
# This script bootstraps SSL certificates for the first deployment

set -e

# Configuration - Update these for your deployment
DOMAINS="${DOMAINS:-example.com}"
EMAIL="${EMAIL:-admin@example.com}"
STAGING="${STAGING:-0}"  # Set to 1 for testing to avoid rate limits
RSA_KEY_SIZE=4096
DATA_PATH="./certbot"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if docker compose is available
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
elif docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    echo_error "Docker Compose is not installed. Please install it first."
    exit 1
fi

# Validate required environment variables
if [ "$DOMAINS" = "example.com" ]; then
    echo_error "Please set the DOMAINS environment variable"
    echo "Example: DOMAINS=pathcollab.example.com ./scripts/init-letsencrypt.sh"
    exit 1
fi

if [ "$EMAIL" = "admin@example.com" ]; then
    echo_warn "Using default email. Set EMAIL environment variable for certificate expiry notifications."
fi

echo_info "Starting Let's Encrypt certificate initialization..."
echo_info "Domain(s): $DOMAINS"
echo_info "Email: $EMAIL"
echo_info "Staging: $STAGING"

# Create required directories
echo_info "Creating certificate directories..."
mkdir -p "$DATA_PATH/conf/live/pathcollab"
mkdir -p "$DATA_PATH/www"

# Download recommended TLS parameters if they don't exist
if [ ! -e "$DATA_PATH/conf/options-ssl-nginx.conf" ]; then
    echo_info "Downloading recommended TLS parameters..."
    curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$DATA_PATH/conf/options-ssl-nginx.conf"
fi

if [ ! -e "$DATA_PATH/conf/ssl-dhparams.pem" ]; then
    echo_info "Downloading DH parameters..."
    curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$DATA_PATH/conf/ssl-dhparams.pem"
fi

# Create dummy certificate for initial nginx startup
echo_info "Creating dummy certificate for nginx startup..."
CERT_PATH="/etc/letsencrypt/live/pathcollab"

$DOCKER_COMPOSE run --rm --entrypoint "\
    openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 \
    -keyout '$CERT_PATH/privkey.pem' \
    -out '$CERT_PATH/fullchain.pem' \
    -subj '/CN=localhost'" certbot

echo_info "Starting nginx with dummy certificate..."
$DOCKER_COMPOSE up --force-recreate -d nginx

echo_info "Waiting for nginx to start..."
sleep 5

# Delete dummy certificate
echo_info "Removing dummy certificate..."
$DOCKER_COMPOSE run --rm --entrypoint "\
    rm -rf /etc/letsencrypt/live/pathcollab && \
    rm -rf /etc/letsencrypt/archive/pathcollab && \
    rm -rf /etc/letsencrypt/renewal/pathcollab.conf" certbot

# Request real certificate
echo_info "Requesting Let's Encrypt certificate..."

# Build domain arguments
DOMAIN_ARGS=""
for domain in $DOMAINS; do
    DOMAIN_ARGS="$DOMAIN_ARGS -d $domain"
done

# Select staging or production
if [ "$STAGING" != "0" ]; then
    STAGING_ARG="--staging"
    echo_warn "Using Let's Encrypt staging environment (certificates won't be trusted)"
else
    STAGING_ARG=""
fi

# Request the certificate
$DOCKER_COMPOSE run --rm --entrypoint "\
    certbot certonly --webroot -w /var/www/certbot \
    $STAGING_ARG \
    --email $EMAIL \
    $DOMAIN_ARGS \
    --rsa-key-size $RSA_KEY_SIZE \
    --agree-tos \
    --force-renewal \
    --cert-name pathcollab" certbot

# Reload nginx to use the new certificate
echo_info "Reloading nginx with real certificate..."
$DOCKER_COMPOSE exec nginx nginx -s reload

echo_info "Certificate initialization complete!"
echo ""
echo_info "Your PathCollab instance should now be accessible via HTTPS."
echo_info "Certificates will auto-renew via the certbot container."
echo ""

if [ "$STAGING" != "0" ]; then
    echo_warn "You used staging certificates. For production, run again with STAGING=0"
fi

echo_info "To verify, run: curl -I https://$DOMAINS"
