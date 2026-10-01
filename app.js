const $ = id => document.getElementById(id);

const state = {
  results: [],
  exportRows: [],
  model: null,
  view: 'nfa',
  selectedTrace: null,
  traceStep: 0,
  timer: null
};

const defaultCase = {
  regex: 'a(b+c)*',
  strings: 'a\nab\nac\nabb\nabc\nacb\nacc\nabcb\n!\nb\nc\nba\naa\nbaa\nabcx\na1\nca'
};

const examples = [
  defaultCase,
  { regex: '(0|1)*01', strings: '01\n101\n1101\n0001\n111\n01010\nabc01' },
  { regex: '(a|b)*abb', strings: 'abb\naabb\nababb\naaaa\nbbbabb\naba' }
];

function escapeHTML(v) {
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function buildFlags() { return [...document.querySelectorAll('.flag input:checked')].map(x => x.value).join(''); }
function getPattern() {
  return { source: $('regexInput').value, flags: buildFlags(), full: $('fullMatch').checked };
}
function updatePreview() { const p = getPattern(); $('regexPreview').textContent = `/${p.source}/${p.flags || '∅'}`; }
function symbolLabel(ch) { if(ch === ' ') return '␠'; if(ch === '\t') return '⇥'; if(ch === '\n') return '↵'; return ch; }
function formatSet(chars) { return [...chars].sort((a,b)=>a.localeCompare(b)).map(symbolLabel).join(''); }

/* ------------------------------
   Parser de expresiones regulares
   ------------------------------ */
class RegexParser {
  constructor(source, caseInsensitive=false) {
    this.source = source;
    this.i = 0;
    this.caseInsensitive = caseInsensitive;
  }
  parse() {
    let s = this.source.trim();
    if (s.startsWith('^')) s = s.slice(1);
    if (s.endsWith('$') && !this.isEscapedAt(s, s.length - 1)) s = s.slice(0, -1);
    this.source = s;
    this.i = 0;
    const ast = this.parseAlt();
    if (this.i < this.source.length) this.error(`Símbolo inesperado "${this.source[this.i]}".`);
    return ast || {type:'epsilon'};
  }
  isEscapedAt(s, pos) { let n=0; for(let j=pos-1;j>=0 && s[j]==='\\';j--) n++; return n%2===1; }
  error(msg) { throw new Error(msg + ` Posición ${this.i + 1}.`); }
  peek() { return this.source[this.i] ?? ''; }
  parseAlt() {
    const parts = [this.parseConcat()];
    while (this.peek() === '|' || this.peek() === '+') { this.i++; parts.push(this.parseConcat()); }
    return parts.length===1 ? parts[0] : {type:'alt', parts};
  }
  parseConcat() {
    const parts=[];
    while (this.i < this.source.length && !')|+'.includes(this.peek())) parts.push(this.parsePostfix());
    if (!parts.length) return {type:'epsilon'};
    return parts.length===1 ? parts[0] : {type:'concat', parts};
  }
  parsePostfix() {
    let atom = this.parseAtom();
    while (true) {
      const c=this.peek();
      if (c==='*' || c==='?') { this.i++; atom={type:c==='*'?'star':'opt', child:atom}; continue; }
      if (c==='{') {
        const start=this.i; const q=this.parseRepeat(); if (!q) { this.i=start; break; }
        atom={type:'repeat', child:atom, min:q.min, max:q.max}; continue;
      }
      break;
    }
    return atom;
  }
  parseRepeat() {
    const start=this.i; this.i++;
    let a=''; while(/\d/.test(this.peek())) a += this.source[this.i++];
    if (!a) { this.i=start; return null; }
    let min=Number(a), max=min;
    if (this.peek()===',') {
      this.i++; let b=''; while(/\d/.test(this.peek())) b += this.source[this.i++];
      max=b===''?Infinity:Number(b);
    }
    if (this.peek()!=='}') this.error('Repetición incompleta: usa {m}, {m,} o {m,n}.');
    this.i++;
    if (max!==Infinity && max<min) this.error('En {m,n}, n debe ser mayor o igual que m.');
    return {min,max};
  }
  parseAtom() {
    const c=this.peek();
    if (!c) return {type:'epsilon'};
    if (c==='(') {
      this.i++;
      if (this.source.slice(this.i,this.i+2)==='?:') this.i += 2;
      const inside=this.parseAlt();
      if (this.peek()!==')') this.error('Falta cerrar el paréntesis.');
      this.i++; return inside;
    }
    if (c===')') this.error('Paréntesis de cierre inesperado.');
    if (c==='[') return this.parseClass();
    if (c==='.') { this.i++; return {type:'any'}; }
    if ('|*+?{}'.includes(c)) this.error(`El operador "${c}" necesita un elemento anterior.`);
    if (c==='\\') return this.parseEscape(false);
    this.i++; return {type:'literal', value:c};
  }
  parseEscape(inClass) {
    this.i++; const c=this.peek();
    if (!c) this.error('Secuencia de escape incompleta.');
    this.i++;
    if (c==='d') return {type:'class', set:digits()};
    if (c==='w') return {type:'class', set:wordChars()};
    if (c==='s') return {type:'class', set:new Set([' ','\t','\n','\r'])};
    if (c==='t') return {type:'literal', value:'\t'};
    if (c==='n') return {type:'literal', value:'\n'};
    if (c==='r') return {type:'literal', value:'\r'};
    if (c==='f') return {type:'literal', value:'\f'};
    return {type:'literal', value:c};
  }
  parseClass() {
    this.i++; let neg=false;
    if (this.peek()==='^') { neg=true; this.i++; }
    const set=new Set(); let closed=false;
    while(this.i < this.source.length) {
      if (this.peek()===']') { this.i++; closed=true; break; }
      const firstUnit=this.readClassUnit();
      if (this.peek()==='-' && this.source[this.i+1]!==']' && firstUnit.size===1) {
        this.i++; const secondUnit=this.readClassUnit();
        if (secondUnit.size!==1) this.error('El extremo de un rango debe ser un solo carácter.');
        const first=[...firstUnit][0], second=[...secondUnit][0];
        const a=first.codePointAt(0), b=second.codePointAt(0);
        if (a>b) this.error('Rango inválido en conjunto de caracteres.');
        for(let cp=a;cp<=b;cp++) set.add(String.fromCodePoint(cp));
      } else firstUnit.forEach(ch=>set.add(ch));
    }
    if (!closed) this.error('Falta cerrar el conjunto [...].');
    return {type:'class', set, negate:neg};
  }
  readClassUnit() {
    if (this.peek()==='\\') {
      const node=this.parseEscape(true);
      if (node.type==='class') return new Set(node.set);
      return new Set([node.value]);
    }
    const c=this.peek(); this.i++; return new Set([c]);
  }
}
function digits(){ const s=new Set(); for(let i=0;i<=9;i++) s.add(String(i)); return s; }
function wordChars(){ const s=new Set(); for(let i=48;i<=57;i++)s.add(String.fromCharCode(i)); for(let i=65;i<=90;i++)s.add(String.fromCharCode(i)); for(let i=97;i<=122;i++)s.add(String.fromCharCode(i)); s.add('_'); return s; }

function matcherFromNode(node, caseInsensitive) {
  if(node.type==='literal') return {kind:'chars', set:new Set([caseInsensitive?node.value.toLocaleLowerCase():node.value]), caseInsensitive};
  if(node.type==='any') return {kind:'any', caseInsensitive};
  if(node.type==='class') return {kind:'class', set:node.set, negate:!!node.negate, caseInsensitive};
  throw new Error('Nodo no convertible a transición.');
}
function matcherMatches(m, ch) {
  const c=m.caseInsensitive ? ch.toLocaleLowerCase() : ch;
  if(m.kind==='any') return true;
  if(m.kind==='chars') return m.set.has(c) || (m.caseInsensitive && m.set.has(ch.toLocaleLowerCase()));
  if(m.kind==='class') {
    let ok=m.set.has(c);
    if (!ok && m.caseInsensitive) ok=m.set.has(ch.toLocaleUpperCase());
    return m.negate ? !ok : ok;
  }
  return false;
}
function matcherLabel(m) {
  if(m.kind==='any') return '·';
  if(m.kind==='chars') return [...m.set].map(symbolLabel).join('');
  if(m.kind==='class') return `${m.negate?'[^':'['}${[...m.set].slice(0,20).map(symbolLabel).join('')}${m.set.size>20?'…':''}]`;
  return '?';
}

/* ------------------------------
   Thompson NFA
   ------------------------------ */
function buildNFA(ast, caseInsensitive=false) {
  const states=[]; let id=0;
  const newState=()=>{const s={id:id++, eps:[], trans:[], final:false}; states.push(s); return s;};
  function frag(node) {
    if(node.type==='epsilon'){const a=newState(),b=newState();a.eps.push(b);return [a,b];}
    if(['literal','class','any'].includes(node.type)){const a=newState(),b=newState();a.trans.push({to:b,matcher:matcherFromNode(node,caseInsensitive)});return [a,b];}
    if(node.type==='concat'){
      let [s,e]=frag(node.parts[0]);
      for(let i=1;i<node.parts.length;i++){const [s2,e2]=frag(node.parts[i]);e.eps.push(s2);e=e2;}
      return [s,e];
    }
    if(node.type==='alt'){
      const s=newState(),e=newState();
      node.parts.forEach(p=>{const [a,b]=frag(p);s.eps.push(a);b.eps.push(e);}); return [s,e];
    }
    if(node.type==='star'){
      const s=newState(),e=newState(); const [a,b]=frag(node.child);s.eps.push(e,a);b.eps.push(a,e);return [s,e];
    }
    if(node.type==='plus'){
      const s=newState(),e=newState(); const [a,b]=frag(node.child);s.eps.push(a);b.eps.push(a,e);return [s,e];
    }
    if(node.type==='opt'){
      const s=newState(),e=newState(); const [a,b]=frag(node.child);s.eps.push(e,a);b.eps.push(e);return [s,e];
    }
    if(node.type==='repeat'){
      const parts=[];
      for(let i=0;i<node.min;i++) parts.push(node.child);
      if(node.max===Infinity) parts.push({type:'star', child:node.child});
      else for(let i=0;i<node.max-node.min;i++) parts.push({type:'opt', child:node.child});
      return parts.length ? frag(parts.length===1 ? parts[0] : {type:'concat',parts}) : frag({type:'epsilon'});
    }
    throw new Error('Construcción no soportada.');
  }
  const [start,end]=frag(ast); end.final=true;
  return {states,start,end};
}

function epsilonClosure(seed) {
  const out=new Set(seed), stack=[...seed];
  while(stack.length){const s=stack.pop(); for(const t of s.eps){if(!out.has(t)){out.add(t);stack.push(t);}}}
  return out;
}
function epsilonClosureTrace(seed) {
  const out=new Set(seed), stack=[...seed], edges=[];
  while(stack.length){const s=stack.pop(); for(const t of s.eps){edges.push(`${s.id}>${t.id}`); if(!out.has(t)){out.add(t);stack.push(t);}}}
  return {set:out, edges:[...new Set(edges)]};
}
function moveNFA(nfa, set, ch) {
  const out=[]; for(const s of set) for(const t of s.trans) if(matcherMatches(t.matcher,ch)) out.push(t.to);
  return epsilonClosure(out);
}

function collectAstAlphabet(node, out=new Set()) {
  if (!node) return out;
  if (node.type==='literal') out.add(node.value);
  else if (node.type==='class') node.set.forEach(ch=>out.add(ch));
  else if (node.type==='concat' || node.type==='alt') node.parts.forEach(p=>collectAstAlphabet(p,out));
  else if (node.child) collectAstAlphabet(node.child,out);
  return out;
}
function buildDFA(nfa, testStrings, ast) {
  const observed=new Set([...testStrings].flatMap(s=>[...s]));
  collectAstAlphabet(ast, observed);
  // Mantiene un alfabeto finito y visualizable: símbolos relevantes + un representante de "otros".
  let sentinel='\uE000';
  while(observed.has(sentinel)) sentinel=String.fromCharCode(sentinel.charCodeAt(0)+1);
  const symbols=[...observed].sort((a,b)=>a.localeCompare(b));
  symbols.push(sentinel);
  const startSet=epsilonClosure([nfa.start]);
  const keyOf=set=>[...set].map(s=>s.id).sort((a,b)=>a-b).join(',');
  const map=new Map(); const states=[]; const queue=[];
  function add(set){const key=keyOf(set);if(map.has(key))return map.get(key);const d={id:states.length,set,key,final:[...set].some(s=>s.final),trans:new Map()};map.set(key,d);states.push(d);queue.push(d);return d;}
  const start=add(startSet);
  while(queue.length){
    const d=queue.shift();
    for(const ch of symbols){const target=moveNFA(nfa,d.set,ch); if(!target.size) continue; const to=add(target); d.trans.set(ch,to.id);}
  }
  return {states,start,alphabet:symbols.filter(s=>s!==sentinel),sentinel};
}

function nfaStateIds(set){ return [...set].map(s=>s.id).sort((a,b)=>a-b); }
function simulateNFA(nfa, value){
  let initial=epsilonClosureTrace([nfa.start]);
  let current = initial.set;
  const steps = [{index:0, symbol:null, states:nfaStateIds(current), edges:initial.edges, explanation:'Configuración inicial: cierre-ε del estado inicial.'}];
  let stepIndex = 0;
  for(const ch of [...value]){
    const moveStates = new Set();
    const usedEdges = [];
    for(const s of current){
      for(const t of s.trans){
        if(matcherMatches(t.matcher, ch)){
          moveStates.add(t.to);
          usedEdges.push(`${s.id}>${t.to.id}`);
        }
      }
    }
    const closure=epsilonClosureTrace([...moveStates]);
    const next = closure.set;
    stepIndex++;
    const allEdges=[...new Set([...usedEdges,...closure.edges])];
    const explanation = next.size
      ? `Se lee “${symbolLabel(ch)}”, se avanzan las transiciones válidas y se aplica el cierre-ε. Quedan activos ${next.size} estado${next.size===1?'':'s'}.`
      : `Se lee “${symbolLabel(ch)}” y no existe transición válida.`;
    steps.push({index:stepIndex, symbol:ch, states:nfaStateIds(next), edges:allEdges, explanation});
    current = next;
    if(!current.size) break;
  }
  const accepted = current.has(nfa.end);
  return {accepted, steps, finalStates:nfaStateIds(current), consumed:[...value].slice(0,steps.length-1)};
}

function simulateDFA(dfa, value, fullMatch) {
  let current=dfa.start.id; const path=[current]; const symbols=[]; let firstAccept=null;
  for(const ch of [...value]){
    const sym=dfa.alphabet.includes(ch)?ch:dfa.sentinel;
    symbols.push(sym);
    const next=dfa.states[current].trans.get(sym);
    if(next==null){
      path.push(null);
      return {accepted:!fullMatch && dfa.states[current].final, path, symbols, stopped:true, stopIndex:symbols.length-1, finalState:current};
    }
    current=next; path.push(current);
    if(firstAccept==null && dfa.states[current].final) firstAccept=symbols.length-1;
    if(!fullMatch && dfa.states[current].final) return {accepted:true,path,symbols,stopped:false,stopIndex:symbols.length-1,finalState:current};
  }
  return {accepted:!!dfa.states[current].final,path,symbols,stopped:false,stopIndex:symbols.length-1,finalState:current,firstAccept};
}

/* ------------------------------
   SVG graph
   ------------------------------ */
function svgEl(tag, attrs={}){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;}
function addText(svg,x,y,text,cls='node-label'){const t=svgEl('text',{x,y,class:cls});t.textContent=text;svg.appendChild(t);return t;}
function graphModel(model, view){
  if(view==='dfa') return {states:model.dfa.states.map(s=>({id:s.id,final:s.final,start:s.id===model.dfa.start.id})),edges:[...model.dfa.states.flatMap(s=>[...s.trans.entries()].map(([sym,to])=>({from:s.id,to,label:sym}))) ]};
  return {states:model.nfa.states.map(s=>({id:s.id,final:s.final,start:s.id===model.nfa.start.id})),edges:[...model.nfa.states.flatMap(s=>s.eps.map(t=>({from:s.id,to:t.id,label:'ε'})).concat(s.trans.map(t=>({from:s.id,to:t.to.id,label:matcherLabel(t.matcher)}))))]};
}
function layoutGraph(g){
  const dist=new Map(); const q=[g.states.find(s=>s.start)?.id ?? 0]; dist.set(q[0],0);
  const outgoing=new Map(); g.edges.forEach(e=>{if(!outgoing.has(e.from))outgoing.set(e.from,[]);outgoing.get(e.from).push(e.to)});
  while(q.length){const u=q.shift();for(const v of(outgoing.get(u)||[])){if(!dist.has(v)){dist.set(v,dist.get(u)+1);q.push(v)}}}
  g.states.forEach(s=>{if(!dist.has(s.id))dist.set(s.id,Math.max(0,...dist.values())+1)});
  const max=Math.max(...dist.values(),0); const columns=Array.from({length:max+1},()=>[]); g.states.forEach(s=>columns[dist.get(s.id)].push(s));
  columns.forEach(col=>col.sort((a,b)=>a.id-b.id));
  const xGap=165,yGap=88,left=105,top=62; const pos=new Map(); let width=left*2+(max+1)*xGap;
  columns.forEach((col,i)=>{const height=Math.max(1,col.length)*yGap;col.forEach((s,j)=>pos.set(s.id,{x:left+i*xGap,y:top+j*yGap+(Math.max(0,430-height)/2)}));});
  const maxNodes=Math.max(...columns.map(c=>c.length),1); const height=Math.max(380,Math.min(980,maxNodes*yGap+120));
  return {pos,width,height};
}
function edgePath(a,b,self=false,offset=0){
  if(self){return `M ${a.x} ${a.y-25} C ${a.x+48} ${a.y-78} ${a.x+48} ${a.y+26} ${a.x+2} ${a.y-25}`;}
  const dx=b.x-a.x, dy=b.y-a.y; if(Math.abs(dx)<28){const c1x=a.x+52+offset,c2x=b.x+52+offset;return `M ${a.x+25} ${a.y} C ${c1x} ${a.y-52} ${c2x} ${b.y+52} ${b.x+25} ${b.y}`;}
  const bend=Math.max(24,Math.min(100,Math.abs(dx)*.24)); const sign=dy>=0?1:-1; return `M ${a.x+25} ${a.y} C ${a.x+dx*.35} ${a.y+sign*bend} ${b.x-dx*.35} ${b.y-sign*bend} ${b.x-25} ${b.y}`;
}
function currentTraceSnapshot(result){
  if(!result) return null;
  const idx=Math.max(0,Math.min(state.traceStep, result.sim.nfa.steps.length-1));
  return result.sim.nfa.steps[idx];
}
function renderGraph(model, view, traceResult=null){
  const svg=$('automatonSvg'); svg.innerHTML=''; const g=graphModel(model,view); const layout=layoutGraph(g); svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`); svg.style.width=`${Math.max(880,layout.width)}px`; svg.style.height=`${layout.height}px`;
  const defs=svgEl('defs');
  const marker=svgEl('marker',{id:'arrow',markerWidth:8,markerHeight:8,refX:8,refY:4,orient:'auto'}); marker.appendChild(svgEl('path',{d:'M0,0 L8,4 L0,8 z',fill:'#8aa5bf'})); defs.appendChild(marker);
  const markerA=svgEl('marker',{id:'arrowActive',markerWidth:9,markerHeight:9,refX:9,refY:4.5,orient:'auto'}); markerA.appendChild(svgEl('path',{d:'M0,0 L9,4.5 L0,9 z',fill:'#00b8d9'})); defs.appendChild(markerA);
  svg.appendChild(defs);
  addText(svg,18,24,view==='dfa'?'DFA · CONSTRUCCIÓN POR SUBCONJUNTOS':'NFA · ESTILO JFLAP · CONSTRUCCIÓN DE THOMPSON','graph-title');

  const activeStates=new Set(); const activeEdges=new Set();
  if(traceResult){
    if(view==='dfa'){
      const path=traceResult.sim.path.filter(x=>x!=null);
      const upto=Math.min(state.traceStep, path.length-1);
      for(let i=0;i<=upto;i++) activeStates.add(path[i]);
      for(let i=0;i<upto;i++) activeEdges.add(`${path[i]}>${path[i+1]}`);
    } else {
      const snap=currentTraceSnapshot(traceResult);
      if(snap){snap.states.forEach(id=>activeStates.add(id)); snap.edges.forEach(k=>activeEdges.add(k));}
    }
  }
  const pos=layout.pos;
  const start=g.states.find(s=>s.start); if(start){const p=pos.get(start.id);svg.appendChild(svgEl('path',{d:`M ${p.x-68} ${p.y} L ${p.x-28} ${p.y}`,class:'start-arrow',markerEnd:'url(#arrowActive)'}));}
  const grouped=new Map(); g.edges.forEach(e=>{const k=`${e.from}>${e.to}`;if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(e);});
  for(const [key,edges] of grouped){const [from,to]=key.split('>').map(Number);const a=pos.get(from),b=pos.get(to);const self=from===to;const d=edgePath(a,b,self,0);const active=activeEdges.has(key);const path=svgEl('path',{d,class:`${view==='dfa'?'dfa-edge':'nfa-edge'} ${active?'edge-active':''}`,markerEnd:`url(#${active?'arrowActive':'arrow'})`});svg.appendChild(path);
    const label=edges.map(e=>e.label).join(' / '); let lx,ly;if(self){lx=a.x+38;ly=a.y-50}else{lx=(a.x+b.x)/2;ly=(a.y+b.y)/2-8} addText(svg,lx,ly,label,'edge-label');
  }
  for(const s of g.states){const p=pos.get(s.id);const active=activeStates.has(s.id);const circle=svgEl('circle',{cx:p.x,cy:p.y,r:27,class:`node ${s.start?'start ':''}${s.final?'final ':''}${active?'active':''}`});svg.appendChild(circle);if(s.final)svg.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:21,fill:'none',stroke:'#16a34a','stroke-width':2.5}));addText(svg,p.x,p.y,`q${s.id}`,'node-label');}
  if(traceResult){
    const snap=view==='nfa'?currentTraceSnapshot(traceResult):null;
    const note=view==='nfa'
      ? `Activos: {${(snap?.states||[]).map(id=>`q${id}`).join(', ')||'∅'}}`
      : `Estado actual: q${traceResult.sim.path[Math.min(state.traceStep,traceResult.sim.path.length-1)] ?? '∅'}`;
    addText(svg,18,layout.height-18,note,'graph-status');
  }
  $('graphEmpty').classList.add('hidden');
}
function updateAutomatonMeta(model){
  const states=state.view==='dfa'?model.dfa.states.length:model.nfa.states.length; const finals=state.view==='dfa'?model.dfa.states.filter(s=>s.final).length:model.nfa.states.filter(s=>s.final).length;
  const alpha=[...model.dfa.alphabet].map(symbolLabel).join(' ') || 'ε';
  $('automatonMeta').innerHTML=`<div><span>Estados ${state.view.toUpperCase()}</span><strong>${states}</strong></div><div><span>Estados finales</span><strong>${finals}</strong></div><div><span>Alfabeto</span><strong>${escapeHTML(alpha)}</strong></div><div><span>Construcción</span><strong>Thompson → subconjuntos</strong></div>`;
  $('automatonSummary').textContent=`Para “a(b+c)*”, el autómata obliga a leer “a” y después permite cualquier combinación de b y c. El NFA se recorre con configuraciones activas; el DFA resume esas configuraciones.`;
}

