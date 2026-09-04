# Deploying NoteCraft

The whole stack runs on one host behind Caddy: Next.js, the API, Postgres, and
the Piston sandbox, on one domain.

## Why one host

The code sandbox decides the architecture. Piston builds its jails with Linux
namespaces and cgroups, which needs a privileged container — something Vercel,
Netlify, Railway, and Render all refuse, for good reason. Running untrusted
code requires a machine you control.

Once a VM is in the picture anyway, putting everything on it is the simpler
choice, and it buys a real security property: the browser talks to one origin,
so the auth cookie stays `SameSite=Lax`. A split deployment would need
`SameSite=None`, which attaches the cookie to cross-site requests and puts CSRF
defence back on our plate.

```
                    ┌─────────────────────── one VM ───────────────────────┐
  browser ──HTTPS──►│ Caddy ──┬─► web    (Next.js)                         │
                    │  :443   ├─► api    (Express + Socket.io) ──┬─► db     │
                    │         │                                  └─► piston │
                    └──────────────────────────────────────────────────────┘
                              Only Caddy publishes ports.
```

Postgres and Piston are reachable only on Docker's internal network. A sandbox
open to the internet is free compute for whoever finds it.

## Cost

| Item | Where | Cost |
| ---- | ----- | ---- |
| Domain | Cloudflare Registrar | ~$11/yr |
| VM (2 GB RAM, 2 vCPU, 60 GB SSD) | AWS Lightsail | $12/mo |
| TLS certificate | Let's Encrypt via Caddy | free |

About **$155 the first year**. A 1 GB instance ($7/mo) is not enough: compiling
C++ or Java in the sandbox will push it into the OOM killer.

## 1. Buy the domain

Cloudflare Registrar sells `.com` at cost with free DNS and WHOIS privacy.
Namecheap is fine too. Do not point DNS anywhere yet — there is nothing to
point at.

## 2. Create the VM

```bash
aws lightsail create-instances \
  --instance-names notecraft \
  --availability-zone us-east-1a \
  --blueprint-id ubuntu_24_04 \
  --bundle-id medium_3_0

# A static IP survives stop/start; the default public IP does not, and DNS
# pointing at a stale address is a confusing way to be down.
aws lightsail allocate-static-ip --static-ip-name notecraft-ip
aws lightsail attach-static-ip --static-ip-name notecraft-ip --instance-name notecraft

aws lightsail open-instance-public-ports \
  --instance-name notecraft --port-info fromPort=80,toPort=80,protocol=TCP
aws lightsail open-instance-public-ports \
  --instance-name notecraft --port-info fromPort=443,toPort=443,protocol=TCP

aws lightsail get-static-ip --static-ip-name notecraft-ip \
  --query 'staticIp.ipAddress' --output text
```

## 3. Point DNS at it

At the registrar, create two A records pointing at that IP:

| Type | Name | Value |
| ---- | ---- | ----- |
| A | `@` | the static IP |
| A | `www` | the static IP |

Wait until `dig +short yourdomain.com` returns the IP. **Caddy cannot get a
certificate before DNS resolves** — Let's Encrypt verifies control of the
domain by connecting to it.

## 4. Bootstrap the host

```bash
ssh ubuntu@<static-ip>
curl -fsSL https://raw.githubusercontent.com/laxmihatte/collab-editor/main/scripts/bootstrap-server.sh | bash
```

Installs Docker, enables a firewall allowing only SSH/80/443, adds 2 GB of
swap, and clones the repo. Log out and back in afterwards so your user picks up
the `docker` group.

## 5. Configure and deploy

```bash
cd ~/notecraft
cp .env.production.example .env.production

cat >> .env.production <<EOF
DOMAIN=yourdomain.com
POSTGRES_PASSWORD=$(openssl rand -base64 36)
JWT_SECRET=$(openssl rand -base64 36)
EOF

./scripts/deploy.sh
```

The first deploy downloads compilers into the Piston volume, which takes a few
minutes. Later deploys skip it.

## 6. Verify

```bash
curl https://yourdomain.com/api/health
API=https://yourdomain.com/api ./scripts/smoke-test.sh
```

Optionally seed the demo account:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec api node scripts/seed.js
```

## Updating

```bash
cd ~/notecraft && git pull && ./scripts/deploy.sh
```

Schema changes need their migration applied by hand — `schema.sql` only runs
when the database is first created:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T db psql -U notecraft -d notecraft < server/src/db/migrations/00X_name.sql
```

## Backups

The database is the only state that cannot be rebuilt from the repo.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T db pg_dump -U notecraft notecraft | gzip > notecraft-$(date +%F).sql.gz
```

Worth a cron entry and a copy to S3 once there is anything in there you would
be sad to lose.

## Operating notes

- **Logs:** `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api`
- **Certificate trouble:** almost always DNS. Confirm `dig +short yourdomain.com`
  matches the static IP, then check `logs caddy`.
- **Out of memory:** `free -h` and `docker stats`. If compiles are the cause,
  move to the 4 GB bundle.
- **Rate limits:** auth is capped at 20 attempts per 15 minutes per IP, and code
  execution at 30 runs per minute per user. Both are in the route files.
