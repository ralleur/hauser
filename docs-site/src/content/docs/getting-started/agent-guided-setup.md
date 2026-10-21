---
title: Set up with your AI agent
description: Let your agent guide you from your first Home Assistant installation to Hauser, a complete energy setup, phones and optional private remote access.
sidebar:
  order: 0
---

You can start here with no Home Assistant experience. Give this page to your
AI agent. It asks what you already have, does the work its tools allow, and
guides you through the remaining steps, one at a time. You do not need to read
the whole wiki first.

This is a guide for an agent you already use, not a built-in Hauser installer
or a promise that every chat service can control your computer. Accounts,
physical connections and phone permissions still need your participation.

## Give your agent this message

```text
Set up Hauser with me using this guide:
https://hauserhome.app/docs/getting-started/agent-guided-setup/
Start from what I already have. Follow the guide's agent instructions,
explain unfamiliar words, and take me through one step at a time.
```

You can ask in your own language. For example:

```text
Führe mit mir die Hauser-Einrichtung nach dieser Anleitung durch:
https://hauserhome.app/docs/getting-started/agent-guided-setup/
Ich fange bei null an. Leite mich Schritt für Schritt in Deutsch an.
```

## Instructions for the agent

Read this page before starting. Open the linked instructions for the current
stage yourself; do not hand the user a reading list. Follow the user's goals
and permissions. This page supplies a workflow, not permission to buy hardware,
erase disks, expose services publicly or operate unrelated devices.

1. **Use the user's language.** Explain Home Assistant as the system connecting
   devices, and Hauser as the household interface. Explain an integration, an
   entity and an Area only when each first becomes relevant.
2. **Ask one question at a time.** Start with: “Do you already have Home
   Assistant running, do you have hardware for it, or are you starting without
   either?” Offer “I don't know” and help identify the answer. Collect the
   phone type and remote-access preference when their stages begin.
3. **Check your actual capabilities.** Identify available browser, local
   execution and Home Assistant tools. Explain what you can do directly. A
   cloud chat cannot reach a private home address just because it knows a
   token. Do not invent tool connections or successful actions.
4. **Work in small steps.** For each step give a short reason, perform the
   authorized action or give one concrete user action, then check the result.
   Wait for the user when the next step depends on their action. Continue
   routine work with your tools without asking for approval on every click.
5. **Keep credentials out of conversation.** Users enter passwords, recovery
   keys and tokens directly in the relevant application or a supported secure
   credential field. Never request them in chat, screenshots, command output
   or a progress note. If no secure API connection is available, use the
   browser or guided user actions.
6. **Respect an existing home.** Identify the installation and version before
   changing it. Keep working integrations, names and rooms. Back up before
   changing an existing installation. Ask before overwriting storage or
   resetting anything. Agree on a harmless test device before operating it.
7. **Verify each milestone.** Record whether the result was observed through
   tools or reported by the user. An installed package is not proof that a
   light works or that remote access works. On failure, solve the current
   problem before continuing; do not reinstall everything as a first remedy.
8. **Keep a resumable checkpoint.** At each milestone update the short record
   below. If the conversation ends, the user can keep it and give it to a new
   agent with this same link. On resume, confirm the current state and continue
   at the first unfinished stage. Never recreate accounts or reinstall a
   working system just to repeat the guide.

