// Safe web-storage helpers: private-mode / quota failures must never throw
// into panel logic. All getters return null (or a fallback) and all writers
// are best-effort no-ops when storage is unavailable. Function declarations
// (not const arrows) so they hoist across the concatenated IIFE bundle.
function storeGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function storeSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function storeDel(k){try{localStorage.removeItem(k)}catch(e){}}
function sessionGet(k){try{return sessionStorage.getItem(k)}catch(e){return null}}
function sessionSet(k,v){try{sessionStorage.setItem(k,v)}catch(e){}}
function sessionDel(k){try{sessionStorage.removeItem(k)}catch(e){}}
function storeGetJson(k,fb){try{const r=JSON.parse(localStorage.getItem(k)||'null');return r==null?fb:r}catch(e){return fb}}
function sessionGetJson(k){try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch(e){return null}}
