import { z } from "zod";
import type { AppDatabase } from "./db.js";
export function ensurePlaylistSelections(db:AppDatabase){
 db.exec(`CREATE TABLE IF NOT EXISTS playlist_selections(
 round_id TEXT NOT NULL REFERENCES rounds(id),user_id TEXT NOT NULL REFERENCES users(id),
 videos_json TEXT NOT NULL,video_count INTEGER NOT NULL CHECK(video_count BETWEEN 1 AND 10),
 reward_eligible INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(round_id,user_id));`);
}
export function playlistSelection(db:AppDatabase,userId:string,roundId:string){
 const row=db.prepare("SELECT videos_json AS videos,video_count AS count,reward_eligible AS rewardEligible FROM playlist_selections WHERE round_id=? AND user_id=?").get(roundId,userId) as {videos:string;count:number;rewardEligible:number}|undefined;
 return row?{videos:JSON.parse(row.videos) as string[],count:row.count,rewardEligible:Boolean(row.rewardEligible)}:undefined;
}
/** Snapshot before OAuth/export: later contributions cannot change a personal selection. */
export function preparePlaylistSelection(db:AppDatabase,userId:string,roundId:string,acceptPartial:boolean){
 z.string().uuid().parse(roundId);
 return db.transaction(()=>{
  const eligible=db.prepare("SELECT 1 FROM rounds r JOIN round_participants rp ON rp.round_id=r.id LEFT JOIN playlist_watch_progress p ON p.round_id=r.id AND p.user_id=rp.user_id WHERE r.id=? AND rp.user_id=? AND rp.left_at IS NULL AND r.closed_at IS NULL AND p.finalized_at IS NULL AND EXISTS(SELECT 1 FROM submissions s WHERE s.round_id=r.id AND s.user_id=rp.user_id)").get(roundId,userId);
  if(!eligible)throw Object.assign(new Error("Entre e contribua nesta fila antes de iniciar a playlist."),{statusCode:409,code:"ROUND_ACCESS_ENDED"});
  const previous=playlistSelection(db,userId,roundId);if(previous)return previous;
  const videos=(db.prepare("SELECT video_id AS id FROM submissions WHERE round_id=? ORDER BY slot").all(roundId) as {id:string}[]).map(v=>v.id);
  if(!videos.length)throw Object.assign(new Error("Esta fila ainda não tem vídeos."),{statusCode:409});
  if(videos.length<10&&!acceptPartial)throw Object.assign(new Error("Confirme a playlist parcial: você mantém XP proporcional aos vídeos observados, mas não recebe moedas por este acompanhamento. Uma playlist completa permite ganhar mais XP e moedas."),{statusCode:409,code:"PARTIAL_CONFIRMATION_REQUIRED"});
  db.prepare("INSERT INTO playlist_selections(round_id,user_id,videos_json,video_count,reward_eligible,created_at) VALUES(?,?,?,?,?,?)").run(roundId,userId,JSON.stringify(videos),videos.length,videos.length===10?1:0,new Date().toISOString());
  return {videos,count:videos.length,rewardEligible:videos.length===10};
 })();
}
