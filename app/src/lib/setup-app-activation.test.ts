import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { dirname, join } from 'node:path';
// @ts-expect-error Native Node test without @types/node.
import { fileURLToPath } from 'node:url';
import deMessages from '../../messages/de.json';
import enMessages from '../../messages/en.json';
import frMessages from '../../messages/fr.json';
import itMessages from '../../messages/it.json';
import plMessages from '../../messages/pl.json';
import ptMessages from '../../messages/pt.json';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Dieselben Dateien liegen im Arbeitsrepo unter dem Export-Overlay und im
   öffentlichen Repo an der Wurzel. Geprüft wird, was hier tatsächlich liegt. */
function packaged(...segments: string[]): string {
  const overlay = join(repoRoot, 'tools', 'public-export', 'files', ...segments);
  return existsSync(overlay) ? overlay : join(repoRoot, ...segments);
}

const manifest = JSON.parse(readFileSync(packaged('hauser', 'config.yaml'), 'utf8'));
const wizard = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'components', 'SetupWizard.svelte'), 'utf8',
);
const services = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'components', 'settings', 'ServicesSection.svelte'), 'utf8',
);
const deviceAddress = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'components', 'DeviceAddress.svelte'), 'utf8',
);
const docs = readFileSync(packaged('hauser', 'DOCS.md'), 'utf8');

describe('App-Manifest', () => {
  it('erlaubt genau den Home-Assistant-Core-Zugang und schaltet den App-Modus ein', () => {
    expect(manifest.homeassistant_api).toBe(true);
    expect(manifest.environment.HMI_HA_CONNECTION_MODE).toBe('supervisor');
  });

  it('behält den direkten Port-4173-Vertrag und verwendet kein Ingress', () => {
    expect(manifest.webui).toBe('http://[HOST]:[PORT:4173]');
    expect(manifest.ports['4173/tcp']).toBe(4173);
    expect(manifest.ingress).toBeUndefined();
  });

  it('fordert keine weitergehenden Supervisor-Rechte an', () => {
    for (const key of ['hassio_api', 'hassio_role', 'auth_api', 'docker_api', 'host_network']) {
      expect(manifest[key]).toBeUndefined();
    }
  });
});

describe('Endgeräte-Adresse', () => {
  it('zeigt exakt die Origin dieser Seite statt eines geratenen Hostnamens', () => {
    expect(deviceAddress).toContain('location.origin');
    expect(deviceAddress).not.toContain('homeassistant.local');
  });

  it('lädt den QR-Code erst beim Anzeigen nach', () => {
    expect(deviceAddress).toContain("await import('qrcode-generator')");
    expect(deviceAddress).not.toContain("from 'qrcode-generator'");
  });

  it('bietet Kopieren und einen beschrifteten QR-Code an', () => {
    expect(deviceAddress).toContain('navigator.clipboard.writeText(address)');
    expect(deviceAddress).toContain('m.device_address_qr_label({ address })');
    expect(deviceAddress).toContain('aria-label');
  });

  it('erscheint im Wizard-Abschluss und dauerhaft unter System → Dienste', () => {
    expect(wizard).toContain("import DeviceAddress from './DeviceAddress.svelte';");
    expect(wizard).toContain("{#if status === 'done'}");
    expect(services).toContain("import DeviceAddress from '../DeviceAddress.svelte';");
    expect(services).toContain('data-setting-id="device-address"');
  });

  it('steht in beiden Betriebsarten, nicht im Credential-Block des direkten Modus', () => {
    /* `{#if !managedByApp}` blendet HA-Adresse und Token im App-Modus aus. Die
       Endgeräte-Adresse gilt in beiden Modi und darf deshalb nicht darin
       liegen — sonst verschwindet sie genau dort, wo sie gebraucht wird. */
    const address = services.indexOf('data-setting-id="device-address"');
    const conditional = services.indexOf('{#if !managedByApp}');
    const conditionalEnd = services.indexOf('{/if}', conditional);
    expect(address).toBeGreaterThan(-1);
    expect(conditional).toBeGreaterThan(-1);
    expect(conditionalEnd).toBeGreaterThan(conditional);
    expect(address < conditional || address > conditionalEnd).toBe(true);
    /* Adresse und Token bleiben getrennt: der Token-Block bleibt bedingt. */
    const token = services.indexOf('data-setting-id="ha-token"');
    expect(token).toBeGreaterThan(conditional);
    expect(token).toBeLessThan(conditionalEnd);
  });

  it('ist in allen sechs Sprachen übersetzt', () => {
    const keys = [
      'device_address_hint', 'device_address_copy', 'device_address_copied',
      'device_address_qr_label', 'setup_done_title', 'setup_done_open',
      'sys_device_address', 'sys_ha_managed_by_app',
    ];
    for (const catalog of [deMessages, enMessages, frMessages, itMessages, plMessages, ptMessages]) {
      for (const key of keys) {
        expect(typeof (catalog as Record<string, unknown>)[key]).toBe('string');
        expect((catalog as Record<string, string>)[key].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('App-Dokumentation', () => {
  it('beschreibt Trusted LAN ehrlich und empfiehlt keine Internetfreigabe', () => {
    expect(docs).toContain('no separate user login and no device pairing');
    expect(docs).toContain('Do not publish the port directly to the internet.');
  });

  it('verspricht keine HA-URL- oder Token-Eingabe mehr', () => {
    expect(docs).toContain('There is no field for a Home Assistant URL and no Long-Lived Access Token.');
  });
});
