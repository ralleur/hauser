# Hauser

Hauser is a calm, visual frontend for Home Assistant. This App is a thin packaging layer around the regular multi-architecture Hauser image and uses the existing setup wizard.

After installation, start the App and choose **Open Web UI**. Enter the Home Assistant URL that is reachable from both your browser and the Hauser App, then provide a dedicated Long-Lived Access Token. Optional Jellyfin setup can be skipped.

The first App release uses a direct LAN port instead of Home Assistant Ingress. Keep the port on a trusted home network and do not expose it directly to the public internet.

See **Documentation** in the App Store for installation, persistence, backup/restore and current limitations. Docker and Compose remain fully supported for Home Assistant Container and other self-hosted installations.
