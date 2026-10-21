const base=process.env.VITE_API_URL;
if(!base)throw new Error("VITE_API_URL is required for coordinated publication.");
const url=new URL("health",base.replace(/\/$/,"")+"/");
if(url.protocol!=="https:"&&url.hostname!=="127.0.0.1")throw new Error("Use an HTTPS production API.");
const required=["gamification-v1","reward-redemption-v1","bot-password-v1","bot-automation-runtime-v1","phone-identity-lid-v1","bot-onboarding-password-v2","human-relay-v1","bot-live-progress-v1","queue-pass-v1","independent-queue-access-v1","community-consent-v1","partial-playlist-v1","human-relay-short-code-v1","benefit-gifts-v2","owner-benefits-v1","payment-readiness-v1","playlist-expansion-v1","community-group-only-v1","owner-credential-management-v2","selected-queue-access-v1","watch-presence-v1","human-relay-root-v2","pass-extra-url-v2"];
const seconds=Math.max(0,Math.min(300,Number(process.env.API_RELEASE_WAIT_SECONDS)||0));
const deadline=Date.now()+seconds*1000;
for(;;){
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:"no-store"});
  if(!response.ok)throw new Error("API health returned "+response.status);
  const health=await response.json();
  if(health.ok!==true||!required.every(flag=>health.capabilities?.includes(flag)))throw new Error("API capabilities are not ready.");
  console.info("API capabilities verified; frontend publication can proceed.");break;
 }catch(error){
  if(Date.now()>=deadline)throw new Error("Frontend publication held until its API is ready.",{cause:error});
  console.info("Waiting for the compatible API before exposing the new frontend...");
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
}
