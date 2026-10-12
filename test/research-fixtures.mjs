// FABRICATED OFFLINE TEST DATA. Never included in the public build or feed.
import { researchDigest } from '../reviewed-research.mjs';
export const AT = Date.UTC(2026,9,12,13);
export function syntheticSetup() { return { id:'fabricated-test-only',venue:'coinspot',pair:'BTC-AUD',quoteCurrency:'AUD',entry:100,stop:95,targets:[110,120],expiresAt:AT+120000,
 market:{venue:'coinspot',pair:'BTC-AUD',quoteCurrency:'AUD',product:'spot',sourceUrl:'https://www.coinspot.com.au/trade/BTC',sourceAt:AT-1000,receivedAt:AT-500,bid:99.9,ask:100,askDepthQuantity:2,captureSha256:'a'.repeat(64)},
 fees:{venue:'coinspot',pair:'BTC-AUD',quoteCurrency:'AUD',product:'spot',sourceUrl:'https://www.coinspot.com.au/markets',checkedAt:AT-10000,expiresAt:AT+600000,basis:'coinspot-markets',orderType:'market',buyBps:10,sellBps:10,captureSha256:'b'.repeat(64)},
 costs:{model:'market-both-sides-adverse-v1',quantity:1,slippageBps:5}}; }
export async function packet(s=syntheticSetup()) { return { feed:{schemaVersion:1,contract:'public-spot-research-v1',revision:'fabricated-test-only',setups:[s]}, manifest:{schemaVersion:1,contract:'exact-research-review-v1',revision:'fabricated-test-only',approvals:[{setupId:s.id,setupDigest:await researchDigest(s),marketDigest:await researchDigest(s.market),feeDigest:await researchDigest(s.fees),reviewerId:'synthetic-test-only',decision:'approved',reviewedAt:AT,expiresAt:s.expiresAt}]}}; }
export class Element {
 constructor(){this.children=[];this.attributes=new Map();this.listeners=new Map();this.value='';this.checked=false;this.disabled=false;this._text='';this.textWrites=0;}
 set textContent(v){this._text=String(v);this.textWrites++;this.children=[];} get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ');}
 append(...c){this.children.push(...c);} replaceChildren(...c){this._text='';this.children=c;}
 setAttribute(k,v){this.attributes.set(k,String(v));} getAttribute(k){return this.attributes.get(k)??null;} removeAttribute(k){this.attributes.delete(k);}
 addEventListener(k,f){this.listeners.set(k,f);} removeEventListener(k){this.listeners.delete(k);}
 dispatch(k){const e={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};this.listeners.get(k)?.(e);return e;}
}
export function documentStub(){const nodes=new Map();return {getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},addEventListener(){},removeEventListener(){}};}
