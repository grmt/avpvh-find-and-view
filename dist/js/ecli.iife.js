(function(){"use strict";function r(e){const n=document.createElement("div");return n.textContent=e,n.innerHTML}function u(e){const n=e.title||e.collection||e.url;return e.page_number!=null?`${n} — pagina ${e.page_number}`:n}function f(e){return e.page_number!=null?`${e.url}#page=${e.page_number}`:e.url}function p(e,n){if(!n.length){e.innerHTML=`<p class="fav-ecli-empty">Geen ECLI's gevonden.</p>`;return}e.innerHTML=n.map(t=>`
    <div class="fav-ecli-card">
      <div class="fav-ecli-card-header">
        <a class="fav-ecli-id" href="https://uitspraken.rechtspraak.nl/details?id=${encodeURIComponent(t.ecli)}" target="_blank" rel="noopener noreferrer">${r(t.ecli)}</a>
        <span class="fav-ecli-count">${t.citation_count} ${t.citation_count===1?"verwijzing":"verwijzingen"}</span>
      </div>
      <ul class="fav-ecli-refs">
        ${t.references.map(i=>`<li><a href="${r(f(i))}" target="_blank" rel="noopener noreferrer">${r(u(i))}</a></li>`).join("")}
      </ul>
    </div>
  `).join("")}function d(e){const n=document.getElementById(e.uid);if(!n)return;const t=n.querySelector(".fav-ecli-search-input"),i=n.querySelector(".fav-ecli-results"),a=n.querySelector(".fav-ecli-hint");if(!t||!i)return;const m=/^ECLI:[A-Z]{2}:[A-Z0-9.]+:\d{4}:[A-Z0-9]+$/i,o=l=>{const v=m.test(l);fetch(`${e.meiliUrl}/indexes/${e.ecliIndex}/search`,{method:"POST",headers:{Authorization:`Bearer ${e.meiliKey}`,"Content-Type":"application/json"},body:JSON.stringify(v?{q:"",filter:`ecli = "${l.toUpperCase()}"`,limit:1}:{q:l,limit:50,...l?{}:{sort:["citation_count:desc"]}})}).then(c=>c.json()).then(c=>p(i,c.hits??[])).catch(()=>{i.innerHTML='<p class="fav-ecli-empty">Kon niet zoeken.</p>'}),a&&(a.style.display=l?"none":"")};let s;t.addEventListener("input",()=>{window.clearTimeout(s),s=window.setTimeout(()=>o(t.value.trim()),250)}),o("")}(window.favEcliInstances??[]).forEach(d)})();
