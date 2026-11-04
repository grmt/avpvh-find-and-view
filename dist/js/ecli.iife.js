(function(){function e(e){let t=document.createElement(`div`);return t.textContent=e,t.innerHTML}function t(e){let t=e.title||e.collection||e.url;return e.page_number==null?t:`${t} — pagina ${e.page_number}`}function n(e){return e.source_url?e.source_url:e.page_number==null?e.url:`${e.url}#page=${e.page_number}`}function r(r,i){r.innerHTML=i.length?i.map(r=>`
    <div class="fav-ecli-card">
      <div class="fav-ecli-card-header">
        <a class="fav-ecli-id" href="https://uitspraken.rechtspraak.nl/details?id=${encodeURIComponent(r.ecli)}" target="_blank" rel="noopener noreferrer">${e(r.ecli)}</a>
        <span class="fav-ecli-count">${r.citation_count} ${r.citation_count===1?`verwijzing`:`verwijzingen`}</span>
      </div>
      <ul class="fav-ecli-refs">
        ${r.references.map(r=>`<li><a href="${e(n(r))}" target="_blank" rel="noopener noreferrer">${e(t(r))}</a></li>`).join(``)}
      </ul>
    </div>
  `).join(``):`<p class="fav-ecli-empty">Geen ECLI's gevonden.</p>`}function i(e){let t=document.getElementById(e.uid);if(!t)return;let n=t.querySelector(`.fav-ecli-search-input`),i=t.querySelector(`.fav-ecli-results`),a=t.querySelector(`.fav-ecli-hint`);if(!n||!i)return;let o=/^ECLI:[A-Z]{2}:[A-Z0-9.]+:\d{4}:[A-Z0-9]+$/i,s=t=>{let n=o.test(t);fetch(`${e.meiliUrl}/indexes/${e.ecliIndex}/search`,{method:`POST`,headers:{Authorization:`Bearer ${e.meiliKey}`,"Content-Type":`application/json`},body:JSON.stringify(n?{q:``,filter:`ecli = "${t.toUpperCase()}"`,limit:1}:{q:t,limit:50,...t?{}:{sort:[`citation_count:desc`]}})}).then(e=>e.json()).then(e=>r(i,e.hits??[])).catch(()=>{i.innerHTML=`<p class="fav-ecli-empty">Kon niet zoeken.</p>`}),a&&(a.style.display=t?`none`:``)},c;n.addEventListener(`input`,()=>{window.clearTimeout(c),c=window.setTimeout(()=>s(n.value.trim()),250)}),s(``)}(window.favEcliInstances??[]).forEach(i)})();