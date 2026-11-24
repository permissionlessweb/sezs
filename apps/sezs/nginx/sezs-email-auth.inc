# SEZS self-hosted email auth edge limits + reverse proxy (single nginx only).
# Include the zone directives in http {} and the location / upstream in the
# existing SEZS server {} block (never add a second reverse proxy).
#
# In http {}:
#   limit_req_zone $binary_remote_addr zone=sezs_email_req:10m rate=6r/m;
#   limit_req_zone $binary_remote_addr zone=sezs_email_verify:10m rate=12r/m;
#   limit_conn_zone $binary_remote_addr zone=sezs_email_conn:10m;
#
#   upstream sezs_email_auth {
#     server 127.0.0.1:3058 max_fails=3 fail_timeout=10s;
#     # Add additional local workers on 127.0.0.1:3059, 3060, ... for horizontal scaling.
#     keepalive 16;
#   }
#
# Inside server {}:
#   include /path/to/apps/sezs/nginx/sezs-email-auth.inc;

location = /sezs/auth/email/request {
  limit_req zone=sezs_email_req burst=4 nodelay;
  limit_conn sezs_email_conn 5;
  limit_req_status 429;
  client_max_body_size 4k;
  client_body_timeout 5s;
  proxy_read_timeout 5s;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_pass http://sezs_email_auth;
}

location ^~ /sezs/auth/email/ {
  limit_req zone=sezs_email_verify burst=10 nodelay;
  limit_conn sezs_email_conn 10;
  limit_req_status 429;
  client_max_body_size 4k;
  client_body_timeout 5s;
  proxy_read_timeout 5s;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_pass http://sezs_email_auth;
}
