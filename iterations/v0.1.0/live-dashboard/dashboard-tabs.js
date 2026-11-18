"use strict";
(() => {
  const ids=["legacy","mexc"];
  function select(id,focus=false) {
    for(const name of ids) {
      const selected=name===id,tab=document.getElementById(`${name}Tab`);
      tab.setAttribute("aria-selected",String(selected));tab.tabIndex=selected?0:-1;
      document.getElementById(`${name}Panel`).hidden=!selected;
      if(selected && focus)tab.focus();
    }
    document.getElementById("legacyHeaderActions").hidden=id!=="legacy";
    document.dispatchEvent(new CustomEvent("dashboard:tab",{detail:id}));
  }
  for(const [index,id] of ids.entries()) {
    const tab=document.getElementById(`${id}Tab`);
    tab.addEventListener("click",()=>{history.replaceState(null,"",`#${id}`);select(id);});
    tab.addEventListener("keydown",e=>{
      const next=e.key==="Home"?0:e.key==="End"?1:["ArrowLeft","ArrowRight"].includes(e.key)?1-index:null;
      if(next===null)return;e.preventDefault();history.replaceState(null,"",`#${ids[next]}`);select(ids[next],true);
    });
  }
  const fromHash=()=>select(location.hash==="#mexc"?"mexc":"legacy");
  window.addEventListener("hashchange",fromHash);fromHash();
})();
