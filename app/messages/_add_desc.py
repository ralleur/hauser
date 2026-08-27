import json, os, re

base = os.path.dirname(os.path.abspath(__file__))
translations = {
    "de": "Räume verwalten, Geräte umbenennen und Raumbilder erstellen — die Struktur deines Zuhauses.",
    "en": "Manage rooms, rename devices and create room images — the structure of your home.",
    "fr": "Gérez les pièces, renommez les appareils et créez des images de pièce — la structure de votre maison.",
    "it": "Gestisci le stanze, rinomina i dispositivi e crea immagini delle stanze — la struttura della tua casa.",
    "pl": "Zarządzaj pokojami, zmieniaj nazwy urządzeń i twórz obrazy pokoi — struktura Twojego domu.",
    "pt": "Gerencie as divisões, renomeie os dispositivos e crie imagens de divisões — a estrutura da sua casa.",
}
KEY = "settings_section_rooms_devices_desc"

for lang, text in translations.items():
    path = os.path.join(base, lang + ".json")
    with open(path, "r") as f:
        raw = f.read()
    if f'"{KEY}"' in raw:
        print(lang, "schon vorhanden, skip")
        continue
    # Label-Zeile finden: "settings_section_rooms_devices_label": "...",  (endet mit Komma)
    pat = re.compile(r'^(\s*"settings_section_rooms_devices_label":\s*"[^"]*",)$', re.M)
    m = pat.search(raw)
    if not m:
        print(lang, "Label-Zeile nicht gefunden!")
        continue
    # Einfügen direkt nach der Label-Zeile, mit identischem Einzug
    indent = m.group(1).split('"')[0]  # z.B. zwei Leerzeichen
    new_line = indent + '"' + KEY + '": "' + text + '",'
    raw = raw[:m.end()] + "\n" + new_line + raw[m.end():]
    with open(path, "w") as f:
        f.write(raw)
    # Verifikation: JSON valide?
    json.loads(raw)
    print(lang, "eingefuegt OK")
