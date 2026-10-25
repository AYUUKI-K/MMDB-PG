import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readGoogleAccountEmail} from '../src/browser/page-account.js';

const button=(label,text,visible=true)=>({getAttribute:()=>label,querySelector:()=>({textContent:text}),getClientRects:()=>visible?[{}]:[]});
const documentWith=(...buttons)=>({querySelectorAll:selector=>{assert.equal(selector,'ms-account-switcher button.account-switcher-button');return buttons;}});

test('reads the native account button email and normalizes casing',()=>{
  assert.equal(readGoogleAccountEmail(documentWith(button('Google Account: Name (Primary@Example.com)',' primary@example.com '))),'primary@example.com');
  assert.equal(readGoogleAccountEmail(documentWith(button('Google 帐号：名称 (primary@example.com)',''))),'primary@example.com');
  assert.equal(readGoogleAccountEmail(documentWith(button('Google Account: Name (primary@example.com)','primary@example.com',false))),'primary@example.com');
});
test('ambiguous, conflicting and malformed account controls cannot supply an identity',()=>{
  for(const doc of [documentWith(),documentWith(button('User (a@example.com)','b@example.com')),documentWith(button('User (a@example.com)',''),button('User (b@example.com)','')),documentWith(button('User (bad@local)','not an email'))])assert.equal(readGoogleAccountEmail(doc),null);
});