function fillTraceSelect(){
  const sel=$('traceSelect'); sel.innerHTML='<option value="">Recorrido: selecciona una cadena</option>';
  state.results.forEach((r,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${String(i+1).padStart(2,'0')} · ${r.value || 'ε'} · ${r.accepted?'ACEPTADA':'RECHAZADA'}`;sel.appendChild(o);});
  if(state.selectedTrace!=null)sel.value=String(state.selectedTrace);
}
function renderTracePanel(){
  const idx=state.selectedTrace; const panel=$('tracePanel');
  if(idx==null||!state.results[idx]){panel.classList.remove('has-trace');$('traceTitle').textContent='Ninguna cadena seleccionada';$('traceBadge').textContent='—';$('traceBadge').className='badge neutral';$('traceSteps').innerHTML='';$('traceConfig').textContent='—';$('traceStepLabel').textContent='Paso 0 / 0';return;}
  const r=state.results[idx]; panel.classList.add('has-trace');
  const totalSteps=r.sim.nfa.steps.length; state.traceStep=Math.max(0,Math.min(state.traceStep,totalSteps-1));
  $('traceTitle').textContent=`Cadena ${String(idx+1).padStart(2,'0')}: ${r.value||'ε'}`;
  $('traceBadge').textContent=r.accepted?'ACEPTADA':'RECHAZADA'; $('traceBadge').className=`badge ${r.accepted?'accepted':'rejected'}`;
  $('traceStepLabel').textContent=`Paso ${state.traceStep} / ${Math.max(0,totalSteps-1)}`;
  const current=r.sim.nfa.steps[state.traceStep];
  $('traceConfig').textContent = state.view==='nfa'
    ? `{${current.states.map(id=>`q${id}`).join(', ')||'∅'}}`
    : `q${r.sim.path[Math.min(state.traceStep,r.sim.path.length-1)] ?? '∅'}`;
  const steps=$('traceSteps'); steps.innerHTML='';
  r.sim.nfa.steps.forEach((step,i)=>{
    const card=document.createElement('button'); card.type='button'; card.className=`trace-step-card ${i===state.traceStep?'active':''}`;
    card.innerHTML=`<span class="trace-step-number">${i}</span><span><strong>${i===0?'Inicio':`lee “${escapeHTML(symbolLabel(step.symbol))}”`}</strong><small>${i===0?'Cierre-ε inicial':`{${step.states.map(id=>`q${id}`).join(', ')||'∅'}}`}</small></span>`;
    card.addEventListener('click',()=>{state.traceStep=i;stopAnimation();refreshTrace();}); steps.appendChild(card);
  });
}
function refreshTrace(){
  const r=state.selectedTrace!=null?state.results[state.selectedTrace]:null;
  fillTraceSelect(); renderTracePanel();
  if(state.model) renderGraph(state.model,state.view,r);
  $('tracePrev').disabled=!r||state.traceStep<=0;
  $('traceNext').disabled=!r||state.traceStep>=r.sim.nfa.steps.length-1;
}
function selectTrace(index){
  stopAnimation(); state.selectedTrace=index===''?null:Number(index); state.traceStep=0; refreshTrace();
}
function stopAnimation(){
  if(state.timer){clearInterval(state.timer);state.timer=null;}
  const b=$('tracePlay'); if(b) b.textContent='▶ Animar recorrido';
}
function stepForward(){
  const r=state.selectedTrace!=null?state.results[state.selectedTrace]:null; if(!r)return false;
  if(state.traceStep>=r.sim.nfa.steps.length-1){stopAnimation();return false;}
  state.traceStep++; refreshTrace(); return true;
}
function stepBackward(){
  const r=state.selectedTrace!=null?state.results[state.selectedTrace]:null; if(!r)return;
  stopAnimation(); if(state.traceStep>0) state.traceStep--; refreshTrace();
}
function toggleAnimation(){
  const r=state.selectedTrace!=null?state.results[state.selectedTrace]:null; if(!r)return;
  if(state.timer){stopAnimation();return;}
  if(state.traceStep>=r.sim.nfa.steps.length-1)state.traceStep=0;
  $('tracePlay').textContent='⏸ Pausar';
  state.timer=setInterval(()=>{if(!stepForward())stopAnimation();},850);
}

/* ------------------------------
   Resultados
   ------------------------------ */
function updateMetrics(){const total=state.results.length,ok=state.results.filter(r=>r.accepted).length; $('totalCount').textContent=total;$('acceptedCount').textContent=ok;$('rejectedCount').textContent=total-ok;$('rateCount').textContent=total?`${Math.round(ok/total*100)}%`:'0%';$('resultState').textContent=total?`Última ejecución · ${new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`:'Esperando simulación';$('exportBtn').disabled=total===0;}
function miniTrace(r){const p=r.sim.path;let h='<div class="result-mini-trace">';for(let i=0;i<p.length;i++){const sid=p[i];const fin=i===p.length-1;h+=`<div class="mini-node ${fin?(r.accepted?'accept':'reject'):''}">${sid==null?'∅':`q${sid}`}</div>`;if(i<r.sim.symbols.length)h+=`<div class="mini-link"><span>${r.sim.symbols[i]===state.model.dfa.sentinel?'OTHER':escapeHTML(symbolLabel(r.sim.symbols[i]))}</span></div>`;}return h+'</div>';}
function renderResults(){const list=$('resultsList'),empty=$('emptyState');const has=state.results.length>0;empty.classList.toggle('hidden',has);list.innerHTML='';state.results.forEach((r,i)=>{const card=document.createElement('article');card.className=`result-card ${r.accepted?'accepted':'rejected'}`;card.style.animationDelay=`${Math.min(i*45,300)}ms`;const reason=r.accepted?'El recorrido termina en una configuración que contiene el estado final del autómata.':'La configuración final no contiene el estado de aceptación del autómata.';card.innerHTML=`<div class="result-head"><div class="result-index">${String(i+1).padStart(2,'0')}</div><div class="result-string"><code>${escapeHTML(r.value||'ε')}</code><small>${[...r.value].length} carácter${[...r.value].length===1?'':'es'} · DFA</small></div><span class="badge ${r.accepted?'accepted':'rejected'}">${r.accepted?'ACEPTADA':'RECHAZADA'}</span></div><div class="result-body"><div class="result-reason">${escapeHTML(reason)} ${r.sim.stopped&&r.sim.symbols.length?`Símbolo problemático: <b>${escapeHTML(r.sim.symbols[r.sim.symbols.length-1]===state.model.dfa.sentinel?'OTHER':symbolLabel(r.sim.symbols[r.sim.symbols.length-1]))}</b>.`:''}</div>${miniTrace(r)}</div>`;card.addEventListener('click',()=>selectTrace(i));list.appendChild(card);});}
function runSimulation(){
  const pattern=getPattern();
  const values=$('stringsInput').value.split(/\r?\n/).map(v=>v.trimEnd());
  const strings=values.filter((v,i)=>v.length>0||i<values.length-1).map(v=>v==='!'?'':v);
  try{
    const ast=new RegexParser(pattern.source,pattern.flags.includes('i')).parse();
    const nfa=buildNFA(ast,pattern.flags.includes('i'));
    const dfa=buildDFA(nfa,strings,ast);
    const results=strings.map(value=>{
      const dfaSim=simulateDFA(dfa,value,pattern.full);
      const nfaSim=simulateNFA(nfa,value);
      // La decisión formal del modo completo proviene del DFA. El NFA se muestra como el recorrido tipo JFLAP.
      const accepted=pattern.full?dfaSim.accepted:nfaSim.accepted;
      return {value,accepted,sim:{...dfaSim,nfa:nfaSim}};
    });
    state.model={ast,nfa,dfa}; state.results=results; state.selectedTrace=results.length?0:null; state.traceStep=0;
    fillTraceSelect(); updatePreview(); updateMetrics(); renderResults(); updateAutomatonMeta(state.model);
    refreshTrace(); $('errorBox').classList.add('hidden');
    state.exportRows=state.results.map((r,i)=>({no:i+1,cadena:r.value,resultado:r.accepted?'ACEPTADA':'RECHAZADA',ruta:r.sim.path.map(x=>x==null?'∅':`q${x}`).join(' → '),simbolos:r.sim.symbols.map(x=>x===dfa.sentinel?'OTHER':symbolLabel(x)).join(' | '),expresion:`/${pattern.source}/${pattern.flags||''}`,modo:pattern.full?'Completa':'Parcial'}));
  } catch(error){
    stopAnimation(); state.model=null;state.results=[];state.exportRows=[];state.selectedTrace=null;state.traceStep=0;updateMetrics();renderResults();fillTraceSelect();renderTracePanel();$('automatonSvg').innerHTML='';$('graphEmpty').classList.remove('hidden');$('errorBox').textContent=`No se pudo construir el autómata: ${error.message}`;$('errorBox').classList.remove('hidden');$('automatonSummary').textContent='Corrige la expresión para generar el NFA y el DFA.';
  }
}
function exportCSV(){if(!state.exportRows.length)return;const headers=['No.','Cadena','Resultado','Ruta DFA','Símbolos','Expresión','Modo'];const rows=state.exportRows.map(r=>[r.no,r.cadena,r.resultado,r.ruta,r.simbolos,r.expresion,r.modo]);const csv=[headers,...rows].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='simulacion-regex-dfa.csv';a.click();URL.revokeObjectURL(url);}
function resetAll(){
  stopAnimation(); $('regexInput').value=defaultCase.regex; $('stringsInput').value=defaultCase.strings;
  $('flagI').checked=false;$('flagM').checked=false;$('flagS').checked=false;$('flagU').checked=true;$('fullMatch').checked=true;
  state.model=null;state.results=[];state.exportRows=[];state.selectedTrace=null;state.traceStep=0; $('errorBox').classList.add('hidden');updatePreview();updateMetrics();runSimulation();
}
function clearStrings(){ stopAnimation(); $('stringsInput').value='';state.model=null;state.results=[];state.exportRows=[];state.selectedTrace=null;state.traceStep=0;$('errorBox').classList.add('hidden');updateMetrics();renderResults();fillTraceSelect();renderTracePanel();$('automatonSvg').innerHTML='';$('graphEmpty').classList.remove('hidden');$('automatonSummary').textContent='Agrega cadenas y ejecuta la simulación para generar el recorrido.';$('automatonMeta').innerHTML='<div><span>Estados NFA</span><strong>—</strong></div><div><span>Estados finales</span><strong>—</strong></div><div><span>Alfabeto</span><strong>—</strong></div><div><span>Construcción</span><strong>Thompson → subconjuntos</strong></div>'; $('stringsInput').focus(); }
function restoreTeacherCase(){ $('regexInput').value=defaultCase.regex;$('stringsInput').value=defaultCase.strings;$('flagI').checked=false;$('flagM').checked=false;$('flagS').checked=false;$('flagU').checked=true;$('fullMatch').checked=true;runSimulation(); }
function generateTeacherStrings(){
  const acceptedTails=['','b','c','bb','bc','cb','cc','bcb','cbc'];
  const accepted=acceptedTails.map(t=>'a'+t);
  const rejected=['','b','c','ba','aa','baa','abcx','a1','ca'];
  $('stringsInput').value=[...accepted,...rejected].join('\n'); runSimulation();
}
let exampleIndex=0;function loadExample(){const e=examples[exampleIndex++%examples.length];$('regexInput').value=e.regex;$('stringsInput').value=e.strings;$('flagI').checked=false;$('flagM').checked=false;$('flagS').checked=false;$('flagU').checked=true;$('fullMatch').checked=true;runSimulation();}

document.addEventListener('click',e=>{
  const tab=e.target.closest('.view-tab'); if(!tab)return;
  document.querySelectorAll('.view-tab').forEach(x=>x.classList.remove('active'));tab.classList.add('active');state.view=tab.dataset.view;
  if(state.model){updateAutomatonMeta(state.model);const r=state.selectedTrace!=null?state.results[state.selectedTrace]:null;renderGraph(state.model,state.view,r);renderTracePanel();}
});
$('runBtn').addEventListener('click',runSimulation);$('clearStrings').addEventListener('click',clearStrings);$('exportBtn').addEventListener('click',exportCSV);$('clearAll').addEventListener('click',resetAll);$('examplesBtn').addEventListener('click',loadExample);$('restoreTeacherBtn').addEventListener('click',restoreTeacherCase);$('generateStringsBtn').addEventListener('click',generateTeacherStrings);$('tracePrev').addEventListener('click',stepBackward);$('traceNext').addEventListener('click',stepForward);$('tracePlay').addEventListener('click',toggleAnimation);$('traceSelect').addEventListener('change',e=>selectTrace(e.target.value));$('regexInput').addEventListener('input',updatePreview);[...document.querySelectorAll('.flag input'),$('fullMatch')].forEach(el=>el.addEventListener('change',updatePreview));$('regexInput').addEventListener('keydown',e=>{if(e.key==='Enter')runSimulation();});

updatePreview();updateMetrics();runSimulation();