The default route for a new Home Assistant household is **Home Assistant OS →
Hauser App → one working room → energy devices and mapping → phone → optional private Tailscale access →
backup and handover**. Existing Container installations use the Compose branch.
If the user only wants Apple Home on iPhone or iPad, follow the
[native app guide](/docs/integrations/companion-app/#apple-home) instead;
there is no reason to install Home Assistant for that path.

## Stage 1 — Find a home for Home Assistant

**Start with:** the hardware the user owns, and whether Home Assistant already
opens in a browser.

For an existing installation, open **Settings → System → Repairs → System
information** and identify its installation type and architecture. Reuse it.
Hauser's server packages support `amd64` and `aarch64`.

For a new installation, use the [official installation selector](https://www.home-assistant.io/installation/)
to pick the instructions for the exact hardware. Prefer Home Assistant OS for
a beginner. Home Assistant Green comes with it installed; supported Raspberry
Pi and x86-64 hardware need their matching installation steps. Container has
no App Store and requires separate host administration. Explain the selected
route and any hardware needed before the user commits to it.

Walk through that hardware's guide together: prepare storage if required,
connect the network and power, boot, then open the setup page. Before writing
an OS image, identify the exact target disk and obtain confirmation that its
contents may be erased. The agent cannot plug in hardware for the user.

**Done when:** Home Assistant's welcome page or the user's existing dashboard
opens. If it does not, check power, network connection and the address from
the router before changing anything else. Record the working local address.

## Stage 2 — Create the household's Home Assistant

**Start with:** a reachable Home Assistant. Skip completed onboarding.

Follow [Home Assistant onboarding](https://www.home-assistant.io/getting-started/onboarding/)
one screen at a time. Usually the initial address is
`http://homeassistant.local:8123/`; if name resolution fails, use the host's LAN
IP address with port `8123`. Initial preparation can take 20 minutes or more.

The user creates and saves their owner login privately, enters their location,
checks time zone and units, and chooses whether to share analytics. Explain
that this owner account belongs to their local Home Assistant installation;
Tailscale, if chosen later, uses a separate account.

**Done when:** the real dashboard opens and the user has saved their login.
If preparation is still running, wait and check its status instead of starting
over. For an existing installation, create a backup before proceeding with
changes, using **Settings → System → Backups**.

## Stage 3 — Decide how the agent will help

**Start with:** the agent's actual tools and a reachable dashboard.

Use an existing authorized Home Assistant connection if available. Otherwise
choose an available method:

| Agent capability | How to proceed |
| --- | --- |
| Browser control on the user's network | The user signs in privately; continue in that browser. A separate API token is optional. |
| Home Assistant API tool with secure credential input and network access | Follow [agent access and tokens](/docs/integrations/home-assistant/#agent-access-and-tokens), then verify the connection. |
| Chat only, or no secure credential input | Give individual UI instructions and wait for the user's result. No agent token is needed. |

A Home Assistant Core token does not by itself supply a tool, network access,
host shell access or Supervisor permissions to install Apps. Use the authorized
Home Assistant UI for App installation when the API tool cannot do it. Do not
install an extra remote shell simply to finish this guide.

**Done when:** the chosen method can inspect the dashboard or make a read-only
API request, or the user confirms they will perform the guided UI steps.

## Stage 4 — Connect one real device and organise a room

**Start with:** a working dashboard. Ask which device the user wants to try
first, including its brand and model. Prefer a lamp or a read-only sensor.

Use **Settings → Devices & services** and the
[official integration instructions](https://www.home-assistant.io/getting-started/integration/)
for that device. Review discovered integrations or add the matching one.
Check whether that model needs a bridge or radio adapter before asking the
user to pair it. Hauser cannot make an unsupported device compatible.

Explain: an integration connects a product or service; its entities are the
individual controls and readings. An Area groups them into a room. Give the
device a recognisable name and assign it to an Area in Home Assistant. Keep
existing names unless the user wants to change them.

**Done when:** the agreed device works in Home Assistant and is assigned to an
Area. For a lamp, observe its actual response and restore its starting state.
For a sensor, check a current reading. If no compatible device is available,
record this stage as pending; do not claim successful home control.

## Stage 5 — Install Hauser and make the first room work

**Start with:** Home Assistant and the rooms prepared above.

On Home Assistant OS, follow [Install as a Home Assistant App](/docs/getting-started/home-assistant-app/):
add `https://github.com/ralleur/hauser` under **Settings → Apps → App Store →
Repositories**, install Hauser, start it and open its Web UI. Older Home
Assistant versions may still call Apps “add-ons”. This route connects
automatically and needs no manually created HA token.

On an existing Container or Docker host, follow
[Docker Compose](/docs/getting-started/docker-compose/) together. Use
the user's actual server address, not `localhost` on a different computer.
Enter the separate Hauser connection token privately in its wizard. Check the
bind address and allowed browser origins before using another device.

Run [First setup](/docs/getting-started/first-setup/) in the browser:
language, connection, discovery, room review and activation. Skip optional
services for the first working room unless the user wants them. Check omitted
devices for missing Area assignments before rescanning.

**Done when:** a real room appears and the device from Stage 4 responds through
Hauser. Read-only sensors must show the expected current reading. A successful
server health response alone does not complete this stage. If HA control works
but Hauser does not, use [troubleshooting](/docs/reference/troubleshooting/)
and keep the working HA installation intact.

## Stage 6 — Bring all energy devices and readings together

**Start with:** Hauser working and the user's actual energy equipment. Ask,
one category at a time, about solar panels and inverters (including balcony
solar), home batteries, the electricity meter, and consumers such as a heat
pump, EV charger and metered appliances or plugs. “Nothing discovered” does
not mean the household owns none.

Follow [Guided energy setup](/docs/using/energy/#guided-energy-setup)
yourself. Compare the user's equipment with the HA integrations and entities,
and ask whether anything is missing. For every gap, help install or repair the
matching integration and verify its readings. Then configure the HA Energy
dashboard's counters and Hauser's production, consumption and battery fields.
Distinguish live W/kW, accumulated Wh/kWh and battery percentage. Check sensor
direction, coverage and overlapping measurements before saving.

Keep an equipment-to-entity-to-destination table, including equipment still
missing, unsupported or waiting for credentials/hardware. Do not finish after
mapping only the first inverter or plug. Do not invent unmeasured consumption,
assume all smart devices measure energy, or count the same energy twice.

**Done when:** the user confirms the inventory is complete, every available
supported source is connected and mapped, and Hauser's live readings and
available period values have been checked against HA. Clearly mark remaining
integration gaps, statistics still collecting, and current Hauser/client limits.
If there is no energy equipment or the user declines this part, record that
choice explicitly. Recheck energy in the chosen phone client during Stage 7.

## Stage 7 — Put Hauser on the user's phone or panel

**Start with:** Hauser working on the home network. Ask whether the device is
an iPhone, iPad, Android phone or a wall panel.

For a browser, open the verified Hauser LAN address on that device. Use the
[phone and panel guide](/docs/getting-started/phones-and-panels/)
for its home-screen or kiosk setup.

For the native iPhone/iPad app, walk through
[TestFlight installation and pairing](/docs/integrations/companion-app/).
Choose Home Assistant, grant local network/camera access when needed, and
generate a fresh pairing code in Hauser. Use the same-device link if scanning
the code on a second screen is not possible. Explain the beta's update and
expiry conditions. Android uses the web interface in this guide.

**Done when:** the chosen device opens the household and the same safe control
or reading works. If energy was configured, check its production, consumption,
battery and available daily values on this client too; do not assume that a
successful web setup proves native iOS history is available. For pairing
failures, check that both devices reach Hauser and generate a new code if the
old one expired.

## Stage 8 — Ask about access away from home

Ask: “Should Hauser also work when you are away from your home Wi-Fi?” If no,
mark remote access as skipped and continue. If yes, explain that Tailscale
creates a private connection between the home server and the phone, with an
external account and an app on each participating device.

Follow [Private access with Tailscale](/docs/integrations/remote-access/#private-access-with-tailscale)
one step at a time, including account creation, the HA App, phone setup and the
mobile-data test. Keep an existing working VPN if it already meets the user's
goal. Do not enable Funnel, router port forwarding or a whole-home subnet route
as a shortcut. Hauser's experimental paired Funnel path is a separate choice
on that page.

**Done when:** Hauser works on the phone with Wi-Fi off and Tailscale connected,
or the user has explicitly skipped remote access. For native iOS, opening a
web page remotely is not enough: also test the paired native app. Record an
unresolved native connection separately instead of declaring it complete.

## Stage 9 — Back up and hand over

Follow [Updates and backups](/docs/getting-started/updates-and-backups/).
For Home Assistant OS, create a backup including Hauser and keep a copy off
the HA device. Have the user save any backup recovery material privately.
For Compose, use its backup procedure. Record where the backup is kept,
without reading its contents or copying secrets into the conversation.

Remove temporary agent access using the token instructions. Keep the separate
token Hauser needs on Compose. Explain how the user opens Hauser tomorrow,
where updates appear and how to disconnect a lost remote device.

**Done when:** the chosen clients work, the backup exists, temporary access has
been removed or deliberately retained, and all pending items are named. A
backup's existence does not prove a restore was tested; record that accurately.

## Checkpoint for continuing later

Keep this in the conversation or a private note chosen by the user. Use labels
for addresses and accounts in a shareable copy. Never include tokens, passwords,
pairing codes, precise home location or backup recovery keys.

```text
Guide: Hauser agent-guided setup, revision 2026-10-19-energy
User language:
HA installation type / version / architecture:
Hardware and local address label:
Agent method: browser / secure API connection / guided UI
Stages 1–9: pending / done / skipped, with reason
For each done stage: evidence and date; agent-observed or user-reported
First room / agreed safe test / result:
Hauser version / installation route / local address label:
Energy inventory confirmed: solar/inverters, batteries, meter, consumers
Energy mapping: equipment → entity/statistic → unit/direction → HA/Hauser role
Energy gaps: missing integration or measurement / owner / exact next action
Energy coverage: whole house or measured devices only / excluded duplicates
Energy verification: live readings / history available since / client limits
Clients: browser or native; local and remote results recorded separately
Remote route / server and phone connected / mobile-data result:
Backup location label / creation date / restore tested: yes or no
Temporary agent credential label / revoked or retained by user choice:
Current blocker and exact next action:
```

For a checkpoint from the earlier eight-stage guide, match stages by title:
insert the energy stage after the first working Hauser room, then continue with
phones, remote access and handover. Keep already verified work.

## When something differs

Menu names and external setup flows change. Check the installed version and
the linked official instructions before suggesting a different menu or command.
Ask for the current screen's non-secret text if you cannot see it. Never ask
for a full configuration dump, a token-bearing log or an uncensored screenshot.

External instructions checked on **19 October 2026**. Hauser-specific details
come from this wiki and its server packaging; the official HA and Tailscale
pages linked here remain the references for their own installation flows.
