---
title: Remote access
description: Set up private Tailscale access on your home server and phone, or choose Hauser's separate experimental paired Funnel path.
sidebar:
  order: 9
---

For a first installation, use a private Tailscale connection between the home
server and your phone. Hauser also has a separate experimental Funnel path for
paired devices. Choose one route deliberately; both use Tailscale, but they
have different access boundaries.

For guided setup, give your agent the
[beginner setup guide](/docs/getting-started/agent-guided-setup/).

## Choose a route

| Route | Who can reach it | Phone needs |
| --- | --- | --- |
| Private Tailscale | Devices allowed by your tailnet policy | Tailscale installed, signed in and connected; browser or paired native Hauser app. |
| Hauser's experimental Funnel | A public HTTPS endpoint; Hauser requires a paired device token for protected routes | A paired client; the Tailscale phone app is not required for this route. |

Neither route needs router port forwarding. A Home Assistant Cloud URL or the
Tailscale App's option for sharing Home Assistant does not automatically expose
Hauser's separate port.

## Private access with Tailscale

These steps assume Home Assistant OS and Hauser installed as its App on the
same host. Keep the home-network connection open during setup. An agent should
walk through each step and check its result before continuing.

### 1. Create or choose the Tailscale account

Open [Tailscale's start page](https://tailscale.com/start). The user selects a
supported sign-in provider and completes registration and any verification
privately. If an account already exists, use its intended home network, called
a **tailnet**. Check the selected plan and current terms before accepting any
paid option; do not assume a fixed free allowance.

Use the same account and tailnet for the home server and the user's phone.
Other household members should use their own invited identities rather than
share passwords. See the [Tailscale quickstart](https://tailscale.com/docs/how-to/quickstart).

**Check:** the user can open the Tailscale admin console and identify the
intended tailnet. Account creation alone has not connected the home server.

### 2. Connect the Home Assistant host

In **Settings → Apps → App Store**, find **Tailscale** from Home Assistant
Community Apps. If that repository is absent, add
`https://github.com/hassio-addons/repository` in the store's Repositories menu.
This is the community App, not the HA integration that monitors Tailscale.

Install and start it, then open its Web UI and sign in to the chosen tailnet.
Complete any device approval in the Tailscale console. Check its status and
only the relevant, redacted log lines if authentication fails.

For direct access to host ports, check these options against the installed
App's documentation:

```yaml
userspace_networking: false
share_homeassistant: disabled
advertise_routes: []
advertise_exit_node: false
```

Change only the necessary values, then restart the App. This route needs no
Funnel, subnet routes or exit node. See the
[App documentation](https://github.com/hassio-addons/app-tailscale/blob/main/tailscale/DOCS.md)
and [configuration defaults](https://github.com/hassio-addons/app-tailscale/blob/main/tailscale/config.yaml).

**Check:** the host appears connected in the console. Record its Tailscale IP
from that console; do not substitute the phone's IP or invent an address.
Enable start on boot for the App. Check the host's key-expiry status and agree
how to renew it before it expires; avoid silently changing expiry policy.

### 3. Connect the phone

On **iPhone or iPad**, install Tailscale from the App Store. Open it, accept
the system's VPN-configuration prompt, sign in to the same account and select
the home tailnet. On **Android**, install it from Google Play, accept the VPN
prompt, and sign in to the same account and tailnet. Turn the connection on.
The user handles device passcodes, sign-in and verification privately.

Use the current [iOS instructions](https://tailscale.com/docs/install/ios) or
[Android instructions](https://tailscale.com/docs/install/android) if the
screens differ. Check any other active VPN if it prevents Tailscale connecting.

**Check:** the phone and home server both appear connected in the intended
tailnet. Do not assume that installing the phone app enabled the VPN.

### 4. Open Hauser through the private connection

Open `http://YOUR_HA_TAILSCALE_IP:4173` in the phone's browser, replacing the
placeholder with the host IP shown in the console. The usual HA address on
port `8123` opens Home Assistant, not Hauser. Tailscale encrypts traffic between
its devices even when this private URL uses HTTP.

:::caution[Decide who may control the home]
The direct Hauser web port has no separate login. A tailnet device permitted
to reach it can operate the home. Check the tailnet's
[access policy](https://tailscale.com/kb/1538/grants-syntax) and restrict access
to the intended household identities/devices and host ports before inviting
others. Existing broad allow rules still apply when you add a narrow rule.
Never forward port `4173` through the router or publish it with a generic Funnel.
:::

For native Hauser on iPhone/iPad, keep its LAN address and add the tested
private Hauser URL under **Settings → Connections → Services → Remote access →
Own address** in the web interface. This field records an address; it does not
create a tunnel. Generate a new pairing code afterwards and pair the phone
again on the home network so it receives that remote address. Existing pairing
data does not automatically acquire a new address. Test the native app as well
as the browser. If the client rejects that URL, record the failure and check
the installed client's network requirements rather than disabling OS security.

**Check:** the agreed safe device or reading works over the Tailscale address.

### 5. Test away from Wi-Fi

Turn **Wi-Fi off** on the phone, leave mobile data and Tailscale on, and open
the private Hauser URL again. Operate the agreed test device and restore its
starting state, or check a current sensor reading. Repeat in the native app
if that is the chosen client. Then restore Wi-Fi.

If it fails, check the phone's VPN connection, both devices' tailnet and online
status, the host IP and port, and policy permissions. If Home Assistant opens
but Hauser does not, check Hauser is running and its port is reachable. Fix
that failure before changing routes or re-pairing again.

**Done:** record the mobile-data result and date for each chosen client. The
private route needs Tailscale connected whenever the phone is away from home.
To remove access for a lost phone, remove that device in Tailscale; also revoke
its Hauser pairing if it used the native app. Keep account recovery information
privately with the user.

### If Hauser runs on a separate Docker host

Install Tailscale on that host using the
[official instructions](https://tailscale.com/docs/how-to/quickstart), not only
on the Home Assistant host. Follow Hauser's
[Compose network settings](/docs/getting-started/docker-compose/),
using the exact addresses and origins required by the clients. In Compose's
direct connection mode the browser must also reach Home Assistant over the
VPN. Verify both hosts and their relevant ports before testing controls. Do
not assume a VPN on one machine routes the whole LAN. Reuse an existing
installation rather than moving it into Home Assistant OS for this guide.

## Experimental Hauser Funnel

Hauser can publish a paired-client endpoint through Tailscale Funnel. This is
separate from installing the Tailscale Community App above. Only use this path
when the user has chosen a public endpoint protected by Hauser's device tokens.

### How it works

- The image ships a small sidecar (`hauser-tunnel`). It joins your tailnet as a userspace node and publishes Hauser as `https://<hostname>.<tailnet>.ts.net`.
- Every forwarded request is marked as remote. The Hauser server then requires a device token from [pairing](/docs/integrations/companion-app/). Without a token only health and build info answer.
- The panel and the LAN keep working as before if the sidecar is missing.

### Setup

**Settings → Connections → Services → Remote access**:

1. **Sign in to Tailscale** with Google, Apple, Microsoft or GitHub. Open the link or scan the QR code.
2. Approve HTTPS certificates and Funnel once in the Tailscale console. Hauser keeps retrying.
3. The card shows **Active at ...** with the address.

**Own address** replaces the tunnel in the pairing code if Hauser is already reachable through your own reverse proxy.

### Environment

| Variable | Purpose |
|---|---|
| `HMI_TUNNEL_BIN` | Path to the sidecar binary. Set in the image. |
| `HMI_TUNNEL_STATE` | State directory. Default `tunnel/` next to `config.json`. |
| `HMI_REMOTE_URL` | Your own public address instead of the tunnel. |
