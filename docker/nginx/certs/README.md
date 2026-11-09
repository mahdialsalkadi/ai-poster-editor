# TLS certificates

`docker-compose.yml` mounts this directory read-only at `/etc/nginx/certs`.
The proxy expects exactly two files:

- `fullchain.pem` — the leaf certificate followed by its intermediates.
- `privkey.pem` — the matching private key, unencrypted.

Neither file is tracked by git; only this README is.

For a public host, obtain the pair from your certificate authority (or a tool
such as certbot) and copy it here. Renewal is not automated by this compose
file: either rerun the issuance tool and reload the proxy, or mount a directory
managed by the tool.

For a local smoke test only, a self-signed certificate is enough:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -keyout privkey.pem -out fullchain.pem \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

The browser will warn about the self-signed certificate. Do not use it for a
public deployment.
