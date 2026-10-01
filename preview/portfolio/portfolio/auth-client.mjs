import { AUTH_CONFIG } from './auth-config.mjs?v=20261001.data2';
let clientPromise=null;
export function hasAuthCallback(location=globalThis.location){const query=new URLSearchParams(location?.search||''),hash=new URLSearchParams((location?.hash||'').slice(1));return query.has('code')||query.has('error')||hash.has('error')||hash.has('access_token');}
export function shouldResumeAuth(storage=globalThis.sessionStorage,location=globalThis.location){if(hasAuthCallback(location))return true;try{return !!storage?.getItem(AUTH_CONFIG.storageKey);}catch{return false;}}
export function cleanAuthUrl(){const url=new URL(location.href);for(const key of ['code','error','error_code','error_description','state'])url.searchParams.delete(key);if(new URLSearchParams(url.hash.slice(1)).has('error')||new URLSearchParams(url.hash.slice(1)).has('access_token'))url.hash='portfolio';history.replaceState(null,'',url.pathname+url.search+url.hash);}
function tabStorage(){try{const storage=globalThis.sessionStorage;const test=AUTH_CONFIG.storageKey+'.test';storage.setItem(test,'1');storage.removeItem(test);return storage;}catch{throw Error('This tab cannot keep a secure sign-in session. Allow session storage and try again.');}}
export async function getAuthClient(){
  if(!AUTH_CONFIG.enabled)return null;
  if(!clientPromise){clientPromise=(async()=>{const storage=tabStorage();const {createClient}=await import('../vendor/supabase-2.117.2.mjs');return createClient(AUTH_CONFIG.url,AUTH_CONFIG.publishableKey,{auth:{storage,storageKey:AUTH_CONFIG.storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'}});})().catch(error=>{clientPromise=null;throw error;});}
  return clientPromise;
}
export async function resumeAuthentication(){
  if(!AUTH_CONFIG.enabled||!shouldResumeAuth())return {client:null,error:null};
  const query=new URLSearchParams(location.search),hash=new URLSearchParams(location.hash.slice(1));
  if(query.has('error')||hash.has('error')||hash.has('access_token')){cleanAuthUrl();return {client:null,error:'Sign-in was not completed. Please try again.'};}
  const client=await getAuthClient();
  if(query.has('code')){const code=query.get('code');cleanAuthUrl();const {error}=await client.auth.exchangeCodeForSession(code);if(error)return {client,error:'Sign-in could not be completed in this tab. Start again from this page.'};}
  return {client,error:null};
}
export async function beginGitHubSignIn(){
  if(!AUTH_CONFIG.enabled)throw Error('Private sign-in is not enabled yet.');
  if(location.origin!==new URL(AUTH_CONFIG.redirectUrl).origin)throw Error('Open the published Sea Chef Labs preview to sign in.');
  const client=await getAuthClient();const {error}=await client.auth.signInWithOAuth({provider:'github',options:{redirectTo:AUTH_CONFIG.redirectUrl}});if(error)throw Error('GitHub sign-in could not start. Please try again.');
}
