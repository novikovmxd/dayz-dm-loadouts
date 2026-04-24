// DM Loadout Editor — единый модуль
// Всё состояние in-memory; запись через File System Access API.

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const SLOT_ORDER = [
    'Head', 'Mask', 'Eyewear', 'Armband',
    'Body', 'Vest', 'Back', 'Belt',
    'Legs', 'Feet', 'Hands',
    'Weapon_Primary', 'Weapon_Pistol', 'Weapon_Melee'
];

const SLOT_LABELS = {
    Head: 'Голова', Mask: 'Маска', Eyewear: 'Очки', Armband: 'Рукав',
    Body: 'Торс', Vest: 'Жилет', Back: 'Рюкзак', Belt: 'Ремень',
    Legs: 'Ноги', Feet: 'Обувь', Hands: 'Руки',
    Weapon_Primary: 'Оружие', Weapon_Pistol: 'Пистолет', Weapon_Melee: 'Ближний бой',
    Attachment: 'Навесное', Magazine: 'Магазин', Ammo: 'Патроны',
    Grenade: 'Граната', Medical: 'Медицина', Food: 'Еда',
    Tool: 'Инструмент', Container: 'Контейнер', Other: 'Прочее'
};

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

const state = {
    catalog: [],
    byClass: new Map(),
    data: { Sets: [] },
    activeSetIdx: -1,
    fileHandle: null,
    filter: { search: '', slot: '' }
};

// ═══════════════════════════════════════════════════════════════════
// IndexedDB (для хранения FileSystemFileHandle между сессиями)
// ═══════════════════════════════════════════════════════════════════

const IDB_NAME = 'dm-loadout-editor';
const IDB_STORE = 'handles';

