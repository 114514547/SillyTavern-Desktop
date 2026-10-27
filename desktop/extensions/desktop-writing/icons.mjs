// Application-owned paths. Never render model text as SVG markup.
const paths={
 'fa-panel-left':'M3 4h18v16H3V4M9 4v16','fa-panel-right':'M3 4h18v16H3V4M15 4v16','fa-arrow-left':'M20 12H4m6-6-6 6 6 6',
 'fa-copy':'M8 8h13v13H8V8M16 8V3H3v13h5','fa-ellipsis':'M4 12h.01M12 12h.01M20 12h.01',
 'fa-plus':'M12 5v14M5 12h14','fa-xmark':'m6 6 12 12M18 6 6 18',
 'fa-magnifying-glass':'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 'fa-gear':'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2 1-4M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 'fa-folder-open':'M3 7V5h6l2 2h10v4M3 11h19l-4 9H2l1-9',
 'fa-comments':'M21 11a8 8 0 0 1-8 8H5l-4 3 2-6a8 8 0 1 1 18-5',
 'fa-file-pen':'M14 2H5v20h14V7l-5-5v5h5M8 17l6-6 2 2-6 6H8v-2',
 'fa-file-lines':'M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h8',
 'fa-paperclip':'m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10',
 'fa-paper-plane':'m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2',
 'fa-sliders':'M4 3v18M12 3v18M20 3v18M1 8h6M9 16h6M17 8h6',
 'fa-trash-can':'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
 'fa-expand':'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
 'fa-download':'M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5',
 'fa-bars':'M3 6h18M3 12h18M3 18h18','fa-list':'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1',
 'fa-book-open':'M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1v15',
 'fa-stop':'M5 5h14v14H5z','fa-floppy-disk':'M3 3h15l3 3v15H3V3M7 3v6h10V3M7 21v-8h10v8',
 'fa-code-compare':'M6 3v12a3 3 0 0 0 3 3h9m-4-4 4 4-4 4M18 3v7M3 6h6M15 6h6',
 'fa-compass':'m16 8-3 5-5 3 3-5 5-3M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 'fa-book':'M4 3h16v18H4a2 2 0 0 1 0-4h16M4 3v14M8 7h8',
 'fa-file-import':'M14 2H5v20h14V7l-5-5v5h5M1 13h10m-4-4 4 4-4 4',
 'fa-arrow-up':'M12 20V4m-6 6 6-6 6 6','fa-arrow-down':'M12 4v16m-6-6 6 6 6-6',
 'fa-table-columns':'M3 4h18v16H3V4M9 4v16M15 4v16',
 'fa-quote-left':'M4 11h6v8H3v-8c0-4 2-6 5-7M15 11h6v8h-7v-8c0-4 2-6 5-7',
 'fa-camera':'M3 7h4l2-3h6l2 3h4v14H3V7M16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 'fa-clock-rotate-left':'M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v6l4 2',
 'fa-feather-pointed':'M4 21 17 8M8 17c-4-7 3-15 13-14 1 10-7 17-14 13M11 11h7',
 'fa-wand-magic-sparkles':'m4 20 12-12 4 4L8 24M4 4v4M2 6h4M18 2v4M16 4h4',
 'fa-box-archive':'M3 3h18v5H3zM5 8v13h14V8M9 12h6',
 'fa-trash':'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
 'fa-arrow-right-arrow-left':'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
};
export function icon(name){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [key,value]of Object.entries({viewBox:'0 0 24 24',width:'14',height:'14',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
 svg.classList.add('dw-icon');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths['fa-sliders']);svg.append(p);return svg;
}
