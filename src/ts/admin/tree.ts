import '../../css/tree.css';
import { escapeHtml } from '../escape';

interface TreeNode {
	name: string;
	path: string;
	leaf: boolean;
	children: TreeNode[];
}

const api = (window as any).favTree as { root: string; nonce: string };

async function apiFetch(endpoint: string, opts: RequestInit = {}) {
	// The caller's headers win; Headers also takes a Headers object or an array.
	const headers = new Headers({ 'Content-Type': 'application/json', 'X-WP-Nonce': api.nonce });
	new Headers(opts.headers).forEach((value, name) => headers.set(name, value));
	const res = await fetch(api.root + endpoint, { ...opts, headers });
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

// --- Selection state ---
const selected = new Set<string>();

function updateSelbar() {
	const bar = document.getElementById('fav-tree-selbar')!;
	const count = document.getElementById('fav-sel-count')!;
	bar.style.display = selected.size ? 'flex' : 'none';
	count.textContent = `${selected.size} geselecteerd`;
}

function toggleSelect(path: string, li: HTMLElement) {
	if (selected.has(path)) {
		selected.delete(path);
		li.classList.remove('fav-selected');
	} else {
		selected.add(path);
		li.classList.add('fav-selected');
	}
	updateSelbar();
}

// --- Drag state ---
let dragSrc: string | null = null;   // the item being dragged (may be one of many selected)

function isAncestor(ancestor: string, descendant: string) {
	return descendant === ancestor || descendant.startsWith(ancestor + '/');
}

async function movePaths(paths: string[], targetDir: string) {
	for (const from of paths) {
		if (isAncestor(from, targetDir)) { alert(`Kan '${from}' niet verplaatsen naar een eigen submap.`); continue; }
		const name = from.split('/').at(-1)!;
		const to   = targetDir ? targetDir + '/' + name : name;
		if (to === from) continue;
		await apiFetch('tree/move', { method: 'POST', body: JSON.stringify({ from, to }) });
	}
}

// --- Tree rendering ---
function renderNode(node: TreeNode, ul: HTMLElement) {
	const li = document.createElement('li');
	li.className = 'fav-tree-node' + (node.leaf ? ' fav-tree-leaf' : '');

	const row = document.createElement('div');
	row.className = 'fav-tree-row';

	// Checkbox
	const cb = document.createElement('input');
	cb.type = 'checkbox';
	cb.className = 'fav-tree-cb';
	cb.style.display = node.path ? '' : 'none';
	cb.addEventListener('change', () => toggleSelect(node.path, li));

	const icon = document.createElement('span');
	icon.className = 'fav-tree-icon';
	icon.textContent = node.leaf ? '📄' : (node.children.length ? '📁' : '📂');

	const label = document.createElement('span');
	label.className = 'fav-tree-label';
	label.textContent = node.name;
	label.ondblclick = () => startRename(label, node);

	row.append(cb, icon, label);

	// Drag — must be on li (the draggable element), not row
	if (node.path) {
		li.draggable = true;
		li.addEventListener('dragstart', (e) => {
			// If this item isn't selected, drag only this item
			if (!selected.has(node.path)) {
				if (selected.size > 0) {
					document.querySelectorAll<HTMLElement>('.fav-selected').forEach(el => el.classList.remove('fav-selected'));
				}
				selected.clear();
			}
			dragSrc = node.path;
			e.dataTransfer!.effectAllowed = 'move';
			e.stopPropagation();
		});
		li.addEventListener('dragend', () => {
			dragSrc = null;
			document.querySelectorAll('.fav-drop-over').forEach(el => el.classList.remove('fav-drop-over'));
		});
	}

	// Drop target on row
	row.addEventListener('dragover', (e) => {
		if (!dragSrc) return;
		const targetDir = node.leaf ? node.path.split('/').slice(0, -1).join('/') : node.path;
		const srcs = selected.size ? [...selected] : [dragSrc];
		if (srcs.some(s => isAncestor(s, targetDir) || s === targetDir)) return;
		e.preventDefault();
		row.classList.add('fav-drop-over');
	});
	row.addEventListener('dragleave', () => row.classList.remove('fav-drop-over'));
	row.addEventListener('drop', async (e) => {
		e.preventDefault();
		row.classList.remove('fav-drop-over');
		if (!dragSrc) return;

		const targetDir = node.leaf ? node.path.split('/').slice(0, -1).join('/') : node.path;
		const srcs = selected.size ? [...selected] : [dragSrc];
		const label = targetDir || 'root';
		if (!confirm(`Verplaats ${srcs.length} map(pen) naar '${label}'?`)) return;

		try {
			await movePaths(srcs, targetDir);
			selected.clear();
			updateSelbar();
			await refresh();
		} catch (err) { alert('Fout: ' + err); }
	});

	// Add subdir button
	const addBtn = document.createElement('button');
	addBtn.className = 'fav-tree-add';
	addBtn.title = 'Nieuwe map';
	addBtn.textContent = '+';
	addBtn.addEventListener('click', async () => {
		const name = prompt('Naam nieuwe map:');
		if (!name) return;
		const path = (node.path ? node.path + '/' : '') + name;
		try { await apiFetch('tree/mkdir', { method: 'POST', body: JSON.stringify({ path }) }); await refresh(); }
		catch (err) { alert('Fout: ' + err); }
	});
	row.appendChild(addBtn);

	li.appendChild(row);

	if (node.children.length) {
		const sub = document.createElement('ul');
		node.children.forEach(c => renderNode(c, sub));
		li.appendChild(sub);
		icon.style.cursor = 'pointer';
		icon.addEventListener('click', () => {
			sub.hidden = !sub.hidden;
			icon.textContent = sub.hidden ? '📁' : (node.leaf ? '📄' : '📂');
		});
	}

	ul.appendChild(li);
}

function startRename(labelEl: HTMLSpanElement, node: TreeNode) {
	const input = document.createElement('input');
	input.value = node.name;
	input.className = 'fav-tree-rename';
	labelEl.replaceWith(input);
	input.focus();
	input.select();

	const commit = async () => {
		const newName = input.value.trim();
		if (!newName || newName === node.name) { input.replaceWith(labelEl); return; }
		const parts = node.path.split('/');
		parts[parts.length - 1] = newName;
		try {
			await apiFetch('tree/move', { method: 'POST', body: JSON.stringify({ from: node.path, to: parts.join('/') }) });
			await refresh();
		} catch (err) { alert('Fout: ' + err); input.replaceWith(labelEl); }
	};

	input.addEventListener('blur', commit);
	input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') input.replaceWith(labelEl); });
}

async function refresh() {
	const tree: TreeNode = await apiFetch('tree');
	const container = document.getElementById('fav-tree-root')!;
	container.innerHTML = '';
	const ul = document.createElement('ul');
	ul.className = 'fav-tree';
	renderNode(tree, ul);
	container.appendChild(ul);
}

async function moveSelected() {
	if (!selected.size) return;
	const dest = prompt('Verplaats naar map (leeg = root):') ?? null;
	if (dest === null) return;
	const targetDir = dest.trim().replace(/^\/|\/$/g, '');
	try {
		await movePaths([...selected], targetDir);
		selected.clear();
		updateSelbar();
		await refresh();
	} catch (err) { alert('Fout: ' + err); }
}

type NormalizeResult = { renamed: { from: string; to: string }[]; dry_run: boolean };

function showNormalizePreview(res: NormalizeResult) {
	const panel = document.getElementById('fav-normalize-panel')!;
	const list  = document.getElementById('fav-normalize-list')!;
	const apply = document.getElementById('fav-normalize-apply') as HTMLButtonElement;

	if (res.renamed.length === 0) {
		panel.style.display = '';
		list.innerHTML = '<em>Geen mappen te hernoemen.</em>';
		apply.style.display = 'none';
		return;
	}

	list.innerHTML = res.renamed.map(r =>
		`<li><code>${escapeHtml(r.from)}</code> → <code>${escapeHtml(r.to)}</code></li>`
	).join('');
	apply.style.display = '';
	panel.style.display = '';
}

async function normalize(dry_run = true) {
	const btn = document.getElementById('fav-tree-normalize') as HTMLButtonElement;
	btn.disabled = true;
	btn.textContent = 'Bezig…';
	try {
		const res: NormalizeResult = await apiFetch('tree/normalize', {
			method: 'POST',
			body: JSON.stringify({ dry_run }),
		});
		if (dry_run) {
			showNormalizePreview(res);
		} else {
			document.getElementById('fav-normalize-panel')!.style.display = 'none';
			await refresh();
		}
	} catch (err) {
		alert('Fout: ' + err);
	} finally {
		btn.disabled = false;
		btn.textContent = '0→01 Normaliseer nummering';
	}
}

type RemapResult = {
	dry_run: boolean;
	mappings?: { old: string; new: string; pages: number }[];
	unmatched?: { new: string; pages: number; norm: string }[];
	unmatched_old?: string[];
	mapped?: number; inserted?: number; deleted?: number;
};

async function remap(dry_run = true) {
	const btn = document.getElementById('fav-tree-remap') as HTMLButtonElement;
	btn.disabled = true;
	btn.textContent = 'Bezig…';
	try {
		const res: RemapResult = await apiFetch('tree/remap', { method: 'POST', body: JSON.stringify({ dry_run }) });
		const panel = document.getElementById('fav-remap-panel')!;
		const list  = document.getElementById('fav-remap-list')!;

		if (!dry_run) {
			panel.style.display = 'none';
			alert(`Klaar — ${res.mapped} collecties hernoemd, ${res.inserted} docs bijgewerkt, ${res.deleted} oud verwijderd.`);
			return;
		}

		const rows = (res.mappings ?? []).map(m =>
			`<tr style="color:green"><td><code>${escapeHtml(m.old)}</code></td><td>→</td><td><code>${escapeHtml(m.new)}</code></td><td style="color:#999">(${escapeHtml(m.pages)}p)</td></tr>`
		);
		const unmatched = (res.unmatched ?? []).map(u =>
			`<tr style="color:#c00"><td colspan="4"><code>${escapeHtml(u.new)}</code> — geen match in index (${escapeHtml(u.pages)}p)</td></tr>`
		);

		const oldUnmatched = (res.unmatched_old ?? []).map(o =>
			`<tr style="color:#999"><td colspan="4"><em>In index maar niet op server:</em> <code>${escapeHtml(o)}</code></td></tr>`
		);

		if (!rows.length && !unmatched.length && !oldUnmatched.length) {
			list.innerHTML = '<em>Niets te hernoemen.</em>';
			document.getElementById('fav-remap-apply')!.style.display = 'none';
		} else {
			list.innerHTML = `<table style="border-collapse:collapse;font-size:.85em;width:100%">${rows.join('')}${unmatched.join('')}${oldUnmatched.join('')}</table>`;
			document.getElementById('fav-remap-apply')!.style.display = rows.length ? '' : 'none';
		}
		panel.style.display = '';
	} catch (err) {
		alert('Fout: ' + err);
	} finally {
		btn.disabled = false;
		btn.textContent = 'Hernoem index…';
	}
}

// Briefly shows a result message in place of the button's own label instead
// of alert(), which blocks the whole tab (and, worse, the extension driving
// it) until someone clicks OK.
function flashButtonStatus(btn: HTMLButtonElement, message: string, resetLabel: string, ms = 4000): void {
	btn.textContent = message;
	setTimeout(() => { btn.textContent = resetLabel; }, ms);
}

async function reindex() {
	const btn = document.getElementById('fav-tree-reindex') as HTMLButtonElement;
	const label = 'Herindex scans';
	btn.disabled = true;
	btn.textContent = 'Bezig…';
	try {
		const res: { indexed: number } = await apiFetch('tree/reindex', { method: 'POST' });
		flashButtonStatus(btn, `Klaar — ${res.indexed} pagina's geïndexeerd.`, label);
	} catch (err) {
		flashButtonStatus(btn, 'Fout: ' + err, label);
	} finally {
		btn.disabled = false;
	}
}

async function reindexContent() {
	const btn = document.getElementById('fav-tree-reindex-content') as HTMLButtonElement;
	const label = "Herindex pagina's";
	btn.disabled = true;
	btn.textContent = 'Bezig…';
	try {
		const res: { indexed: number } = await apiFetch('tree/reindex-content', { method: 'POST' });
		flashButtonStatus(btn, `Klaar — ${res.indexed} pagina's en berichten geïndexeerd.`, label);
	} catch (err) {
		flashButtonStatus(btn, 'Fout: ' + err, label);
	} finally {
		btn.disabled = false;
	}
}

// --- Index stats ---
async function loadIndexStats() {
	const el = document.getElementById('fav-index-stats')!;
	el.innerHTML = '<p><em>Laden…</em></p>';
	try {
		const stats: { uid: string; docs: number; indexing: boolean; primaryKey: string | null }[] =
			await apiFetch('tree/index-stats');
		if (!stats.length) { el.innerHTML = '<p>Geen indexes gevonden.</p>'; return; }
		el.innerHTML = `<table class="widefat striped" style="font-size:.85em;max-width:600px">
			<thead><tr><th>Index</th><th>Documenten</th><th>Status</th></tr></thead>
			<tbody>${stats.map(s =>
				`<tr><td><code>${escapeHtml(s.uid)}</code></td><td>${escapeHtml(s.docs)}</td><td>${s.indexing ? '⟳ bezig' : '✓ klaar'}</td></tr>`
			).join('')}</tbody></table>`;
	} catch (err) {
		el.textContent = 'Fout: ' + err;
	}
}

// --- Index settings ---
async function applyIndexSettings() {
	const btn = document.getElementById('fav-idx-apply') as HTMLButtonElement;
	const msg = document.getElementById('fav-idx-msg')!;
	btn.disabled = true;
	msg.textContent = 'Bezig…';
	try {
		const res = await apiFetch('tree/index-settings', {
			method: 'POST',
			body: JSON.stringify({
				index:       (document.getElementById('fav-idx-name') as HTMLInputElement).value,
				typo_enabled: (document.getElementById('fav-typo-on') as HTMLInputElement).checked,
				one_typo:    (document.getElementById('fav-one-typo') as HTMLInputElement).value,
				two_typos:   (document.getElementById('fav-two-typos') as HTMLInputElement).value,
				separators:  (document.getElementById('fav-separators') as HTMLInputElement).value,
			}),
		});
		msg.textContent = `Toegepast (taak #${res.taskUid ?? '?'})`;
	} catch (err) {
		msg.textContent = 'Fout: ' + err;
	} finally {
		btn.disabled = false;
	}
}

// --- Document editor ---
let docEditorIdx = '';

async function docSearch() {
	const idx   = (document.getElementById('fav-doc-idx') as HTMLInputElement).value;
	const query = (document.getElementById('fav-doc-q') as HTMLInputElement).value;
	const res   = document.getElementById('fav-doc-results')!;
	const editor = document.getElementById('fav-doc-editor')!;
	docEditorIdx = idx;
	res.style.display = '';
	res.innerHTML = '<p>Zoeken…</p>';
	editor.style.display = 'none';
	try {
		const hits: { id: string; text: string; title?: string; collection?: string; page_number?: number }[] =
			await apiFetch('tree/doc-search', { method: 'POST', body: JSON.stringify({ index: idx, query }) });
		if (!hits.length) { res.innerHTML = '<p>Geen resultaten.</p>'; return; }
		res.innerHTML = `<table class="widefat striped" style="font-size:.85em">
			<thead><tr><th>ID</th><th>Pag.</th><th>Preview</th></tr></thead>
			<tbody>${hits.map(h => `<tr style="cursor:pointer" data-id="${encodeURIComponent(h.id)}" data-text="${encodeURIComponent(h.text ?? '')}" data-title="${encodeURIComponent((h.collection || h.id) + (h.page_number ? ' — pagina ' + h.page_number : ''))}">
				<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><code>${escapeHtml(h.id)}</code></td>
				<td>${escapeHtml(h.page_number)}</td>
				<td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml((h.text ?? '').substring(0, 140))}</td>
			</tr>`).join('')}</tbody></table>`;
		res.querySelectorAll<HTMLTableRowElement>('tr[data-id]').forEach(row => {
			row.addEventListener('click', () => {
				(document.getElementById('fav-doc-id') as HTMLInputElement).value    = decodeURIComponent(row.dataset['id'] ?? '');
				(document.getElementById('fav-doc-text') as HTMLTextAreaElement).value = decodeURIComponent(row.dataset['text'] ?? '');
				document.getElementById('fav-doc-title')!.textContent = decodeURIComponent(row.dataset['title'] ?? '');
				(document.getElementById('fav-doc-save-msg') as HTMLElement).textContent = '';
				editor.style.display = '';
			});
		});
	} catch (err) {
		res.textContent = 'Fout: ' + err;
	}
}

