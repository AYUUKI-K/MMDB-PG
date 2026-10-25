import {normalizeAccountEmail} from '../shared/account-email.js';

// Read only the native account control, never emails in prompts or replies.
export function readGoogleAccountEmail(documentNode=document) {
  // The native navigation drawer can be collapsed, especially on phones.
  const buttons=Array.from(documentNode.querySelectorAll('ms-account-switcher button.account-switcher-button'));
  if(buttons.length!==1)return null;
  const button=buttons[0],label=button.getAttribute('aria-label')??'';
  const fromLabel=normalizeAccountEmail(label.match(/\(([^()]+)\)\s*$/)?.[1]);
  const fromText=normalizeAccountEmail(button.querySelector('.account-switcher-text')?.textContent);
  if(fromLabel&&fromText&&fromLabel!==fromText)return null;
  return fromLabel??fromText;
}

export function watchGoogleAccountEmail(changed,{documentNode=document,page=window}={}) {
  let previous;
  const check=()=>{const email=readGoogleAccountEmail(documentNode);if(email!==previous){previous=email;changed(email);}};
  const timer=setInterval(check,1000);
  page.addEventListener('focus',check);documentNode.addEventListener('visibilitychange',check);check();
  return ()=>{clearInterval(timer);page.removeEventListener('focus',check);documentNode.removeEventListener('visibilitychange',check);};
}
