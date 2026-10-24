// PROPOSAL ONLY: copy to src only after social/coin schemas and block filters are integrated.
// Keep the existing /gamification/gift-coins route; replace its helper there, do not register twice.
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { awardContributionXp } from "./gamification.js";
import { z } from "zod";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";
import {
  directConversationRequests, requestDirectConversation, respondDirectConversation, socialOverview, socialProfile, findFriendByPhone, requestFriendship, respondFriendship,
  blockSocialUser, unblockSocialUser, saveSocialPreferences, communityUnreadCount,
  listCommunityNotifications, markCommunityNotificationsRead, adminCommunityOverview,
  saveCommunityConfig, adminRevokeFriendship, communityConfigSchema
} from "./social.js";
import { transferableCoins, adminCoinTransfers } from "./coin-transfers.js";

type Guards = {authGuard:preHandlerHookHandler;rootOwnerGuard:preHandlerHookHandler};
const userIdParam = z.object({id:z.string().uuid()});
export function registerCommunityRoutes(app:FastifyInstance,db:AppDatabase,config:Config,guards:Guards):void {
  const participant={preHandler:guards.authGuard};
  const root={preHandler:guards.rootOwnerGuard};
  app.get("/social/message-requests",participant,async(request)=>({requests:directConversationRequests(db,request.user.sub)}));
  app.post("/social/message-requests",{...participant,config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request)=>{
    const {targetUserId}=z.object({targetUserId:z.string().uuid()}).parse(request.body);
    return requestDirectConversation(db,request.user.sub,targetUserId);
  });
  app.post("/social/message-requests/:id",participant,async(request)=>{
    const {id}=userIdParam.parse(request.params);
    const {accept}=z.object({accept:z.boolean()}).parse(request.body);
    return respondDirectConversation(db,request.user.sub,id,accept);
  });
  app.get("/social",participant,async(request)=>({
    ...socialOverview(db,request.user.sub),transferableCoins:transferableCoins(db,request.user.sub)
  }));
  app.post("/social/find",{...participant,config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async(request)=>{
    const body=z.object({phone:z.string().trim().min(8).max(40)}).parse(request.body);
    return findFriendByPhone(db,request.user.sub,body.phone);
  });
  app.get("/social/profile/:id",participant,async(request)=>{
    const {id}=userIdParam.parse(request.params);
    return socialProfile(db,request.user.sub,id);
  });
  app.post("/social/requests",{...participant,config:{rateLimit:{max:20,timeWindow:"10 minutes"}}},async(request)=>{
    const body=z.object({targetUserId:z.string().uuid(),referenceId:z.string().uuid()}).parse(request.body);
    return requestFriendship(db,request.user.sub,body.targetUserId,body.referenceId);
  });
  app.post("/social/requests/:id",{...participant,config:{rateLimit:{max:60,timeWindow:"10 minutes"}}},async(request)=>{
    const {id}=userIdParam.parse(request.params);
    const {action}=z.object({action:z.enum(["ACCEPT","DECLINE","CANCEL","REMOVE"])}).parse(request.body);
    const resultado=respondFriendship(db,request.user.sub,id,action);
    // AUDITORIA / XP por CONECTAR. Vale para os dois lados: quem convidou e quem
    // aceitou construiram o vinculo juntos. So no ACCEPT — convite pendente, recusado
    // ou removido nao e contribuicao. Idempotente pelo id do convite.
    if(action==="ACCEPT"){
      const par=db.prepare("SELECT sender_id AS senderId,recipient_id AS recipientId FROM friendships WHERE id=?").get(id) as {senderId:string;recipientId:string}|undefined;
      for(const quem of [par?.senderId,par?.recipientId]) if(quem) {
        try { awardContributionXp(db,quem,"FRIEND",id,{amizade:id}); }
        catch(error) { app.log.error(error,"Friendship XP failed"); }
      }
    }
    return resultado;
  });
  app.put("/social/blocks/:id",participant,async(request)=>{
    const {id}=userIdParam.parse(request.params);
    const {blocked}=z.object({blocked:z.boolean()}).parse(request.body);
    return blocked?blockSocialUser(db,request.user.sub,id):unblockSocialUser(db,request.user.sub,id);
  });
  app.put("/social/preferences",participant,async(request)=>
    saveSocialPreferences(db,request.user.sub,z.object({acceptFriendRequests:z.boolean()}).parse(request.body)));
  app.get("/social/unread",participant,async(request)=>({unread:communityUnreadCount(db,request.user.sub)}));
  app.get("/social/notifications",participant,async(request)=>listCommunityNotifications(db,request.user.sub));
  app.post("/social/notifications/read",participant,async(request)=>{
    const {ids}=z.object({ids:z.array(z.string().uuid()).max(100)}).parse(request.body);
    return markCommunityNotificationsRead(db,request.user.sub,ids);
  });
  app.get("/admin/community",root,async(request)=>({
    ...adminCommunityOverview(db,request.user.sub,config),
    coinTransfers:adminCoinTransfers(db,request.user.sub,100,config)
  }));
  app.put("/admin/community",root,async(request)=>({
    config:saveCommunityConfig(db,communityConfigSchema.parse(request.body),request.user.sub,config)
  }));
  app.post("/admin/community/relationships/:id/revoke",root,async(request)=>{
    const {id}=userIdParam.parse(request.params);
    const {reason}=z.object({reason:z.string().trim().min(5).max(240)}).parse(request.body);
    return adminRevokeFriendship(db,request.user.sub,id,reason,config);
  });
}
