#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Generate static German marketing pages, topic pages and the website sitemap.

The interactive entry template and its shared EN/DE copy are the homepage
source. Topic pages remain static. No translation service is required.
Does not build or translate the app or wiki.
"""
import argparse
from html import escape, unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess

ORIGIN = 'https://hauserhome.app'
UNCHANGED = {'Hauser', 'Demo', 'GitHub', 'DE', '↗', '→', '.', 'iPhone & iPad',
             'iPhone & iPad · iOS 17+', 'Apple Home', 'Home Assistant',
             'Home Assistant OS', 'AGPL-3.0-only', 'CC BY 4.0'}


class GermanPage(HTMLParser):
    def __init__(self, source, translations):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.translations = translations
        self.edits = []
        self.missing = set()
        self.raw = 0
        self.lines = [0] + [m.end() for m in re.finditer('\n', source)]
        self.feed(source)

    def translated(self, value):
        key = unescape(value).strip()
        if key in self.translations:
            return escape(self.translations[key], quote=True)
        if key and key not in UNCHANGED:
            self.missing.add(key)
        return value

    def source_offset(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.raw += 1
        original = self.get_starttag_text()
        def attribute(match):
            name, value = match.group(1), match.group(2)
            if name in ('alt', 'aria-label'):
                return f'{name}="{self.translated(value)}"'
            if name == 'content' and tag == 'meta' and (dict(attrs).get('name') == 'description' or dict(attrs).get('property') in ('og:title', 'og:description', 'og:image:alt')):
                return f'{name}="{self.translated(value)}"'
            # A German page is one level deeper. Keep anchors on that page.
            if name in ('href', 'src') and not value.startswith(('/', '#', 'https:', 'http:', 'data:', 'mailto:')):
                return f'{name}="/{value}"'
            if name in ('srcset', 'imagesrcset'):
                value = ', '.join('/' + part.strip() for part in value.split(','))
                return f'{name}="{value}"'
            return match.group(0)
        replacement = re.sub(r'\b(alt|aria-label|content|href|src|srcset|imagesrcset)="([^"]*)"', attribute, original)
        if replacement != original:
            self.edits.append((self.source_offset(), len(original), replacement))

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.raw -= 1

    def handle_data(self, data):
        if self.raw or not data.strip():
            return
        start = self.source_offset()
        end = self.source.find('<', start)
        if end == -1:
            end = len(self.source)
        raw = self.source[start:end]
        text = self.translated(raw)
        if unescape(raw).strip() in self.translations:
            prefix = raw[:len(raw) - len(raw.lstrip())]
            suffix = raw[len(raw.rstrip()):]
            self.edits.append((start, len(raw), prefix + text + suffix))

    def render(self):
        if self.missing:
            raise SystemExit('Missing German translations:\n' + '\n'.join(sorted(self.missing)))
        output = self.source
        for start, length, replacement in sorted(self.edits, reverse=True):
            output = output[:start] + replacement + output[start + length:]
        output = output.replace('<html lang="en">', '<html lang="de">')
        output = output.replace('<link rel="canonical" href="https://hauserhome.app/">', '<link rel="canonical" href="https://hauserhome.app/de/">')
        output = output.replace('<meta property="og:url" content="https://hauserhome.app/">', '<meta property="og:url" content="https://hauserhome.app/de/">')
        output = output.replace('property="og:locale" content="en_US"', 'property="og:locale" content="de_DE"').replace('property="og:locale:alternate" content="de_DE"', 'property="og:locale:alternate" content="en_US"')
        output = output.replace('href="/de/" hreflang="de" lang="de" data-language-switch="de"', 'href="/?lang=en" hreflang="en" lang="en" data-language-switch="en"').replace('title="Deutsch">DE</a>', 'title="English">EN</a>')
        # These are the two translated topic pages; the wiki itself remains English.
        for slug in ('home-assistant-dashboard', 'apple-home'):
            output = output.replace(f'href="/{slug}/"', f'href="/de/{slug}/"')
        def localized_schema(match):
            data = json.loads(match[1])
            data.update(url=ORIGIN + '/de/', inLanguage='de', description='Kostenloses Open-Source-Dashboard für Home Assistant und Apple Home mit Raumbildern, Licht und Szenen. Öffentliche Beta.')
            return '<script type="application/ld+json">\n' + json.dumps(data, ensure_ascii=False, indent=2) + '\n</script>'
        return re.sub(r'<script type="application/ld\+json">(.*?)</script>', localized_schema, output, flags=re.S)


TOPICS = {
    'home-assistant-dashboard': {
        'en': {
            'title': 'Hauser — Home Assistant dashboard for families and wall tablets',
            'heading': 'A Home Assistant dashboard for the people at home.',
            'description': 'A free, open-source Home Assistant dashboard for wall tablets, browsers and a paired iPhone or iPad. Control rooms, lights and scenes with familiar room pictures.',
            'intro': 'Home Assistant connects the devices. Hauser gives the household an everyday interface: recognise a room, choose a scene or tap a light. You can try the actual web interface with simulated devices before installing anything.',
            'image': 'hero-home-1100.webp', 'width': 1696, 'height': 960,
            'alt': 'The actual Hauser web demo, with an illustrated living room and room controls.',
            'caption': 'Actual web demo with simulated devices. The screenshots show the English interface.',
            'sections': [
                ('Rooms instead of device lists', 'Start with the included room illustrations or upload your own picture. Prepared images follow the time of day and room lighting state. On the wall panel, image control lets you place devices in the picture and tap them there. Scenes and device controls stay grouped by room.'),
                ('A useful wall tablet, even between touches', 'Standby shows a readable clock, appointments, notes and the shopping list. The web interface also adapts to a phone. The native iPhone and iPad app can pair with your Hauser server by QR code; available features differ from the web interface.'),
                ('Install on the hardware you already use', 'Home Assistant OS users can install Hauser as a Home Assistant App. Home Assistant Container and NAS users can run the server with Docker Compose. Both paths lead to a guided setup for discovering areas and arranging rooms. Keep the server on a trusted network; remote access has its own guide.'),
                ('Free software, with clear requirements', 'Hauser is open source and in public beta. Everyday control needs no Hauser account or subscription. You need an existing Home Assistant installation for this path. Optional image generation uses your chosen external provider and your own access; costs and limits depend on that provider. A native Apple Home connection is a separate path and needs no Home Assistant server.')
            ],
            'guide': '/docs/getting-started/requirements/', 'guide_label': 'Installation requirements',
            'other': 'apple-home', 'other_label': 'Use Apple Home without a Hauser server',
        },
        'de': {
            'title': 'Hauser — Home-Assistant-Dashboard für Familie und Wandtablet',
            'heading': 'Ein Home-Assistant-Dashboard für die Menschen zu Hause.',
            'description': 'Kostenloses Open-Source-Dashboard für Home Assistant: Räume, Licht und Szenen auf dem Wandtablet, im Browser und mit gekoppelter iPhone- oder iPad-App steuern.',
            'intro': 'Home Assistant verbindet die Geräte. Hauser gibt dem Haushalt eine Oberfläche für den Alltag: Raum erkennen, Szene wählen oder Licht antippen. Probiere die echte Weboberfläche mit simulierten Geräten aus, bevor du etwas installierst.',
            'image': 'hero-home-1100.webp', 'width': 1696, 'height': 960,
            'alt': 'Die echte Hauser-Web-Demo mit illustriertem Wohnzimmer und Raumsteuerung.',
            'caption': 'Echte Web-Demo mit simulierten Geräten. Die Screenshots zeigen die englische Oberfläche.',
            'sections': [
                ('Räume statt Gerätelisten', 'Starte mit den mitgelieferten Raumillustrationen oder lade ein eigenes Bild hoch. Vorbereitete Bilder wechseln passend zur Tageszeit und zum Licht im Raum. Auf dem Wandpanel kannst du Geräte im Bild platzieren und dort antippen. Szenen und Bedienelemente bleiben nach Räumen geordnet.'),
                ('Ein Wandtablet, das auch im Vorbeigehen hilft', 'Standby zeigt eine gut lesbare Uhr, Termine, Notizen und die Einkaufsliste. Die Weboberfläche passt sich auch ans Smartphone an. Die native App für iPhone und iPad koppelt sich per QR-Code mit deinem Hauser-Server. Ihre verfügbaren Funktionen unterscheiden sich von der Weboberfläche.'),
                ('Auf deiner vorhandenen Hardware installieren', 'Mit Home Assistant OS installierst du Hauser als Home Assistant App. Mit Home Assistant Container oder einem NAS betreibst du den Server über Docker Compose. Beide Wege führen zur geführten Einrichtung, die Bereiche findet und dich Räume anordnen lässt. Der Server gehört in ein vertrauenswürdiges Netzwerk. Für den Fernzugriff gibt es eine eigene Anleitung.'),
                ('Kostenlose Software mit klaren Voraussetzungen', 'Hauser ist Open Source und in der öffentlichen Beta. Für die tägliche Steuerung brauchst du weder ein Hauser-Konto noch ein Abo. Für diesen Weg ist eine vorhandene Home-Assistant-Installation nötig. Die optionale Bilderzeugung verwendet einen gewählten externen Anbieter und deinen eigenen Zugang. Kosten und Grenzen hängen vom Anbieter ab. Die native Apple-Home-Anbindung ist ein eigener Weg und braucht keinen Home-Assistant-Server.')
            ],
            'guide': '/docs/getting-started/requirements/', 'guide_label': 'Installationsvoraussetzungen (EN)',
            'other': 'apple-home', 'other_label': 'Apple Home ohne Hauser-Server nutzen',
        },
    },
    'apple-home': {
        'en': {
            'title': 'Hauser — Free Apple Home app for iPhone and iPad',
            'heading': 'Your Apple Home. Familiar rooms on iPhone and iPad.',
            'description': 'Use Hauser directly with Apple Home on iPhone and iPad. A free, open-source native app for rooms, supported devices and scenes. No Hauser server. TestFlight beta.',
            'intro': 'Hauser is a native iPhone and iPad app that can connect directly to Apple Home. Your rooms and supported devices come from your existing home. There is no Hauser server to install and no Home Assistant requirement for this connection.',
            'image': 'ios-room.webp', 'width': 804, 'height': 1748,
            'alt': 'The actual native Hauser iOS demo showing the living room, scenes and light controls.',
            'caption': 'Actual native iOS demo. Screenshot in English.',
            'sections': [
                ('Everyday control, room by room', 'Open the living room, choose a scene or change a light. Hauser groups the room controls together. The native app includes room pictures; the iPad also offers image control. Supported devices and features depend on your Apple Home connection. The web demo is a separate preview and does not connect to Apple Home.'),
                ('What you need', 'Use an iPhone or iPad running iOS or iPadOS 17 or later, Apple’s TestFlight app and an existing Apple Home with supported devices. Join the Hauser beta, open the app and choose Apple Home. Allow Home access when prompted. The setup guide explains the supported connection paths.'),
                ('Free, open source and in public beta', 'Hauser does not charge for the app or require a Hauser account or subscription for everyday control. This is a personal project without guaranteed support. TestFlight builds expire and need updates. Optional image generation and other external integrations have their own requirements and costs.'),
                ('Already using Home Assistant?', 'The same native app can instead pair with a Hauser server connected to Home Assistant. This is a different connection path, with different available devices and features. Apple Home does not automatically gain the integrations of a Home Assistant server.')
            ],
            'guide': '/docs/integrations/companion-app/', 'guide_label': 'Native app setup and supported connections',
            'other': 'home-assistant-dashboard', 'other_label': 'Explore the Home Assistant dashboard',
        },
        'de': {
            'title': 'Hauser — Kostenlose Apple-Home-App für iPhone und iPad',
            'heading': 'Dein Apple Home. Vertraute Räume auf iPhone und iPad.',
            'description': 'Hauser direkt mit Apple Home auf iPhone und iPad nutzen: kostenlose native Open-Source-App für Räume, unterstützte Geräte und Szenen. Ohne Hauser-Server. TestFlight-Beta.',
            'intro': 'Hauser ist eine native App für iPhone und iPad und verbindet sich direkt mit Apple Home. Räume und unterstützte Geräte werden aus deinem bestehenden Zuhause übernommen. Für diese Verbindung brauchst du weder einen Hauser-Server noch Home Assistant.',
            'image': 'ios-room.webp', 'width': 804, 'height': 1748,
            'alt': 'Die echte native Hauser-iOS-Demo mit Wohnzimmer, Szenen und Lichtsteuerung.',
            'caption': 'Echte native iOS-Demo. Screenshot auf Englisch.',
            'sections': [
                ('Alltagssteuerung, Raum für Raum', 'Öffne das Wohnzimmer, wähle eine Szene oder ändere ein Licht. Hauser fasst die Bedienelemente eines Raums zusammen. Die native App zeigt Raumbilder; auf dem iPad gibt es zusätzlich die Bildsteuerung. Unterstützte Geräte und Funktionen hängen von der Apple-Home-Verbindung ab. Die Web-Demo ist eine separate Vorschau und verbindet sich nicht mit Apple Home.'),
                ('Was du brauchst', 'Du brauchst ein iPhone oder iPad mit iOS beziehungsweise iPadOS 17 oder neuer, Apples TestFlight-App und ein eingerichtetes Apple Home mit unterstützten Geräten. Tritt der Hauser-Beta bei, öffne die App und wähle Apple Home. Erlaube auf Nachfrage den Zugriff auf dein Zuhause. Die Anleitung erklärt die unterstützten Verbindungswege.'),
                ('Kostenlos, Open Source und öffentliche Beta', 'Hauser kostet nichts. Für die tägliche Bedienung brauchst du weder ein Hauser-Konto noch ein Abo. Es ist ein persönliches Projekt ohne garantierten Support. TestFlight-Builds laufen ab und müssen aktualisiert werden. Optionale Bilderzeugung und weitere externe Integrationen haben eigene Voraussetzungen und Kosten.'),
                ('Du nutzt bereits Home Assistant?', 'Dieselbe native App kann sich stattdessen mit einem Hauser-Server für Home Assistant koppeln. Das ist ein anderer Verbindungsweg mit anderen verfügbaren Geräten und Funktionen. Eine Apple-Home-Verbindung erhält nicht automatisch die Integrationen eines Home-Assistant-Servers.')
            ],
            'guide': '/docs/integrations/companion-app/', 'guide_label': 'App-Einrichtung und Verbindungswege (EN)',
            'other': 'home-assistant-dashboard', 'other_label': 'Das Home-Assistant-Dashboard kennenlernen',
        },
    },
}


def topic_page(slug, language, source):
    data = TOPICS[slug][language]
    de = language == 'de'
    prefix = '/de/' if de else '/'
    canonical = ORIGIN + prefix + slug + '/'
    alternate = ('/' if de else '/de/') + slug + '/'
    head = source[source.index('<head>') + 6:source.index('</head>')]
    head = re.sub(r'<link rel="stylesheet"[^>]*>', '', head)
    head += '\n<link rel="stylesheet" href="/site.css">\n'
    head = re.sub(r'[ \t]+\n', '\n', head)
    head = re.sub(r'<title>.*?</title>', '<title>' + escape(data['title']) + '</title>', head)
    for name in ('description', 'og:title', 'og:description', 'og:url'):
        value = canonical if name == 'og:url' else data['title'] if name == 'og:title' else data['description']
        head = re.sub(r'(<meta (?:name|property)="' + name + r'" content=")[^"]*', lambda m: m[1] + escape(value, quote=True), head)
    head = re.sub(r'<link rel="canonical"[^>]+>', f'<link rel="canonical" href="{canonical}">', head)
    head = re.sub(r'<link rel="alternate" hreflang="(en|de|x-default)"[^>]+>', lambda m: f'<link rel="alternate" hreflang="{m[1]}" href="{ORIGIN}{"/de/" if m[1] == "de" else "/"}{slug}/">', head)
    head = re.sub(r'<link rel="preload"[^>]+as="image"[^>]*>\n?', '', head)
    head = re.sub(r'((?:href|src)=")(brand/|fonts/|site.css|favicon.png|apple-touch-icon.png)', r'\1/\2', head)
    web_schema = {'@context': 'https://schema.org', '@type': 'WebPage', 'name': data['title'], 'description': data['description'], 'url': canonical, 'inLanguage': language, 'about': {'@type': 'SoftwareApplication', 'name': 'Hauser', 'url': ORIGIN + prefix}}
    head = re.sub(r'<script type="application/ld\+json">.*?</script>', '<script type="application/ld+json">\n' + json.dumps(web_schema, ensure_ascii=False, indent=2) + '\n</script>', head, flags=re.S)
    if de:
        head = head.replace('property="og:locale" content="en_US"', 'property="og:locale" content="de_DE"').replace('property="og:locale:alternate" content="de_DE"', 'property="og:locale:alternate" content="en_US"')
    sections = ''.join(f'<section><h2>{escape(title)}</h2><p>{escape(body)}</p></section>\n' for title, body in data['sections'])
    # The narrow phone capture keeps its original aspect ratio; no simulated UI.
    figure_class = 'phone-figure' if slug == 'apple-home' else 'hero-product'
    return f'''<!doctype html>
<html lang="{language}">
<head>{head}</head>
<body class="topic-page">
<a class="skip-link" href="#main">{'Zum Inhalt' if de else 'Skip to content'}</a>
<header class="site-header wrap">
  <a class="brand" href="{prefix}" aria-label="Hauser"><img src="/brand/hauser-logo-light.svg" width="416" height="144" alt="Hauser"></a>
  <nav class="nav-links" aria-label="{'Hauptnavigation' if de else 'Main navigation'}">
    <a class="nav-docs" href="/docs/">{'Anleitung (EN)' if de else 'Guide'}</a><a href="{prefix}#install">{'Installation' if de else 'Get Hauser'}</a><a href="/demo/">Demo ↗</a>
    <a class="language-switch" href="{alternate}" hreflang="{'en' if de else 'de'}" lang="{'en' if de else 'de'}" data-language-switch="{'en' if de else 'de'}" aria-label="{'Show website in English' if de else 'Website auf Deutsch anzeigen'}">{'EN' if de else 'DE'}</a>
  </nav>
</header>
<main id="main">
  <section class="hero wrap"><div class="hero-intro"><h1>{escape(data['heading'])}</h1><div class="hero-copy"><p class="lead">{escape(data['intro'])}</p><div class="actions"><a class="button button-primary" href="/demo/">{'Demo öffnen' if de else 'Open the demo'} ↗</a><a class="text-link" href="{prefix}#install">{'Einrichten' if de else 'Set up'} →</a></div><p class="small hero-note">{'Kostenlos. Open Source. Öffentliche Beta.' if de else 'Free. Open source. Public beta.'}</p></div></div>
  <figure class="{figure_class}"><img src="/media/{data['image']}" width="{data['width']}" height="{data['height']}" alt="{escape(data['alt'], quote=True)}" fetchpriority="high"><figcaption>{escape(data['caption'])}</figcaption></figure></section>
  <div class="wrap section-space"><div class="topic-content">{sections}
    <p><a class="text-link" href="{data['guide']}">{escape(data['guide_label'])} →</a></p>
    <p><a class="text-link" href="{prefix}{data['other']}/">{escape(data['other_label'])} →</a></p>
    <p><a class="text-link" href="{prefix}">{'Hauser kennenlernen' if de else 'Explore Hauser'} →</a></p>
  </div></div>
</main>
<footer class="site-footer"><div class="wrap"><nav class="footer-links" aria-label="{'Projektlinks' if de else 'Project links'}"><a href="{prefix}">Hauser</a><a href="/docs/">{'Dokumentation (EN)' if de else 'Documentation'}</a><a href="https://github.com/ralleur/hauser">GitHub</a></nav><p>{'Code und Dokumentation' if de else 'Code and documentation'}: <a href="https://github.com/ralleur/hauser/blob/main/LICENSE">AGPL-3.0-only</a>. {'Screenshots' if de else 'Screenshots'}: <a href="https://github.com/ralleur/hauser/blob/main/ASSETS-LICENSE.md">CC BY 4.0</a>. <a href="https://github.com/ralleur/hauser/blob/main/TRADEMARKS.md">{'Hauser-Marke vorbehalten' if de else 'Hauser branding reserved'}</a>. Alegreya Sans &amp; Alegreya: SIL Open Font License.</p><p>{'Nicht mit Home Assistant oder Apple verbunden. Apple Home und TestFlight sind Marken von Apple Inc.' if de else 'Not affiliated with Home Assistant or Apple. Apple Home and TestFlight are trademarks of Apple Inc.'}</p></div></footer>
</body></html>
'''


def experience_page(root, language, copy):
    """Render indexable EN/DE entry pages from the same copy as the tour."""
    source = (root / 'experience/index.html').read_text()
    data = copy[language]
    de = language == 'de'
    canonical = ORIGIN + ('/de/' if de else '/')
    source = source.replace('<html lang="en"', f'<html lang="{language}"')
    source = source.replace('noindex,nofollow', 'index,follow')
    source = source.replace('data-demo-src="/demo/', 'data-demo-src="/presentation/')
    source = re.sub(r'<title>.*?</title>', '<title>Hauser — ' + ('Komm herein.' if de else 'Come on in.') + '</title>', source)
    source = re.sub(r'(<meta name="description" content=")[^"]*', lambda m: m[1] + escape(data['description'], quote=True), source)
    # data-copy elements contain trusted project-owned HTML, also used at runtime.
    source = re.sub(r'(<(?P<tag>\w+)\b[^>]*data-copy="(?P<key>[^"]+)"[^>]*>).*?(</(?P=tag)>)', lambda m: m[1] + data[m['key']] + m[4], source, flags=re.S)
    source = source.replace('aria-label="Hauser — back to the beginning"', 'aria-label="Hauser — zurück zum Anfang"' if de else 'aria-label="Hauser — back to the beginning"')
    if de:
        source = source.replace('aria-label="Auf Deutsch ansehen">DE</button>', 'aria-label="View in English">EN</button>')
        source = source.replace('Getting your home ready.', 'Dein Zuhause wird vorbereitet.').replace('Connecting to the demo…', 'Die Demo wird verbunden…')
        source = source.replace('Hauser — interactive demo with simulated devices', 'Hauser — interaktive Demo mit simulierten Geräten')
        source = source.replace('Hauser is a free, open-source home interface for Home Assistant and Apple Home. This interactive introduction needs JavaScript.', 'Hauser ist eine kostenlose Open-Source-Oberfläche für Home Assistant und Apple Home. Diese interaktive Einführung benötigt JavaScript.')
        source = source.replace('Read about Hauser and installation', 'Mehr über Hauser und die Installation (EN)').replace('view the source', 'Quellcode ansehen').replace(', or <a href="https://github.com/ralleur/hauser">', ' oder <a href="https://github.com/ralleur/hauser">')
    metadata = f'''<link rel="canonical" href="{canonical}">
  <link rel="alternate" hreflang="en" href="{ORIGIN}/">
  <link rel="alternate" hreflang="de" href="{ORIGIN}/de/">
  <link rel="alternate" hreflang="x-default" href="{ORIGIN}/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Hauser — {'Komm herein.' if de else 'Come on in.'}">
  <meta property="og:description" content="{escape(data['description'], quote=True)}">
  <meta property="og:url" content="{canonical}">
  <meta property="og:locale" content="{'de_DE' if de else 'en_US'}">
  <meta property="og:locale:alternate" content="{'en_US' if de else 'de_DE'}">
  <meta property="og:image" content="{ORIGIN}/media/social-preview.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script src="/language.js"></script>'''
    schema = {'@context': 'https://schema.org', '@type': 'SoftwareApplication', 'name': 'Hauser', 'description': data['description'], 'applicationCategory': 'LifestyleApplication', 'isAccessibleForFree': True, 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'EUR'}, 'inLanguage': language, 'operatingSystem': 'Home Assistant OS, Docker, iOS', 'url': canonical, 'license': 'https://github.com/ralleur/hauser/blob/main/LICENSE'}
    metadata += '\n<script type="application/ld+json">' + json.dumps(schema, ensure_ascii=False) + '</script>'
    return source.replace('</head>', metadata + '\n</head>')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--website', type=Path, default=Path(__file__).resolve().parents[1] / 'website')
    root = parser.parse_args().website.resolve()
    copy = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', 'const {copy}=await import(process.argv[1]);process.stdout.write(JSON.stringify(copy))', (root / 'experience/copy.js').as_uri()], text=True))
    source = experience_page(root, 'en', copy)
    german = experience_page(root, 'de', copy)
    (root / 'index.html').write_text(source)
    (root / 'de').mkdir(exist_ok=True)
    (root / 'de/index.html').write_text(german)
    paths = ['/', '/de/']
    for slug in TOPICS:
        for language in ('en', 'de'):
            relative = ('' if language == 'en' else 'de/') + slug + '/'
            target = root / relative / 'index.html'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(topic_page(slug, language, source))
            paths.append('/' + relative)
    entries = []
    for path in paths:
        suffix = path.removeprefix('/de/') if path.startswith('/de/') else path.lstrip('/')
        entries.append('  <url><loc>' + ORIGIN + path + '</loc>' + ''.join(f'<xhtml:link rel="alternate" hreflang="{lang}" href="{ORIGIN}{"/de/" if lang == "de" else "/"}{suffix}"/>' for lang in ('en', 'de', 'x-default')) + '</url>')
    (root / 'sitemap-pages.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + '\n'.join(entries) + '\n</urlset>\n')
    (root / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>' + ORIGIN + '/sitemap-pages.xml</loc></sitemap><sitemap><loc>' + ORIGIN + '/docs/sitemap-0.xml</loc></sitemap></sitemapindex>\n')
    (root / 'robots.txt').write_text('User-agent: *\nAllow: /\n\nSitemap: ' + ORIGIN + '/sitemap.xml\n')
    print(f'website_build=PASS ({len(paths)} static pages, en/de, sitemap index including wiki)')


if __name__ == '__main__':
    main()