function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbGet(key) {
    const db = await idb();
    return new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
        tx.onsuccess = () => res(tx.result);
        tx.onerror = () => rej(tx.error);
    });
}
async function idbSet(key, value) {
    const db = await idb();
    return new Promise((res, rej) => {
        const tx = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, key);
        tx.onsuccess = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

// ═══════════════════════════════════════════════════════════════════
// SERIALIZER (сохраняет порядок ключей и формат чисел как в исходнике)
// ═══════════════════════════════════════════════════════════════════

function ind(n) { return '    '.repeat(n); }

function formatFloat(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (Number.isNaN(n)) return '0.0';
    const s = String(n);
    return s.includes('.') || s.includes('e') ? s : s + '.0';
}
function formatInt(v) {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return String(Number.isFinite(n) ? Math.trunc(n) : 0);
}

function formatArray(arr, depth) {
    if (!arr || !arr.length) return '[]';
    const pad = ind(depth);
    const inner = arr.map(it => ind(depth + 1) + formatItem(it, depth + 1)).join(',\n');
    return `[\n${inner}\n${pad}]`;
}

function formatItem(item, depth) {
    const pad = ind(depth);
    const pad1 = ind(depth + 1);
    const parts = [
        `${pad1}"type": ${JSON.stringify(item.type ?? '')}`,
        `${pad1}"chance": ${formatInt(item.chance ?? 100)}`,
        `${pad1}"health": ${formatFloat(item.health ?? -1)}`,
        `${pad1}"quantity": ${formatFloat(item.quantity ?? -1)}`,
        `${pad1}"ammoCount": ${formatInt(item.ammoCount ?? -1)}`,
        `${pad1}"quickBar": ${formatInt(item.quickBar ?? -1)}`,
        `${pad1}"choices": ${formatArray(item.choices || [], depth + 1)}`,
        `${pad1}"attachments": ${formatArray(item.attachments || [], depth + 1)}`,
        `${pad1}"cargo": ${formatArray(item.cargo || [], depth + 1)}`
    ];
    return `{\n${parts.join(',\n')}\n${pad}}`;
}

function formatSet(s, depth) {
    const pad = ind(depth);
    const pad1 = ind(depth + 1);
    const parts = [
        `${pad1}"Name": ${JSON.stringify(s.Name ?? '')}`,
        `${pad1}"chance": ${formatInt(s.chance ?? 100)}`,
        `${pad1}"items": ${formatArray(s.items || [], depth + 1)}`
    ];
    return `${pad}{\n${parts.join(',\n')}\n${pad}}`;
}

function serialize(data) {
    const sets = (data.Sets || []).map(s => formatSet(s, 2)).join(',\n');
    return `{\n${ind(1)}"Sets": [\n${sets}\n${ind(1)}]\n}\n`;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function inferAmmoCount(classname) {
    const m = classname.match(/_(\d+)Rnd$/i);
    return m ? parseInt(m[1], 10) : -1;
}

function newItem(classname = '') {
    return {
        type: classname,
        chance: 100,
        health: -1,
        quantity: -1,
        ammoCount: inferAmmoCount(classname),
        quickBar: -1,
        choices: [],
        attachments: [],
        cargo: []
    };
}

function classifyItem(classname) {
    const c = state.byClass.get(classname);
    return c ? c.slot : 'Other';
}

function activeSet() {
    return state.data.Sets[state.activeSetIdx];
}

function imageFor(classname) {
    const c = state.byClass.get(classname);
    if (c && c.image) return c.image;
    return `https://dayz-store.ru/wp-content/uploads/images/large/${classname}.png`;
}

function nameFor(classname) {
    const c = state.byClass.get(classname);
    return c ? (c.nameRu || classname) : classname;
}

function toast(msg, cls = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + cls;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ═══════════════════════════════════════════════════════════════════
// CATALOG
// ═══════════════════════════════════════════════════════════════════

async function loadCatalog() {
    const r = await fetch('./items.json');
    state.catalog = await r.json();
    state.byClass = new Map(state.catalog.map(i => [i.classname, i]));

    // Populate slot filter
    const slots = [...new Set(state.catalog.map(i => i.slot))].sort();
    const sel = document.getElementById('catalogSlotFilter');
    for (const s of slots) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = SLOT_LABELS[s] || s;
        sel.appendChild(o);
    }

    document.getElementById('catalogStatus').textContent = `${state.catalog.length} предметов`;
}

function filterCatalog() {
    const q = state.filter.search.toLowerCase();
    const slot = state.filter.slot;
    return state.catalog.filter(i => {
        if (slot && i.slot !== slot) return false;
        if (!q) return true;
        return i.classname.toLowerCase().includes(q) || (i.nameRu || '').toLowerCase().includes(q);
    });
}

function renderCatalog() {
    const grid = document.getElementById('catalogGrid');
    grid.innerHTML = '';
    const items = filterCatalog().slice(0, 300); // cap for performance
    for (const it of items) {
        const el = document.createElement('div');
        el.className = 'item-tile';
        el.draggable = true;
        el.dataset.classname = it.classname;
        el.innerHTML = `
            <img src="${it.image}" alt="" loading="lazy" onerror="this.style.opacity=0.15" />
            <div class="tile-class" title="${it.classname}">${it.classname}</div>
            <div class="tile-name" title="${it.nameRu || ''}">${it.nameRu || ''}</div>
        `;
        el.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', it.classname);
            e.dataTransfer.effectAllowed = 'copy';
        });
        grid.appendChild(el);
    }
    const totalMatch = filterCatalog().length;
    document.getElementById('catalogStatus').textContent =
        `Показано ${items.length} из ${totalMatch} (всего в каталоге: ${state.catalog.length})`;
}

// ═══════════════════════════════════════════════════════════════════
// SETS LIST
// ═══════════════════════════════════════════════════════════════════

function renderSetSelect() {
    const sel = document.getElementById('setSelect');
    sel.innerHTML = '';
    (state.data.Sets || []).forEach((s, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = s.Name || `(без имени #${i})`;
        sel.appendChild(o);
    });
    sel.value = String(state.activeSetIdx);
    const cur = activeSet();
    document.getElementById('setChance').value = cur ? (cur.chance ?? 100) : 100;
}

// ═══════════════════════════════════════════════════════════════════
// CHARACTER SLOTS
// ═══════════════════════════════════════════════════════════════════

function renderCharacter() {
    const slots = document.getElementById('characterSlots');
    const extra = document.getElementById('extraItems');
    slots.innerHTML = '';
    extra.innerHTML = '';
    const set = activeSet();
    if (!set) return;

    const bySlot = new Map();
    for (const s of SLOT_ORDER) bySlot.set(s, []);
    const unclassified = [];
    set.items.forEach((it, idx) => {
        // Find the effective classname for display — use first non-empty choice if type is empty
        let cn = it.type;
        if (!cn && it.choices && it.choices.length) cn = it.choices[0].type;
        const slot = classifyItem(cn);
        if (bySlot.has(slot)) bySlot.get(slot).push({ it, idx, cn });
        else unclassified.push({ it, idx, cn });
    });

    for (const s of SLOT_ORDER) {
        const occupants = bySlot.get(s);
        const box = document.createElement('div');
        box.className = 'slot-box';
        box.dataset.slot = s;
        const first = occupants[0];
        if (first) {
            box.classList.add('occupied');
            box.innerHTML = `
                <span class="slot-label">${SLOT_LABELS[s] || s}</span>
                <img src="${imageFor(first.cn)}" alt="" onerror="this.style.opacity=0.2" />
                ${occupants.length > 1 ? `<span class="slot-count">${occupants.length}</span>` : ''}
            `;
            box.title = occupants.map(o => o.cn || '(choice)').join(', ');
            box.addEventListener('click', () => {
                // scroll tree to first occupant
                const node = document.querySelector(`[data-rootidx="${first.idx}"]`);
                if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        } else {
            box.innerHTML = `<span class="slot-label">${SLOT_LABELS[s] || s}</span><span style="opacity:0.4">пусто</span>`;
        }
        attachDropTarget(box, classname => addRootItem(classname));
        slots.appendChild(box);
    }

    // Extra (non-slot items)
    for (const { it, idx, cn } of unclassified) {
        const box = document.createElement('div');
        box.className = 'slot-box occupied';
        const label = cn || '(choice)';
        box.innerHTML = `
            <span class="slot-label">${SLOT_LABELS[classifyItem(cn)] || '?'}</span>
            <img src="${imageFor(cn)}" alt="" onerror="this.style.opacity=0.2" />
            <span style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${label}</span>
        `;
        box.title = label;
        box.addEventListener('click', () => {
            const node = document.querySelector(`[data-rootidx="${idx}"]`);
            if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        extra.appendChild(box);
    }
    // Drop target on extra area for non-slot items
    attachDropTarget(extra, classname => addRootItem(classname));
}

function addRootItem(classname) {
    const set = activeSet();
    if (!set) { toast('Нет активного сета', 'error'); return; }
    set.items.push(newItem(classname));
    rerender();
}

// ═══════════════════════════════════════════════════════════════════
// DROP TARGETS
// ═══════════════════════════════════════════════════════════════════

function attachDropTarget(el, onDrop) {
    el.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const cn = e.dataTransfer.getData('text/plain');
        if (cn) onDrop(cn);
    });
}

// ═══════════════════════════════════════════════════════════════════
// TREE
// ═══════════════════════════════════════════════════════════════════

function renderTree() {
    const root = document.getElementById('treeRoot');
    root.innerHTML = '';
    const set = activeSet();
    if (!set) {
        root.innerHTML = '<p style="color:var(--muted);padding:10px">Нет активного сета. Нажми ＋ чтобы создать, или загрузи loadouts.json.</p>';
        return;
    }

    const header = document.createElement('div');
    header.className = 'children-label';
    header.innerHTML = `<strong style="color:var(--text)">items</strong>
        <button class="add-btn" data-act="add-root">＋ предмет</button>`;
    header.querySelector('[data-act="add-root"]').addEventListener('click', () => pickClassname(cn => addRootItem(cn)));
    root.appendChild(header);

    set.items.forEach((item, idx) => {
        root.appendChild(renderNode(item, set.items, idx, true));
    });
}

function renderNode(item, parentArr, idx, isRoot) {
    const node = document.createElement('div');
    node.className = 'tree-node' + (isRoot ? ' root-node' : '');
    if (isRoot) node.dataset.rootidx = String(idx);

    const head = document.createElement('div');
    head.className = 'node-head';

    const img = document.createElement('img');
    img.src = imageFor(item.type);
    img.onerror = () => { img.style.opacity = 0.15; };
    head.appendChild(img);

    const typeEl = document.createElement('span');
    typeEl.className = 'node-type' + (item.type ? '' : ' empty');
    typeEl.textContent = item.type || '(choice-группа)';
    typeEl.title = 'Кликни для смены classname';
    typeEl.style.cursor = 'pointer';
    typeEl.addEventListener('click', () => pickClassname(cn => { item.type = cn; if (cn && item.ammoCount === -1) item.ammoCount = inferAmmoCount(cn); rerender(); }));
    head.appendChild(typeEl);

    const name = document.createElement('span');
    name.className = 'node-name';
    name.textContent = item.type ? nameFor(item.type) : '';
    head.appendChild(name);

    // Fields
    const fields = document.createElement('div');
    fields.className = 'node-fields';
    fields.appendChild(makeField('ch', 'chance', item, 'chance', 'int'));
    fields.appendChild(makeField('hp', 'health', item, 'health', 'float'));
    fields.appendChild(makeField('qty', 'quantity', item, 'quantity', 'float'));
    fields.appendChild(makeField('ammo', 'ammoCount', item, 'ammoCount', 'int', 'ammo'));
    // quickBar: 0..9 = HUD слоты 1..10; -1 = не назначать. Применяется
    // при спавне лоадаута в DM -- вещь сразу попадает на указанный слот.
    fields.appendChild(makeField('qb', 'quickBar (0..9 = HUD 1..10, -1 = нет)', item, 'quickBar', 'int'));
    head.appendChild(fields);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'node-actions';
    const btnDel = document.createElement('button');
    btnDel.textContent = '🗑';
    btnDel.title = 'Удалить';
    btnDel.className = 'danger';
    btnDel.addEventListener('click', () => {
        parentArr.splice(idx, 1);
        rerender();
    });
    actions.appendChild(btnDel);
    head.appendChild(actions);

    node.appendChild(head);

    // Children groups
    const children = document.createElement('div');
    children.className = 'node-children';
    children.appendChild(renderGroup('choices', item));
    children.appendChild(renderGroup('attachments', item));
    children.appendChild(renderGroup('cargo', item));
    node.appendChild(children);

    return node;
}

function renderGroup(key, parentItem) {
    const g = document.createElement('div');
    g.className = 'children-group';
    const label = document.createElement('div');
    label.className = 'children-label';
    const count = (parentItem[key] || []).length;
    label.innerHTML = `<span>${key}${count ? ` (${count})` : ''}</span>
        <button class="add-btn">＋</button>`;
    label.querySelector('button').addEventListener('click', () => {
        pickClassname(cn => {
            if (!parentItem[key]) parentItem[key] = [];
            parentItem[key].push(newItem(cn));
            rerender();
        });
    });
    g.appendChild(label);

    const list = document.createElement('div');
    (parentItem[key] || []).forEach((child, i) => {
        list.appendChild(renderNode(child, parentItem[key], i, false));
    });
    g.appendChild(list);

    // drop zone for the group (label area + list)
    attachDropTarget(g, classname => {
        if (!parentItem[key]) parentItem[key] = [];
        parentItem[key].push(newItem(classname));
        rerender();
    });

    return g;
}

function makeField(label, title, obj, key, kind, cls = '') {
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-flex';
    wrap.style.gap = '3px';
    wrap.style.alignItems = 'center';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.title = title;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = kind === 'float' ? 'any' : '1';
    inp.value = obj[key] ?? -1;
    if (cls) inp.className = cls;
    inp.addEventListener('change', () => {
        const v = kind === 'float' ? parseFloat(inp.value) : parseInt(inp.value, 10);
        obj[key] = Number.isFinite(v) ? v : -1;
    });
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    return wrap;
}

// ═══════════════════════════════════════════════════════════════════
// POPOVER: выбор classname из каталога или ручной ввод
// ═══════════════════════════════════════════════════════════════════

function pickClassname(onPick) {
    // Modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:200;
        display:flex;align-items:center;justify-content:center;
    `;
    const panel = document.createElement('div');
    panel.style.cssText = `
        width:520px;max-height:75vh;background:var(--panel);border:1px solid var(--border);
        border-radius:6px;display:flex;flex-direction:column;padding:14px;gap:10px;
    `;
    panel.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center">
            <strong>Выбрать classname</strong>
            <input id="pickSearch" type="search" placeholder="поиск…" style="flex:1" autofocus />
            <button id="pickCancel">✕</button>
        </div>
        <div style="display:flex;gap:6px">
            <input id="pickManual" type="text" placeholder="или введи classname вручную (например, GorkaHelmet)" style="flex:1" />
            <button id="pickManualGo">OK</button>
        </div>
        <div id="pickList" style="flex:1;overflow-y:auto;border-top:1px solid var(--border);padding-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px"></div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    panel.querySelector('#pickCancel').addEventListener('click', close);
    const searchEl = panel.querySelector('#pickSearch');
    const listEl = panel.querySelector('#pickList');
    const manualEl = panel.querySelector('#pickManual');

    function render() {
        const q = searchEl.value.toLowerCase();
        listEl.innerHTML = '';
        const items = state.catalog.filter(i =>
            !q || i.classname.toLowerCase().includes(q) || (i.nameRu || '').toLowerCase().includes(q)
        ).slice(0, 200);
        for (const it of items) {
            const tile = document.createElement('div');
            tile.className = 'item-tile';
            tile.innerHTML = `
                <img src="${it.image}" loading="lazy" onerror="this.style.opacity=0.15" />
                <div class="tile-class">${it.classname}</div>
                <div class="tile-name">${it.nameRu || ''}</div>
            `;
            tile.addEventListener('click', () => { onPick(it.classname); close(); });
            listEl.appendChild(tile);
        }
    }
    searchEl.addEventListener('input', render);
    manualEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && manualEl.value.trim()) {
            onPick(manualEl.value.trim()); close();
        }
    });
    panel.querySelector('#pickManualGo').addEventListener('click', () => {
        if (manualEl.value.trim()) { onPick(manualEl.value.trim()); close(); }
    });
    searchEl.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    render();
    setTimeout(() => searchEl.focus(), 50);
}

// ═══════════════════════════════════════════════════════════════════
// FILE I/O
// ═══════════════════════════════════════════════════════════════════

const HAS_FSA = !!window.showOpenFilePicker;

async function openFile() {
    if (HAS_FSA) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'loadouts.json', accept: { 'application/json': ['.json'] } }]
            });
            state.fileHandle = handle;
            await idbSet('fileHandle', handle);
            await loadFromHandle();
        } catch (e) {
            if (e.name !== 'AbortError') toast('Ошибка открытия: ' + e.message, 'error');
        }
    } else {
        // fallback
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json';
        inp.addEventListener('change', async () => {
            const f = inp.files[0];
            if (!f) return;
            const text = await f.text();
            loadFromText(text);
        });
        inp.click();
    }
}

async function loadFromHandle() {
    const perm = await state.fileHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
        const p = await state.fileHandle.requestPermission({ mode: 'readwrite' });
        if (p !== 'granted') { toast('Нет разрешения на чтение файла', 'error'); return; }
    }
    const file = await state.fileHandle.getFile();
    const text = await file.text();
    loadFromText(text);
    document.getElementById('fileStatus').textContent = state.fileHandle.name;
}

function loadFromText(text) {
    try {
        const parsed = JSON.parse(text);
        if (!parsed.Sets) throw new Error('нет поля Sets');
        // Normalize — ensure every item has all fields
        parsed.Sets.forEach(s => {
            s.Name ??= '';
            s.chance ??= 100;
            s.items = (s.items || []).map(normalizeItem);
        });
        state.data = parsed;
        state.activeSetIdx = parsed.Sets.length ? 0 : -1;
        toast(`Загружено: ${parsed.Sets.length} сетов`, 'ok');
        rerender();
    } catch (e) {
        toast('Невалидный JSON: ' + e.message, 'error');
    }
}

function normalizeItem(it) {
    const out = {
        type: it.type ?? '',
        chance: it.chance ?? 100,
        health: it.health ?? -1,
        quantity: it.quantity ?? -1,
        ammoCount: it.ammoCount ?? -1,
        quickBar: it.quickBar ?? -1,
        choices: (it.choices || []).map(normalizeItem),
        attachments: (it.attachments || []).map(normalizeItem),
        cargo: (it.cargo || []).map(normalizeItem)
    };
    return out;
}

async function saveFile() {
    const text = serialize(state.data);
    if (state.fileHandle) {
        try {
            const perm = await state.fileHandle.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') throw new Error('permission denied');
            const w = await state.fileHandle.createWritable();
            await w.write(text);
            await w.close();
            toast('Сохранено в ' + state.fileHandle.name, 'ok');
        } catch (e) {
            toast('Не удалось сохранить: ' + e.message, 'error');
        }
    } else {
        // нет выбранного файла — попросить сохранить как
        if (HAS_FSA) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'loadouts.json',
                    types: [{ description: 'loadouts.json', accept: { 'application/json': ['.json'] } }]
                });
                state.fileHandle = handle;
                await idbSet('fileHandle', handle);
                const w = await handle.createWritable();
                await w.write(text);
                await w.close();
                document.getElementById('fileStatus').textContent = handle.name;
                toast('Сохранено', 'ok');
            } catch (e) {
                if (e.name !== 'AbortError') toast('Ошибка: ' + e.message, 'error');
            }
        } else {
            downloadFile();
        }
    }
}

function downloadFile() {
    const text = serialize(state.data);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'loadouts.json';
    a.click();
    URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════
// SET MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

function newSet() {
    const name = prompt('Имя нового сета:', 'NewSet');
    if (!name) return;
    state.data.Sets.push({ Name: name, chance: 100, items: [] });
    state.activeSetIdx = state.data.Sets.length - 1;
    rerender();
}

function renameSet() {
    const cur = activeSet();
    if (!cur) return;
    const name = prompt('Новое имя сета:', cur.Name);
    if (!name) return;
    cur.Name = name;
    rerender();
}

function deleteSet() {
    const cur = activeSet();
    if (!cur) return;
    if (!confirm(`Удалить сет "${cur.Name}"?`)) return;
    state.data.Sets.splice(state.activeSetIdx, 1);
    state.activeSetIdx = Math.min(state.activeSetIdx, state.data.Sets.length - 1);
    rerender();
}

// ═══════════════════════════════════════════════════════════════════
// RENDER ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════

function rerender() {
    renderSetSelect();
    renderCharacter();
    renderTree();
}

// ═══════════════════════════════════════════════════════════════════
// WIRING
// ═══════════════════════════════════════════════════════════════════

async function init() {
    await loadCatalog();
    renderCatalog();
    rerender();

    // Catalog filters
    document.getElementById('catalogSearch').addEventListener('input', e => {
        state.filter.search = e.target.value;
        renderCatalog();
    });
    document.getElementById('catalogSlotFilter').addEventListener('change', e => {
        state.filter.slot = e.target.value;
        renderCatalog();
    });

    // Set controls
    document.getElementById('setSelect').addEventListener('change', e => {
        state.activeSetIdx = parseInt(e.target.value, 10);
        rerender();
    });
    document.getElementById('btnNewSet').addEventListener('click', newSet);
    document.getElementById('btnRenameSet').addEventListener('click', renameSet);
    document.getElementById('btnDeleteSet').addEventListener('click', deleteSet);
    document.getElementById('setChance').addEventListener('change', e => {
        const s = activeSet(); if (s) s.chance = parseInt(e.target.value, 10) || 0;
    });

    // File controls
    document.getElementById('btnOpen').addEventListener('click', openFile);
    document.getElementById('btnSave').addEventListener('click', saveFile);
    document.getElementById('btnDownload').addEventListener('click', downloadFile);
    document.getElementById('btnAddRaw').addEventListener('click', () => pickClassname(cn => addRootItem(cn)));

    // Try to restore previous file handle
    if (HAS_FSA) {
        try {
            const handle = await idbGet('fileHandle');
            if (handle) {
                state.fileHandle = handle;
                document.getElementById('fileStatus').textContent = handle.name + ' (нажми «Открыть» для перезагрузки или сразу «Сохранить»)';
            }
        } catch {}
    }

    // Keyboard
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveFile();
        }
    });
}

init().catch(e => { console.error(e); toast('Ошибка инициализации: ' + e.message, 'error'); });
