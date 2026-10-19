import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { createPrivatePlaylist } from "./youtube.js";

const config = () => loadConfig({ NODE_ENV:"test", DATABASE_PATH:":memory:",
  JWT_SECRET:"youtube-entitlement-jwt-secret-32", AUTH_CODE_PEPPER:"youtube-entitlement-pepper-secret-32",
  GOOGLE_CLIENT_ID:"synthetic-client", GOOGLE_CLIENT_SECRET:"synthetic-secret" });
const json = (value:unknown) => new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});

describe("YouTube export rechecks entitlement before remote requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("revocation while token refresh is awaiting prevents every playlist API request", async () => {
    let active = true;
    const requests:string[]=[];
    let finishRefresh!:(response:Response)=>void;
    const refresh = new Promise<Response>(resolve => { finishRefresh=resolve; });
    vi.stubGlobal("fetch",vi.fn((input:string|URL|Request) => {
      const url=String(input); requests.push(url);
      if(url==="https://oauth2.googleapis.com/token") return refresh;
      throw new Error("A playlist request must not happen after revocation");
    }));
    const check=()=>{if(!active)throw new Error("ROUND_ACCESS_INACTIVE");};
    const exporting=createPrivatePlaylist(config(),"synthetic-refresh","Synthetic export",["abcdefghijk"],undefined,undefined,check);
    expect(requests).toEqual(["https://oauth2.googleapis.com/token"]);
    active=false;
    finishRefresh(json({access_token:"synthetic-access"}));
    await expect(exporting).rejects.toThrow("ROUND_ACCESS_INACTIVE");
    expect(requests).toEqual(["https://oauth2.googleapis.com/token"]);
  });

  it("stops before the next insertion after revocation and retains the completed checkpoint", async () => {
    let active=true;
    const inserts:string[]=[];
    const checkpoints:Array<{id:string;count:number}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
      const url=String(input);
      if(url==="https://oauth2.googleapis.com/token")return json({access_token:"synthetic-access"});
      if(url.includes("/playlists?"))return json({id:"synthetic-playlist"});
      if(url.includes("/playlistItems?")){
        const body=JSON.parse(String(init?.body)) as {snippet:{resourceId:{videoId:string}}};
        inserts.push(body.snippet.resourceId.videoId);
        return json({id:"synthetic-item"});
      }
      throw new Error("Unexpected URL");
    }));
    const check=()=>{if(!active)throw new Error("ROUND_ACCESS_INACTIVE");};
    await expect(createPrivatePlaylist(config(),"synthetic-refresh","Synthetic export",["abcdefghijk","lmnopqrstuv"],undefined,
      (id,count)=>{check();checkpoints.push({id,count});if(count===1)active=false;},check)).rejects.toThrow("ROUND_ACCESS_INACTIVE");
    expect(inserts).toEqual(["abcdefghijk"]);
    expect(checkpoints).toEqual([{id:"synthetic-playlist",count:0},{id:"synthetic-playlist",count:1}]);
  });

  it("does not even refresh a token when entitlement is already revoked", async () => {
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    await expect(createPrivatePlaylist(config(),"synthetic-refresh","Synthetic export",["abcdefghijk"],undefined,undefined,
      ()=>{throw new Error("ROUND_ACCESS_INACTIVE");})).rejects.toThrow("ROUND_ACCESS_INACTIVE");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
