import json, os, re

base = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(base, ".."))
langs = ["de", "en", "fr", "it", "pl", "pt"]
data = {}
for l in langs:
    with open(os.path.join(base, l + ".json"), "r") as f:
        data[l] = json.load(f)

# Schlüssel, die die Registry referenziert (m.xxx())
reg_path = os.path.join(root, "src/lib/state/settings-registry.ts")
with open(reg_path, "r") as f:
    reg_src = f.read()
refd = set(re.findall(r"m\.([a-zA-Z0-9_]+)\(\)", reg_src))

# Komponenten, die die neue Struktur nutzen (schon umgestellt: NotificationsSection=Laundry, HomeLayoutSection=Layout)
comp_dirs = [
    os.path.join(root, "src/lib/components/settings"),
    os.path.join(root, "src/lib/components/ai"),
]
comp_src = ""
for d in comp_dirs:
    for fn in os.listdir(d):
        if fn.endswith(".svelte") or fn.endswith(".ts"):
            with open(os.path.join(d, fn), "r") as f:
                comp_src += f.read()
comp_refd = set(re.findall(r"m\.([a-zA-Z0-9_]+)\(\)", comp_src))

de_keys = set(data["de"].keys())

# Registry-referenzierte Schlüssel, die in de fehlen
missing_reg = sorted(refd - de_keys)
print("Registry referenziert", len(refd), "Schluessel; fehlend in de:", missing_reg)

# Komponenten-referenzierte Schlüssel fehlend in de
missing_comp = sorted(comp_refd - de_keys)
print("Komponenten referenzieren", len(comp_refd), "Schluessel; fehlend in de:", missing_comp)

# Konsistenz über Sprachen: Schlüssel, die in de vorhanden aber in anderen fehlen
print("\nSchluesselanzahl:", {l: len(data[l]) for l in langs})
for l in langs:
    miss = de_keys - set(data[l].keys())
    if miss:
        print(f"  {l}: fehlt vs de:", sorted(miss))

# Gruppen-Labels Werte
for g in ["settings_group_home_label","settings_group_appearance_label","settings_group_content_label","settings_group_connectivity_label","settings_group_system_label"]:
    print(g, "=", data["de"].get(g))
