const fs = require('node:fs');
const ts = require('/home/andrea/management/deepseek-harness/node_modules/typescript');
const root = '/home/andrea/management/deepseek-plugins/';
const stub = "class WebError extends Error { constructor(message, code) { super(message); this.code=code; } }\n";
async function main() {
 const source=fs.readFileSync(root+'dsh-plugin-tavily/src/provider.ts','utf8');
 let js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 js=js.replace(/import \{ WebError \} from '@deepseek-ai\/dsh-web';/,stub);
 const mod=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const sentinel='FAKE_AUDIT_CREDENTIAL_NOT_A_REAL_KEY';
 const file='/tmp/dsh-plugin-audit/fake-cache.json';
 fs.rmSync(file,{force:true});
 const originalFetch=global.fetch;
 global.fetch=async()=>Response.json({results:[{url:'https://example.com',title:'Example',content:'Test'}]});
 const provider=new mod.TavilySearchProvider(()=>({apiKey:sentinel,baseURL:'https://api.tavily.com',searchDepth:'basic',topic:'general',includeAnswer:false,includeRawContent:false,timeout:1000,cacheTtlMs:60000,cacheFile:file}));
 await provider.search({query:'synthetic audit',maxResults:1});
 await new Promise(r=>setTimeout(r,1700));
 console.log(JSON.stringify({probe:'tavily-persisted-cache',credentialPresentInCache:fs.readFileSync(file,'utf8').includes(sentinel)}));
 try {const noKey=new mod.TavilySearchProvider(()=>({baseURL:'https://api.tavily.com',searchDepth:'basic',topic:'general',includeAnswer:false,includeRawContent:false,timeout:1000}));await noKey.search({query:'test'});}catch(e){console.log(JSON.stringify({probe:'tavily-no-key',errorCode:e.code}));}
 global.fetch=originalFetch;
 const browser=fs.readFileSync(root+'dsh-web-fetch-playwright/src/provider.ts','utf8');
 const start=browser.indexOf('class Semaphore {');const end=browser.indexOf('\n}',start)+2;
 const semJs=ts.transpileModule(stub+browser.slice(start,end)+'\nexport { Semaphore };',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const {Semaphore}=await import('data:text/javascript;base64,'+Buffer.from(semJs).toString('base64'));
 const s=new Semaphore(1),signal=new AbortController().signal;
 await s.acquire(signal,50); const second=s.acquire(signal,50);s.release();await second;s.release();
 try {await s.acquire(signal,50);console.log(JSON.stringify({probe:'playwright-semaphore',thirdAcquire:'passed'}));s.release();}catch(e){console.log(JSON.stringify({probe:'playwright-semaphore',thirdAcquire:'failed-after-all-work-released',errorCode:e.code}));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
