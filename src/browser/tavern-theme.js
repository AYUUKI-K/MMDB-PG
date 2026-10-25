// Share a small appearance snapshot through this userscript's own storage.
// Never copy full stylesheets, URLs, chat text, credentials or page settings.
export const TAVERN_THEME_PROPERTIES=Object.freeze({
  '--panel':'color','--ink':'color','--secondary':'color','--muted':'color',
  '--line':'color','--inset':'color','--accent':'color','--on-accent':'color',
  '--panel-font':'font-family','--panel-radius':'border-radius',
  '--control-radius':'border-radius','--panel-shadow':'box-shadow'
});

export function normalizeTavernTheme(value, supports=(property,text)=>CSS.supports(property,text)) {
  if(value?.version!==1||!['light','dark'].includes(value.scheme)||!value.values||typeof value.values!=='object')return null;
  const values={};
  for(const [name,property] of Object.entries(TAVERN_THEME_PROPERTIES)){
    const text=value.values[name];
    if(typeof text!=='string'||text.length>512||/[;{}<>@]|url\s*\(|var\s*\(|[\u0000-\u001f]/i.test(text)||!supports(property,text))continue;
    values[name]=text;
  }
  if(!values['--panel']||!values['--ink']||!values['--accent'])return null;
  return {version:1,scheme:value.scheme,values};
}

export function readTavernTheme(doc=document, screen=window) {
  const form=doc.getElementById('send_form'),input=doc.getElementById('send_textarea');
  if(!doc.body||!form||!input||!doc.getElementById('sheld')||!doc.getElementById('top-settings-holder'))return null;
  const body=screen.getComputedStyle(doc.body),surface=screen.getComputedStyle(form),field=screen.getComputedStyle(input);
  if(!body.getPropertyValue('--SmartThemeBodyColor').trim())return null;
  const button=doc.getElementById('send_but'),control=button?screen.getComputedStyle(button):field;
  const variable=(key,fallback)=>body.getPropertyValue(key).trim()||fallback;
  const opaque=color=>color&&color!=='transparent'&&!/^rgba\([^)]*,\s*0\s*\)$/.test(color);
  const background=opaque(surface.backgroundColor)?surface.backgroundColor:opaque(body.backgroundColor)?body.backgroundColor:variable('--SmartThemeBlurTintColor','#292e32');
  const secondary=variable('--SmartThemeEmColor',body.color),accent=variable('--SmartThemeQuoteColor',body.color);
  // Resolve color-mix(), named colors and variables in the source document.
  const probe=doc.createElement('span');probe.style.cssText='position:fixed;visibility:hidden;pointer-events:none;';doc.body.append(probe);
  const resolve=value=>{probe.style.color=value;return screen.getComputedStyle(probe).color;};
  const light=value=>{
    const resolved=resolve(value),rgb=resolved.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/);
    const srgb=resolved.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    const channels=rgb?rgb.slice(1).map(Number):srgb?srgb.slice(1).map(n=>Number(n)*255):[128,128,128];
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722>150;
  };
  try {
    const scheme=light(body.color)?'dark':'light';
    return normalizeTavernTheme({version:1,scheme,values:{
      '--panel':resolve(background),'--ink':body.color,'--secondary':resolve(secondary),'--muted':resolve(secondary),
      '--line':opaque(surface.borderTopColor)?surface.borderTopColor:resolve(variable('--SmartThemeBorderColor',secondary)),
      '--inset':opaque(field.backgroundColor)?field.backgroundColor:resolve(background),
      '--accent':resolve(accent),'--on-accent':light(accent)?'#202428':'#ffffff',
      '--panel-font':body.fontFamily,'--panel-radius':surface.borderTopLeftRadius,
      '--control-radius':control.borderTopLeftRadius,'--panel-shadow':surface.boxShadow
    }},(property,text)=>screen.CSS.supports(property,text));
  } finally {probe.remove();}
}

export function startTavernThemeSync({doc=document,screen=window,save=value=>GM_setValue('mmdb.tavernTheme',value)}={}) {
  let last='',stopped=false;
  const publish=()=>{
    if(stopped||doc.visibilityState==='hidden')return;
    const theme=readTavernTheme(doc,screen);
    if(!theme)return;
    const encoded=JSON.stringify(theme);
    if(encoded===last)return;
    try{save(theme);last=encoded;}catch{}
  };
  // Sampling computed styles also catches themes built from media queries,
  // dynamically loaded fonts and stylesheet replacements, without observing chat.
  const timer=screen.setInterval(publish,1500);
  screen.addEventListener('focus',publish);doc.addEventListener('visibilitychange',publish);
  const stop=()=>{stopped=true;screen.clearInterval(timer);screen.removeEventListener('focus',publish);doc.removeEventListener('visibilitychange',publish);screen.removeEventListener('pagehide',stop);};
  screen.addEventListener('pagehide',stop,{once:true});publish();
  return stop;
}

export function watchTavernTheme(changed) {
  const key='mmdb.tavernTheme';
  if(typeof GM_addValueChangeListener==='function'){
    const id=GM_addValueChangeListener(key,(_key,_previous,value)=>changed(value));
    return ()=>{if(typeof GM_removeValueChangeListener==='function')GM_removeValueChangeListener(id);};
  }
  let last='';
  const timer=setInterval(()=>{if(typeof GM_getValue!=='function')return;const value=GM_getValue(key,null),encoded=JSON.stringify(value);if(encoded!==last){last=encoded;changed(value);}},2000);
  return ()=>clearInterval(timer);
}
