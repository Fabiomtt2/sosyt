const base=process.env.VITE_API_URL;
if(!base)throw new Error("VITE_API_URL is required for coordinated publication.");
const url=new URL("health",base.replace(/\/$/,"")+"/");
if(url.protocol!=="https:"&&url.hostname!=="127.0.0.1")throw new Error("Use an HTTPS production API.");
const required=["gamification-v1","reward-redemption-v1","bot-password-v1"];
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
