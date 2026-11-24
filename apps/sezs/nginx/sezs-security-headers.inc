# SEZS Speakeasy security headers. Include from the SEZS server {} block.
# Not loaded by `include servers/*;` — applying this is a user decision.
#
# Exact line to add inside /opt/homebrew/etc/nginx/servers/sezs-lan.conf
# (once that server block is uncommented, listen 127.0.0.1:3050):
#
#     include /opt/homebrew/etc/nginx/sezs-security-headers.inc;
#
# Do not place this file in servers/ — that glob auto-applies on reload.
# Next `output: 'export'` cannot emit headers(); this is the origin header set.
#
# Nonce/hash: a CSP nonce needs nginx to rewrite Next's <script> tags
# (sub_filter / a body filter). That is a proxy body rewrite — not applied.
# A script-src hash would also disable 'unsafe-inline' in supporting browsers
# and break Next 13 runtime. Hashes/nonces are therefore not in script-src.

add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://127.0.0.1:19091 http://127.0.0.1:3050 http://127.0.0.1:3051 http://localhost:3050 http://localhost:3051 ws://127.0.0.1:3050 ws://127.0.0.1:3051 ws://localhost:3050 ws://localhost:3051 https://rpc.terp.network https://api.terp.network https://esm.sh https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
add_header X-DNS-Prefetch-Control "off" always;

# HSTS — TLS vhost only. Do not enable on HTTP loopback: Chrome can
# HSTS-upgrade 127.0.0.1 and brick the lab.
# add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
