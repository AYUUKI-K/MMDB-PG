import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTavernTheme,readTavernTheme,startTavernThemeSync} from '../src/browser/tavern-theme.js';

const valid={version:1,scheme:'dark',values:{'--panel':'rgb(41, 46, 50)','--ink':'rgb(226, 231, 233)','--accent':'rgb(237, 183, 130)'}};
test('theme snapshot accepts only known appearance properties and never URLs or whole CSS',()=>{
  const theme=normalizeTavernTheme({...valid,values:{...valid.values,'--panel-font':'url(https://invalid.example/font)','--arbitrary':'red','--panel-radius':'12px;display:none','--panel-shadow':'0 1px 3px black'}},()=>true);
  assert.deepEqual(theme.values,{...valid.values,'--panel-shadow':'0 1px 3px black'});
  assert.equal(normalizeTavernTheme({...valid,values:{...valid.values,'--panel':'var(--unknown)'}},()=>true),null);
  assert.equal(normalizeTavernTheme(valid,()=>false),null);
});
function fixture(){
  let shade='rgb(41, 46, 50)',scheduled,cleared=false;
  const style={getPropertyValue:key=>({'--SmartThemeBodyColor':'#e2e7e9','--SmartThemeEmColor':'rgb(162, 175, 184)','--SmartThemeQuoteColor':'rgb(237, 183, 130)'}[key]??''),color:'rgb(226, 231, 233)',get backgroundColor(){return shade;},borderTopColor:'rgb(72, 81, 89)',fontFamily:'"Segoe UI",sans-serif',borderTopLeftRadius:'18px',boxShadow:'none'};
  const doc=Object.assign(new EventTarget(),{visibilityState:'visible',body:{append(){}},getElementById:()=>({}),createElement:()=>({style:{color:''},remove(){}})});
  const screen=Object.assign(new EventTarget(),{CSS:{supports:()=>true},getComputedStyle:el=>el.style?.color?{color:el.style.color}:style,setInterval:fn=>{scheduled=fn;return 1;},clearInterval:()=>{cleared=true;}});
  return {doc,screen,sample:()=>scheduled(),change:()=>shade='rgb(240, 240, 240)',cleared:()=>cleared};
}
test('sampling follows computed theme changes, skips non-Tavern pages and avoids duplicate writes',()=>{
  const f=fixture(),saved=[];
  const stop=startTavernThemeSync({...f,save:value=>saved.push(value)});
  assert.equal(saved.length,1);assert.equal(saved[0].values['--panel'],valid.values['--panel']);
  f.sample();assert.equal(saved.length,1);f.change();f.sample();assert.equal(saved.length,2);
  f.doc.visibilityState='hidden';f.change();f.sample();assert.equal(saved.length,2);
  stop();assert.ok(f.cleared());
  assert.equal(readTavernTheme({...f.doc,getElementById:()=>null},f.screen),null);
});