async function docSave() {
	const btn = document.getElementById('fav-doc-save') as HTMLButtonElement;
	const msg = document.getElementById('fav-doc-save-msg')!;
	btn.disabled = true;
	msg.textContent = 'Opslaan…';
	try {
		const res = await apiFetch('tree/doc-save', {
			method: 'POST',
			body: JSON.stringify({
				index: docEditorIdx,
				id:    (document.getElementById('fav-doc-id') as HTMLInputElement).value,
				text:  (document.getElementById('fav-doc-text') as HTMLTextAreaElement).value,
			}),
		});
		msg.textContent = `Opgeslagen! (taak #${res.taskUid ?? '?'})`;
	} catch (err) {
		msg.textContent = 'Fout: ' + err;
	} finally {
		btn.disabled = false;
	}
}

document.addEventListener('DOMContentLoaded', () => {
	void refresh();
	document.getElementById('fav-tree-normalize')?.addEventListener('click', () => normalize(true));
	document.getElementById('fav-normalize-apply')?.addEventListener('click', () => normalize(false));
	document.getElementById('fav-tree-remap')?.addEventListener('click', () => remap(true));
	document.getElementById('fav-remap-apply')?.addEventListener('click', () => remap(false));
	document.getElementById('fav-tree-reindex')?.addEventListener('click', reindex);
	document.getElementById('fav-tree-reindex-content')?.addEventListener('click', reindexContent);
	void loadIndexStats();
	document.getElementById('fav-stats-refresh')?.addEventListener('click', loadIndexStats);
	document.getElementById('fav-idx-apply')?.addEventListener('click', applyIndexSettings);
	document.getElementById('fav-doc-search')?.addEventListener('click', docSearch);
	document.getElementById('fav-doc-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') void docSearch(); });
	document.getElementById('fav-doc-save')?.addEventListener('click', docSave);
	document.getElementById('fav-sel-move')?.addEventListener('click', moveSelected);
	document.getElementById('fav-sel-clear')?.addEventListener('click', () => {
		selected.clear();
		document.querySelectorAll('.fav-selected').forEach(el => el.classList.remove('fav-selected'));
		document.querySelectorAll<HTMLInputElement>('.fav-tree-cb').forEach(cb => { cb.checked = false; });
		updateSelbar();
	});
});
