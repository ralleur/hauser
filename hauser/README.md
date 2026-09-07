# Hauser

Hauser is a calm, visual frontend for Home Assistant, made for wall panels and
phones. This App is a thin packaging layer around the regular multi-architecture
Hauser image and uses the existing guided setup wizard.

After installation, start the App and choose **Open Web UI**. The App connects to
Home Assistant itself: it declares `homeassistant_api` and the Hauser server
talks to Home Assistant Core over the internal Supervisor endpoints. You do not
enter a Home Assistant URL and no Long-Lived Access Token, and no Home Assistant
credential is stored in `/data` or handed to the browser. Optional Jellyfin setup
can be skipped. The wizard ends by showing the address phones and tablets use.

This packaging deliberately uses a direct LAN port instead of Home Assistant
Ingress. That port has no separate Hauser login and no device pairing: every
device that reaches it can operate Hauser. Keep it on a trusted home network and
do not expose it to the public internet.

See **Documentation** in the App Store for setup, persistence, backup/restore,
the security boundary and current limitations. Docker and Compose remain fully
supported for Home Assistant Container and other self-hosted installations.
