// One-shot scraper: wikidayz → items.json
// Run: npm install && node scrape.js

import { load } from 'cheerio';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const BASE = 'https://dayz-store.ru';
const SITEMAP = `${BASE}/sitemap_index.xml`;
const UA = 'Mozilla/5.0 (loadout-editor scraper)';
const CONCURRENCY = 8;
const OUT = new URL('./items.json', import.meta.url);
const CACHE = new URL('./.scrape-cache.json', import.meta.url);

const SKIP_PREFIXES = [
    '/news/', '/shop/', '/servers/', '/dayz-maps/', '/category/', '/tag/',
    '/wp-', '/feed', '/author/', '/wikidayz', '/traderplus-editor', '/trader-editor',
    '/presetplayerspawner', '/tariffs', '/install', '/faq', '/kontakty',
    '/feedback', '/donate-shop', '/home', '/sample-page',
    '/polzovatelskoe', '/soglashenie'
];

function classifySlot(categorySlug, tagSlugs, classname) {
    const tags = new Set(tagSlugs);
    const cn = classname;
    const cl = cn.toLowerCase();

    if (categorySlug === 'weapons') {
        if (tags.has('pistols') || /glock|fnx|fnp45|cr75|deagle|magnum|mkii|mk2|colt1911|pistol$/i.test(cn)) return 'Weapon_Pistol';
        if (tags.has('melee') || /knife|machete|bayonet|sledge|hammer|crowbar|shovel|pickaxe|bat|katana/i.test(cn)) return 'Weapon_Melee';
        return 'Weapon_Primary';
    }

    if (categorySlug === 'magazine' || /^mag_/i.test(cn)) return 'Magazine';
    if (categorySlug === 'ammo' || /^ammo_/i.test(cn)) return 'Ammo';

    if (categorySlug === 'weaponparts' || categorySlug === 'optics') return 'Attachment';
    if (/optic|scope|suppressor|bttstck|hndgrd|rail|light$|battery9v|compensator/i.test(cn)) return 'Attachment';

    if (categorySlug === 'explosives' || /grenade/i.test(cn)) return 'Grenade';

    if (categorySlug === 'containers') {
        if (/bag$|backpack|courierbag|alicebag|hunterbag|assaultbag|coyotebag|drybag|mountainbag|fieldbag|taloncase/i.test(cn)) return 'Back';
        return 'Container';
    }

    if (categorySlug === 'clothes') {
        // Tag-based first
        if (tags.has('hats')) return 'Head';
        if (tags.has('face')) return 'Mask';
        if (tags.has('eyes')) return 'Eyewear';
        if (tags.has('torso')) {
            // Vests look like torso on the wiki — disambiguate by classname
            if (/vest|platecarrier|pressvest|ukassvest|ttskovest|chestholster|holster|pouches|radiopouch/i.test(cl)) return 'Vest';
            return 'Body';
        }
        if (tags.has('pants')) return 'Legs';
        if (tags.has('shoes')) return 'Feet';
        if (tags.has('gloves')) return 'Hands';
        if (tags.has('arm')) return 'Armband';
        if (tags.has('belt')) return 'Belt';
        // Fallback: classname heuristics for untagged clothes
        if (/helmet|hlmt|cap|hood|mask|bandana|hat|beanie|beret|balaclava$/i.test(cn)) return 'Head';
        if (/vest|platecarrier|pressvest|ukassvest|ttskovest|chestholster|holster|pouches/i.test(cl)) return 'Vest';
        if (/pants|jeans|trousers|shorts/i.test(cl)) return 'Legs';
        if (/boots|shoes|sneakers/i.test(cl)) return 'Feet';
        if (/gloves/i.test(cl)) return 'Hands';
        if (/jacket|shirt|hoodie|sweater|parka|coat|pullover|tshirt|tunic|top$/i.test(cl)) return 'Body';
        if (/armband/i.test(cl)) return 'Armband';
        return 'Body';
    }

    if (categorySlug === 'medical') return 'Medical';
    if (categorySlug === 'food') return 'Food';
    if (categorySlug === 'tools') return 'Tool';

    if (categorySlug === 'animals' || categorySlug === 'zombies' || categorySlug === 'vehicles' || categorySlug === 'autoparts') {
        return 'Skip';
    }

    return 'Other';
}

async function fetchText(url, tries = 3) {
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': UA } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.text();
        } catch (e) {
            if (i === tries - 1) throw e;
            await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
    }
}

