import type {AppDatabase} from "./db.js";
export type QueueEventSnapshot={event:string;roundId:string;occurredAt:string;vars:Record<string,string|number>};
/** Resolve an immutable fact ID; display numbers may be reassigned after closure. */
export function captureQueueEvent(db:AppDatabase,event:string,sourceId:string,vars:Record<string,string|number>,occurredAt:string):QueueEventSnapshot|undefined{
 if(!['QUEUE_OPEN','QUEUE_FILLING','QUEUE_COMPLETE','UPLOAD_NOTICE'].includes(event))return undefined;
 const round=event==='UPLOAD_NOTICE'
  ?db.prepare('SELECT round_id AS id FROM submissions WHERE id=?').get(sourceId) as {id:string}|undefined
  :db.prepare('SELECT id FROM rounds WHERE id=?').get(sourceId) as {id:string}|undefined;
 return round?{event,roundId:round.id,occurredAt,vars}:undefined;
}
/** Historic event text stays historic; occupancy is read afresh for each send attempt. */
export function currentQueueEventBody(db:AppDatabase,body:string,snapshot:QueueEventSnapshot):string{
 const round=db.prepare('SELECT display_number AS number,closed_at AS closed FROM rounds WHERE id=?').get(snapshot.roundId) as {number:number;closed:string|null}|undefined;
 const rows=db.prepare(`SELECT r.display_number AS number,r.status,(SELECT COUNT(*) FROM submissions s WHERE s.round_id=r.id) AS slots
   FROM rounds r WHERE r.closed_at IS NULL AND r.status IN ('OPEN','READY') ORDER BY r.display_number LIMIT 10`).all() as {number:number;status:string;slots:number}[];
 const when=new Date(snapshot.occurredAt).toLocaleString('pt-BR',{timeZone:'America/Bahia'});
 const title=snapshot.event==='UPLOAD_NOTICE'?'Registro do envio':'Registro de atualização da fila';
 // AUDITORIA / A MENSAGEM SE CONTRADIZIA NA TELA DO GRUPO.
 // Ela dizia "a fila deste registro ja foi encerrada" e, na linha seguinte, listava
 // "Fila 1: 4/10 - recebendo links". Parecia defeito, mas sao DUAS filas diferentes:
 // os numeros de exibicao sao reaproveitados quando uma fila fecha, entao a fila
 // encerrada e a fila nova podem carregar o mesmo rotulo. Dizer isso explicitamente
 // custa uma linha e evita que a comunidade leia o aviso como erro do sistema.
 const state=!round||round.closed
  ?'A fila deste aviso já foi encerrada. O número dela pode ter sido reaproveitado por uma fila nova — as abaixo são as que estão abertas agora.'
  :'A fila deste aviso agora aparece como Fila '+round.number+'.';
 const current=rows.map(r=>{const count=Math.max(0,Math.min(10,r.slots));return 'Fila '+r.number+': '+count+'/10 links '+('🟪'.repeat(count)+'⬜'.repeat(10-count))+' · '+(r.status==='READY'?'pronta':'recebendo links');}).join('\n');
 const footer='\n\n*Situação no momento deste envio*\n'+state+'\n\n*Filas abertas agora*\n'+(current||'Não há filas abertas neste momento.');
 return title+' · '+when+'\n'+body.slice(0,Math.max(0,4096-footer.length-title.length-when.length-5))+footer;
}
