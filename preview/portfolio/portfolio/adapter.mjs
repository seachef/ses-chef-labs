/** No keys, credentials, addresses or private fixtures. Runtime injection stays optional. */
export function createPortfolioAdapter(client=null){
  async function session(){
    if(!client?.auth?.getUser)return {status:'not-configured',user:null};
    const {data,error}=await client.auth.getUser();
    if(error?.name==='AuthRetryableFetchError')return {status:'auth-unavailable',user:null};
    if(error||!data?.user)return {status:'signed-out',user:null};
    return {status:'authenticated',user:data.user};
  }
  async function rows(table,filters,options={}){
    const collected=[],pageSize=500,max=options.limit||10000;
    for(let start=0;start<max;start+=pageSize){
      let query=client.from(table).select('*');for(const [key,value] of Object.entries(filters))query=query.eq(key,value);
      for(const column of options.order?(Array.isArray(options.order)?options.order:[options.order]):[])query=query.order(column,{ascending:!!options.ascending,nullsFirst:false});
      const count=Math.min(pageSize,max-start);query=query.range(start,start+count-1);
      const {data,error}=await query;if(error){const failure=Error('Private snapshot unavailable');failure.code=error.code;throw failure;}
      const page=data||[];collected.push(...page);if(page.length<count)return collected;
      if(options.limit&&collected.length>=options.limit)return collected;
    }
    // Failing closed is safer than presenting a silently truncated private portfolio.
    throw Error('Snapshot is too large for a complete browser read');
  }
  async function sameUser(ownerId){const auth=await session();return auth.status==='authenticated'&&auth.user.id===ownerId;}
  return {
    session,
    async readPortfolio(){
      const auth=await session();if(auth.status!=='authenticated')return {status:auth.status,model:null};
      const owner_id=auth.user.id;
      let accounts;try{accounts=await rows('portfolio_accounts',{owner_id,kind:'smsf'},{limit:2});}catch(error){if(['PGRST205','42P01'].includes(error.code))return {status:'setup-pending',model:null};throw error;}
      if(!accounts.length)return {status:'no-account',model:null};
      if(accounts.length>1)throw Error('Choose a private account before loading balances');
      const account=accounts[0],filter={owner_id,account_id:account.id};
      const [wallets,history]=await Promise.all([rows('portfolio_wallets',filter),rows('portfolio_snapshots',filter,{order:['observed_at','completed_at','id'],limit:730})]);
      const snapshot=history.find(s=>['complete','partial'].includes(s.status))||null;
      let balances=[],stakes=[],rewardEstimates=[];
      if(snapshot){const scoped={...filter,snapshot_id:snapshot.id};[balances,stakes,rewardEstimates]=await Promise.all([rows('portfolio_balance_snapshots',scoped),rows('portfolio_stake_snapshots',scoped),rows('portfolio_reward_estimates',scoped)]);}
      // RLS is authoritative. Recheck session after every read batch; expired reads are never rendered.
      const after=await session();if(after.status==='auth-unavailable')return {status:'auth-unavailable',model:null};
      if(after.status!=='authenticated'||after.user.id!==owner_id)return {status:'signed-out',model:null};
      return {status:'ready',model:{account,wallets,snapshot,balances,stakes,rewardEstimates,history}};
    },
    async collectSnapshot(){
      const auth=await session();if(auth.status!=='authenticated')return {status:auth.status};
      if(!client.functions?.invoke)return {status:'unavailable',code:'REFRESH_NOT_CONFIGURED'};
      let response;
      try{response=await client.functions.invoke('portfolio-refresh',{body:{},timeout:100000});}
      catch{response={error:{name:'FunctionsFetchError'}};}
      const {data,error}=response||{},status=error?.context?.status;
      if(status===401)return {status:'signed-out'};
      if(status===403)return {status:'forbidden'};
      // A changed/expired identity must never retain another owner's display.
      const after=await session();if(after.status==='auth-unavailable')return {status:'unavailable',code:'AUTH_UNAVAILABLE'};
      if(after.status!=='authenticated'||after.user.id!==auth.user.id)return {status:'signed-out'};
      if(!error&&data?.status==='saved'&&typeof data.snapshot_id==='string'&&Number.isFinite(Date.parse(data.observed_at)))return {status:'saved',snapshotId:data.snapshot_id,observedAt:data.observed_at};
      let body=null;
      try{if(error?.context?.json)body=await error.context.json();}catch{/* Never display raw upstream errors. */}
      if(status===429&&body?.error==='REFRESH_THROTTLED')return {status:'throttled',retryAfterSeconds:Math.max(1,Math.min(3600,Math.ceil(Number(body.retry_after_seconds)||300)))};
      const allowed=['ALCHEMY_KEY_NOT_CONFIGURED','BACKEND_NOT_CONFIGURED','ALCHEMY_AUTH_OR_ACCESS_FAILED','ALCHEMY_CAPACITY_EXHAUSTED','ALCHEMY_RATE_LIMITED'];
      return {status:'unavailable',code:allowed.includes(body?.error)?body.error:status===503?'COLLECTION_FAILED':'REFRESH_UNCONFIRMED'};
    },
    async getSocialLinks(){const auth=await session();if(auth.status!=='authenticated')return {};try{const result=await rows('portfolio_user_settings',{owner_id:auth.user.id},{limit:1});if(!await sameUser(auth.user.id))return {};return result[0]?.social_links||{};}catch{return {};}},
    subscribe(callback){return client?.auth?.onAuthStateChange?.((event,authSession)=>callback(event,authSession?.user?.id||null))?.data?.subscription||{unsubscribe(){}};},
    async signOut(){if(client?.auth){const {error}=await client.auth.signOut({scope:'local'});if(error)throw Error('Sign-out could not be confirmed');}}
  };
}
