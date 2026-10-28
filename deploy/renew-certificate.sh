#!/bin/sh
set -eu
if [ "${1:-}" = "--dry-run" ]; then
  docker run --rm \
    -v /opt/1panel/www/letsencrypt:/etc/letsencrypt \
    -v /opt/1panel/www/hajistudy-acme:/var/www/certbot \
    certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20 \
    renew --dry-run --non-interactive --no-random-sleep-on-renew --webroot --webroot-path /var/www/certbot
  exit
fi
docker run --rm \
  -v /opt/1panel/www/letsencrypt:/etc/letsencrypt \
  -v /opt/1panel/www/hajistudy-acme:/var/www/certbot \
  certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20 renew --quiet --no-random-sleep-on-renew --webroot --webroot-path /var/www/certbot \
  --deploy-hook 'touch /etc/letsencrypt/.hajimark-reload'
if [ -f /opt/1panel/www/letsencrypt/.hajimark-reload ]; then
  docker exec 1Panel-openresty-VndB nginx -t
  docker exec 1Panel-openresty-VndB nginx -s reload
  rm /opt/1panel/www/letsencrypt/.hajimark-reload
fi