async function listItemUrls() {
    const seen = new Set();

    // Source 1: sitemap
    try {
        const xml = await fetchText(SITEMAP);
        const re = /<loc>([^<]+)<\/loc>/g;
        let m;
        while ((m = re.exec(xml)) !== null) seen.add(m[1]);
    } catch (e) { console.warn('sitemap failed:', e.message); }

    // Source 2: wikidayz index (has ~1800 links)
    const wikiHtml = await fetchText(`${BASE}/wikidayz/`);
    const linkRe = /href="(https:\/\/dayz-store\.ru\/[a-zA-Z0-9_-]+\/)"/g;
    let lm;
    while ((lm = linkRe.exec(wikiHtml)) !== null) seen.add(lm[1]);

    return [...seen].filter(u => {
        if (!u.startsWith(BASE)) return false;
        const path = u.slice(BASE.length);
        if (path === '/' || path === '') return false;
        if (SKIP_PREFIXES.some(p => path.startsWith(p))) return false;
        const parts = path.split('/').filter(Boolean);
        return parts.length === 1;
    });
}

function parseItemPage(html, url) {
    const $ = load(html);

    const classname = ($('span.item-class').attr('data-copy') || $('span.item-class').text() || '').trim();
    if (!classname) return null;

    const h1 = $('h1').first().text().trim();
    let nameRu = h1, nameEn = '';
    const slash = h1.indexOf(' / ');
    if (slash !== -1) {
        nameRu = h1.slice(0, slash).trim();
        nameEn = h1.slice(slash + 3).trim();
    }

    let image = $('img.item__image').attr('src') || '';
    if (!image) image = $('meta[property="og:image"]').attr('content') || '';
    if (!image) image = `${BASE}/wp-content/uploads/images/large/${classname}.png`;

    let categorySlug = '', categoryName = '';
    const catLink = $('.kama_breadcrumbs a[href*="/category/"]').last();
    if (catLink.length) {
        categoryName = catLink.text().trim();
        const m = catLink.attr('href').match(/\/category\/([^/]+)\//);
        if (m) categorySlug = m[1];
    } else {
        const anyCat = $('a[href*="/category/"]').first();
        if (anyCat.length) {
            categoryName = anyCat.text().trim();
            const m = anyCat.attr('href').match(/\/category\/([^/]+)\//);
            if (m) categorySlug = m[1];
        }
    }

    const tagSlugs = [];
    $('a[href*="/tag/"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const m = href.match(/\/tag\/([^/]+)\//);
        if (m) tagSlugs.push(m[1]);
    });

    let size = '';
    const bodyText = $('body').text();
    const sizeMatch = bodyText.match(/Размер[^\d]{0,10}(\d+\s*[xх×*]\s*\d+)/i);
    if (sizeMatch) size = sizeMatch[1].replace(/\s+/g, '').toLowerCase();

    const slot = classifySlot(categorySlug, tagSlugs, classname);

    return {
        classname,
        nameRu,
        nameEn,
        slot,
        category: categoryName,
        categorySlug,
        tags: tagSlugs,
        image,
        size,
        url
    };
}

async function pool(items, limit, worker) {
    const results = [];
    let i = 0, done = 0;
    const total = items.length;
    async function run() {
        while (i < items.length) {
            const idx = i++;
            try {
                const r = await worker(items[idx], idx);
                if (r) results.push(r);
            } catch (e) {
                console.error(`[${idx}] ${items[idx]} failed:`, e.message);
            }
            done++;
            if (done % 20 === 0 || done === total) {
                process.stdout.write(`\r  ${done}/${total} done, ${results.length} items`);
            }
        }
    }
    await Promise.all(Array.from({ length: limit }, run));
    process.stdout.write('\n');
    return results;
}

async function main() {
    console.log('1. Fetching sitemap…');
    const urls = await listItemUrls();
    console.log(`   ${urls.length} candidate item URLs`);

    let cache = {};
    if (existsSync(CACHE)) {
        try { cache = JSON.parse(readFileSync(CACHE, 'utf-8')); } catch { cache = {}; }
    }

    console.log(`2. Fetching item pages (concurrency=${CONCURRENCY})…`);
    const items = await pool(urls, CONCURRENCY, async (url) => {
        let parsed = cache[url];
        if (!parsed) {
            const html = await fetchText(url);
            parsed = parseItemPage(html, url);
            if (parsed) cache[url] = parsed;
        }
        if (parsed) {
            // Always re-classify: slot rules may have changed between runs
            parsed.slot = classifySlot(parsed.categorySlug, parsed.tags || [], parsed.classname);
        }
        return parsed;
    });

    items.sort((a, b) => a.classname.localeCompare(b.classname));

    const seen = new Set();
    const unique = [];
    for (const it of items) {
        if (it.slot === 'Skip') continue;
        if (seen.has(it.classname)) continue;
        seen.add(it.classname);
        unique.push(it);
    }

    writeFileSync(CACHE, JSON.stringify(cache), 'utf-8');
    writeFileSync(OUT, JSON.stringify(unique, null, 2), 'utf-8');

    const bySlot = {};
    for (const it of unique) bySlot[it.slot] = (bySlot[it.slot] || 0) + 1;
    console.log(`3. Wrote ${unique.length} unique items to items.json`);
    console.log('   By slot:', bySlot);
}

main().catch(e => { console.error(e); process.exit(1); });
