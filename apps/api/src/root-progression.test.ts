import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "./db.js";
import { boosterView, claimBooster, gamificationProgress, gamificationView, leaderboards, recordVerifiedXp, redeemRewardItem } from "./gamification.js";
import { gamificationData } from "./gamification-view.js";
import { presentationOf } from "./presentation.js";

describe("Root Owner: acesso ilimitado sem progressão competitiva", () => {
  let db: AppDatabase, round: string;
  const user = "root-progression-fixture";
  const root = () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('root-progression',?,'root-progression-phone','root','ROOT_OWNER',1,?,?)").run(user, now, now);
  };
  const coverage = (index = 0) => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO submissions(id,round_id,slot,user_id,youtube_url,video_id,created_at,video_duration_seconds) VALUES(?,?,?,?,?,?,?,100)")
      .run(randomUUID(), round, index + 1, user, "https://youtu.be/abcdefghijk", "root-video-" + index, now);
    db.prepare("INSERT INTO playlist_watch_progress(round_id,user_id,watched_seconds_json,durations_json,percent,observed_intervals_json,updated_at) VALUES(?,?,'[]','[]',100,?,?) ON CONFLICT(round_id,user_id) DO UPDATE SET observed_intervals_json=excluded.observed_intervals_json")
      .run(round, user, JSON.stringify({ [index]: [[0, 100]] }), now);
    return recordVerifiedXp(db, user, round, index);
  };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T15:00:00Z"));
    db = createDatabase(":memory:"); round = (db.prepare("SELECT id FROM rounds LIMIT 1").get() as { id: string }).id;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,name,phone,group_code,created_at,updated_at) VALUES(?,'Root','5571999000051','1',?,?)").run(user, now, now);
    db.prepare("INSERT INTO wallets(user_id,updated_at) VALUES(?,?)").run(user, now);
  });
  afterEach(() => { db.close(); vi.useRealTimers(); });

  it("nem cobertura real criaXP, nível, moedas ou evento de recompensa para Root", () => {
    root(); expect(coverage()).toEqual({ xpDelta: 0, levelRewards: [] });
    expect(db.prepare("SELECT COUNT(*) AS n FROM gamification_events").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM gamification_users").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM gamification_bot_events").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT reward_millis AS n FROM wallets WHERE user_id=?").get(user)).toEqual({ n: 0 });
    expect(leaderboards(db).monthly).toEqual([]); expect(leaderboards(db).permanent).toEqual([]);
  });

  it("JSON representa acesso∞ por flags e null; chat/filas não recebem nível nem emblema", () => {
    root();
    expect(gamificationProgress(db, user)).toEqual({ administrative: true, unlimitedXp: true, xp: null, level: null, nextLevelXp: null, levelStartXp: null });
    const data = gamificationData(db, user);
    expect(data.progress).toBeNull(); expect(data.administrative).toBe(true); expect(data.unlimitedXp).toBe(true);
    expect(JSON.parse(JSON.stringify(data)).progress).toBeNull();
    expect(presentationOf(db, user)).toMatchObject({ badge: "ADMIN", administrative: true, unlimitedXp: true, progress: undefined });
  });

  it("Root não recebe Booster nem gasta recompensas para obter itens já ilimitados", () => {
    root();
    expect(boosterView(db, user).available).toBe(false);
    expect(() => claimBooster(db, user)).toThrow(/administrativa/);
    db.prepare("UPDATE wallets SET reward_millis=500000 WHERE user_id=?").run(user);
    expect(() => redeemRewardItem(db, user, "PASS", randomUUID())).toThrow(/administrativa/);
    expect(db.prepare("SELECT reward_millis AS n FROM wallets WHERE user_id=?").get(user)).toEqual({ n: 500000 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM gamification_booster_claims").get()).toEqual({ n: 0 });
  });

  it("promover a Root preserva o histórico anterior e elimina a competição imediatamente", () => {
    expect(coverage().xpDelta).toBe(100); expect(gamificationView(db, user).level).toBe(2);
    const events = db.prepare("SELECT * FROM gamification_events ORDER BY rowid").all();
    const balance = db.prepare("SELECT reward_millis AS n FROM wallets WHERE user_id=?").get(user);
    expect(leaderboards(db).monthly).toHaveLength(1);
    root(); expect(coverage(1)).toEqual({ xpDelta: 0, levelRewards: [] });
    expect(db.prepare("SELECT * FROM gamification_events ORDER BY rowid").all()).toEqual(events);
    expect(db.prepare("SELECT reward_millis AS n FROM wallets WHERE user_id=?").get(user)).toEqual(balance);
    expect(leaderboards(db).monthly).toEqual([]); expect(leaderboards(db).permanent).toEqual([]);
    expect(gamificationData(db, user).progress).toBeNull();
  });

  it("Admin adicional continua com nível e o mesmo motor deXP comum", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO owner_access(id,user_id,phone,normalized_name,role,active,created_at,updated_at) VALUES('admin-progression',?,'admin-progression-phone','admin','ADMIN_OWNER',1,?,?)").run(user, now, now);
    expect(coverage().xpDelta).toBe(100);
    expect(gamificationData(db, user).progress?.level).toBe(2);
    expect(presentationOf(db, user).progress?.level).toBe(2);
  });
});
