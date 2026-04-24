"""In-place reclassify items.json using the improved slot classifier.

Mirrors `classifySlot()` in scrape.js. Runs without hitting the network --
items.json already contains `categorySlug`, `tags`, and `classname`.

Usage:
    python reclassify.py
"""
import json
import re
from pathlib import Path
from collections import Counter


def classify_slot(category_slug: str, tag_slugs: list[str], classname: str) -> str:
    tags = set(tag_slugs)
    cn = classname
    cl = cn.lower()

    # Classname-фолбэк для weapon'ов которые wiki неверно положил в clothes/other
    if re.search(r"^mace$|^sword$|^katana$|^hatchet$|^machete$|^bayonet$|^axe_", cn, re.I):
        return "Weapon_Melee"
    if re.search(r"^derringer", cn, re.I):
        return "Weapon_Pistol"

    # Non-clothes категории
    if category_slug == "weapons":
        if "pistols" in tags or re.search(r"glock|fnx|fnp45|cr75|deagle|magnum|mkii|mk2|colt1911|pistol$", cn, re.I):
            return "Weapon_Pistol"
        if "melee" in tags or re.search(r"knife|machete|bayonet|sledge|hammer|crowbar|shovel|pickaxe|bat|katana", cn, re.I):
            return "Weapon_Melee"
        return "Weapon_Primary"

    if category_slug == "magazine" or re.match(r"^mag_", cn, re.I):
        return "Magazine"
    if category_slug == "ammo" or re.match(r"^ammo_", cn, re.I):
        return "Ammo"

    if category_slug in ("weaponparts", "optics"):
        return "Attachment"
    if re.search(r"optic|scope|suppressor|bttstck|hndgrd|rail|light$|battery9v|compensator", cn, re.I):
        return "Attachment"

    if category_slug == "explosives" or re.search(r"grenade", cn, re.I):
        return "Grenade"

    if category_slug == "containers":
        if re.search(r"bag$|backpack|courierbag|alicebag|hunterbag|assaultbag|coyotebag|drybag|mountainbag|fieldbag|taloncase|sack", cn, re.I):
            return "Back"
        return "Container"

    # Sack-предметы в категории clothes (wiki ошибочно положил LeatherSack_* в одежду)
    if re.search(r"sack", cn, re.I):
        return "Back"

    if category_slug == "medical":
        return "Medical"
    if category_slug == "food":
        return "Food"
    if category_slug == "tools":
        return "Tool"

    if category_slug in ("animals", "zombies", "vehicles", "autoparts"):
        return "Skip"

    # Одежда
    if category_slug == "clothes" or not category_slug:
        if re.search(r"glasses|goggles", cn, re.I):
            return "Eyewear"

        if re.search(r"mask|balaclava|bandana|shemag|scarf|respirator|beard|eyepatch|facecover|nose", cn, re.I):
            return "Mask"

        if re.search(r"helmet|hlmt|cap(?![a-z])|hat|beanie|beret|hood(?!ie)|headtorch|headband|headdress|ushanka|budenovka|norsehelm|coif|crown", cn, re.I):
            return "Head"

        if re.search(r"armband", cn, re.I):
            return "Armband"

        if re.search(r"vest|platecarrier|pressvest|ukassvest|ttskovest|chestholster|holster|pouches|radiopouch", cl):
            return "Vest"

        if re.search(r"pants|jeans|trousers|shorts|kilt", cl):
            return "Legs"

        if re.search(r"boots|shoes|sneakers|sandals|slippers", cl):
            return "Feet"

        if re.search(r"gloves|mittens", cl):
            return "Hands"

        if re.search(r"belt", cl):
            return "Belt"

        if re.search(r"jacket|shirt|hoodie|sweater|parka|coat|pullover|tshirt|tunic|top$|raincoat|pajama|overalls|gorka|ghillie|chainmail", cl):
            return "Body"

        # Фолбэк по тегам
        if "face" in tags: return "Mask"
        if "eyes" in tags: return "Eyewear"
        if "hats" in tags: return "Head"
        if "torso" in tags: return "Body"
        if "pants" in tags: return "Legs"
        if "shoes" in tags: return "Feet"
        if "gloves" in tags: return "Hands"
        if "arm" in tags: return "Armband"
        if "belt" in tags: return "Belt"

        return "Other"

    return "Other"


def main() -> None:
    path = Path(__file__).parent / "items.json"
    data = json.loads(path.read_text(encoding="utf-8"))

    changed: list[tuple[str, str, str]] = []
    for it in data:
        old = it["slot"]
        new = classify_slot(it.get("categorySlug", ""), it.get("tags", []), it["classname"])
        if new != old:
            changed.append((it["classname"], old, new))
            it["slot"] = new

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"reclassified {len(changed)} items:")
    for cn, old, new in changed[:40]:
        print(f"  {cn}: {old} -> {new}")
    if len(changed) > 40:
        print(f"  ... ({len(changed) - 40} more)")

    # Summary
    by_slot = Counter(it["slot"] for it in data)
    print("\nnew distribution:")
    for slot, count in sorted(by_slot.items(), key=lambda x: -x[1]):
        print(f"  {slot}: {count}")


if __name__ == "__main__":
    main()
