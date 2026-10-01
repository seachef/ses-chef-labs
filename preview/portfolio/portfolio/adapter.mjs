/** No keys, credentials, addresses or private fixtures. Runtime injection stays optional. */
export function createPortfolioAdapter(client=null){
  async function session(){
    if(!client?.auth?.getUser)return {status:'not-configured',user:null};
    const {data,error}=await client.auth.getUser();
    if(error||!data?.user)return {status:'signed-out',user:null};
    return {status:'authenticated',user:data.user};
  }
  async function rows(table,filters,options={}){
    const collected=[],pageSize=500,max=options.limit||10000;
    for(let start=0;start<max;start+=pageSize){
      let query=client.from(table).select('*');for(const [key,value] of Object.entries(filters))query=query.eq(key,value);
      if(options.order)query=query.order(options.order,{ascending:!!options.ascending});
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
      const [wallets,history]=await Promise.all([rows('portfolio_wallets',filter),rows('portfolio_snapshots',filter,{order:'observed_at',limit:730})]);
      const snapshot=history.find(s=>['complete','partial'].includes(s.status))||null;
      let balances=[],stakes=[],rewardEstimates=[];
      if(snapshot){const scoped={...filter,snapshot_id:snapshot.id};[balances,stakes,rewardEstimates]=await Promise.all([rows('portfolio_balance_snapshots',scoped),rows('portfolio_stake_snapshots',scoped),rows('portfolio_reward_estimates',scoped)]);}
      // RLS is authoritative. Recheck session after every read batch; expired reads are never rendered.
      if(!await sameUser(owner_id))return {status:'signed-out',model:null};
      return {status:'ready',model:{account,wallets,snapshot,balances,stakes,rewardEstimates,history}};
    },
    async getSocialLinks(){const auth=await session();if(auth.status!=='authenticated')return {};try{const result=await rows('portfolio_user_settings',{owner_id:auth.user.id},{limit:1});if(!await sameUser(auth.user.id))return {};return result[0]?.social_links||{};}catch{return {};}},
    subscribe(callback){return client?.auth?.onAuthStateChange?.(event=>callback(event))?.data?.subscription||{unsubscribe(){}};},
    async signOut(){if(client?.auth){const {error}=await client.auth.signOut({scope:'local'});if(error)throw Error('Sign-out could not be confirmed');}}
  };
}
