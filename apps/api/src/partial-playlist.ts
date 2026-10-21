import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./db.js";
export function ensurePlaylistSelections(db:AppDatabase){
 db.exec(`CREATE TABLE IF NOT EXISTS playlist_selections(
 round_id TEXT NOT NULL REFERENCES rounds(id),user_id TEXT NOT NULL REFERENCES users(id),
 videos_json TEXT NOT NULL,video_count INTEGER NOT NULL CHECK(video_count BETWEEN 1 AND 10),
 reward_eligible INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(round_id,user_id));
 CREATE TABLE IF NOT EXISTS playlist_selection_history(
 id TEXT PRIMARY KEY,round_id TEXT NOT NULL,user_id TEXT NOT NULL,selection_json TEXT NOT NULL,
 export_json TEXT,progress_json TEXT,archived_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS playlist_history_no_update BEFORE UPDATE ON playlist_selection_history BEGIN SELECT RAISE(ABORT,'Immutable playlist history'); END;
 CREATE TRIGGER IF NOT EXISTS playlist_history_no_delete BEFORE DELETE ON playlist_selection_history BEGIN SELECT RAISE(ABORT,'Immutable playlist history'); END;`);
}
export function playlistSelection(db:AppDatabase,userId:string,roundId:string){
 const row=db.prepare("SELECT videos_json AS videos,video_count AS count,reward_eligible AS rewardEligible FROM playlist_selections WHERE round_id=? AND user_id=?").get(roundId,userId) as {videos:string;count:number;rewardEligible:number}|undefined;
 return row?{videos:JSON.parse(row.videos) as string[],count:row.count,rewardEligible:Boolean(row.rewardEligible)}:undefined;
}
/** A selection is fixed until the participant explicitly requests a larger version. */
export function preparePlaylistSelection(db:AppDatabase,userId:string,roundId:string,acceptPartial:boolean,videoCount?:number){
 z.string().uuid().parse(roundId);
 return db.transaction(()=>{
  const eligible=db.prepare("SELECT 1 FROM rounds r JOIN round_participants rp ON rp.round_id=r.id LEFT JOIN playlist_watch_progress p ON p.round_id=r.id AND p.user_id=rp.user_id WHERE r.id=? AND rp.user_id=? AND rp.left_at IS NULL AND r.closed_at IS NULL AND (p.finalized_at IS NULL OR (p.finalize_reason IN ('COMPLETE','MANUAL') AND EXISTS(SELECT 1 FROM playlist_selections ps WHERE ps.round_id=r.id AND ps.user_id=rp.user_id AND ps.reward_eligible=0))) AND (rp.source='SKIP' OR EXISTS(SELECT 1 FROM submissions s WHERE s.round_id=r.id AND s.user_id=rp.user_id))").get(roundId,userId);
  if(!eligible)throw Object.assign(new Error("Contribua nesta fila ou use um Pular para liberar o acompanhamento."),{statusCode:409,code:"ROUND_ACCESS_ENDED"});
  const previous=playlistSelection(db,userId,roundId);
  const videos=(db.prepare("SELECT video_id AS id FROM submissions WHERE round_id=? ORDER BY slot").all(roundId) as {id:string}[]).map(v=>v.id);
  if(!videos.length)throw Object.assign(new Error("Esta fila ainda não tem vídeos."),{statusCode:409});
  const count=videoCount===undefined?videos.length:z.number().int().min(1).max(10).parse(videoCount);
  if(count>videos.length)throw Object.assign(new Error("Aguarde os vídeos chegarem a estas posições."),{statusCode:409});
  if(previous&&count===previous.count)return previous;
  if(previous&&count<previous.count)throw Object.assign(new Error("Sua seleção salva não pode diminuir. Você pode criar uma versão maior quando chegarem novos vídeos."),{statusCode:409});
  if(count<10&&!acceptPartial)throw Object.assign(new Error("Confirme a playlist parcial: você mantém XP proporcional aos vídeos observados, mas não recebe moedas por este acompanhamento. Uma playlist completa permite ganhar mais XP e moedas."),{statusCode:409,code:"PARTIAL_CONFIRMATION_REQUIRED"});
  const selected=videos.slice(0,count),now=new Date().toISOString();
  if(previous){
   const lock=db.prepare("SELECT 1 FROM export_locks WHERE round_id=? AND user_id=? AND expires_at>?").get(roundId,userId,now);
   if(lock)throw Object.assign(new Error("Aguarde a criação em andamento antes de ampliar a seleção."),{statusCode:409});
   const exported=db.prepare("SELECT * FROM playlist_exports WHERE round_id=? AND user_id=?").get(roundId,userId);
   const progress=db.prepare("SELECT * FROM playlist_watch_progress WHERE round_id=? AND user_id=?").get(roundId,userId);
   db.prepare("INSERT INTO playlist_selection_history VALUES(?,?,?,?,?,?,?)").run(randomUUID(),roundId,userId,JSON.stringify(previous),exported?JSON.stringify(exported):null,progress?JSON.stringify(progress):null,now);
   // A new YouTube playlist never appends into or mutates the old one. Keep unique intervals and XP sources.
   db.prepare("UPDATE playlist_exports SET id=?,youtube_playlist_id=NULL,status='PENDING',added_count=0,error=NULL,created_at=?,updated_at=? WHERE round_id=? AND user_id=?").run(randomUUID(),now,now,roundId,userId);
   db.prepare("UPDATE playlist_watch_progress SET percent=percent*?/?,finalized_at=NULL,finalize_reason=NULL,updated_at=? WHERE round_id=? AND user_id=?").run(previous.count,count,now,roundId,userId);
   db.prepare("UPDATE watch_observation_state SET active=0 WHERE user_id=? AND round_id=?").run(userId,roundId);
  }
  db.prepare("INSERT INTO playlist_selections(round_id,user_id,videos_json,video_count,reward_eligible,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(round_id,user_id) DO UPDATE SET videos_json=excluded.videos_json,video_count=excluded.video_count,reward_eligible=excluded.reward_eligible,created_at=excluded.created_at").run(roundId,userId,JSON.stringify(selected),count,count===10?1:0,now);
  return {videos:selected,count,rewardEligible:count===10};
 })();
}
