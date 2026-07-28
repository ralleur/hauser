# Security

## Scope and expectations

Hauser is a personal hobby project, published as a reference implementation. It
carries **no service level agreement, no guaranteed response time, and no
security support commitment**. Please calibrate your expectations accordingly
before deploying it anywhere that matters.

It is designed to run on a trusted home LAN, talking to a Home Assistant
instance you control. It has not been audited, and it is not hardened for
exposure to the public internet. Do not put it on a public address without
putting your own authentication in front of it.

## Reporting a vulnerability

Please report security issues privately rather than in a public issue:

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  on this repository (Security → Report a vulnerability).

Please include what you found, how to reproduce it, and what an attacker could
achieve. I will confirm receipt when I can, but I cannot promise a timeline.

## Things worth knowing

- The optional companion server (`app/server.mjs`) holds API tokens for
  upstream services server-side and exposes a PIN-protected document view. That
  PIN is a convenience lock for a wall-mounted tablet, not an authentication
  system. Treat it as such.
- Home Assistant is reached with a long-lived access token. That token grants
  broad control of your home. Keep it out of version control, and prefer a
  dedicated token you can revoke. In the Compose installation, connection
  settings are stored in the `/data` volume; backups of that volume must be
  treated as secrets.
- The container runs as an unprivileged user with a read-only root filesystem,
  dropped Linux capabilities and three writable persistent volumes. Those
  controls reduce accidental damage; they do not make the application safe for
  direct public-internet exposure.
- `GET /api/health` deliberately requires no authentication so the container
  runtime can probe it. It returns readiness metadata and the first config issue,
  never credentials or configuration values.
- There is no telemetry, no analytics, and no outbound connection other than to
  the backends you configure yourself.
