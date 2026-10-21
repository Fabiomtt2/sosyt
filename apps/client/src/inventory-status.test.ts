import {describe,it,expect} from "vitest";
import {inventoryStatusChanges,type InventoryStatusSnapshot} from "./inventory-status";
const snapshot:InventoryStatusSnapshot={accountId:"synthetic-member",coins:10,passes:1,skips:2,administrative:false,superActive:false};
describe("confirmed inventory feedback",()=>{
 it("does not invent gains on first load, missing stock, or switching accounts",()=>{
  expect(inventoryStatusChanges(undefined,snapshot)).toEqual([]);
  expect(inventoryStatusChanges({...snapshot,coins:undefined,passes:undefined,skips:undefined},snapshot)).toEqual([]);
  expect(inventoryStatusChanges(snapshot,{...snapshot,accountId:"other",coins:99})).toEqual([]);
 });
 it("reports the exact confirmed purchase or consumption delta independently",()=>{
  expect(inventoryStatusChanges(snapshot,{...snapshot,coins:20,passes:3,skips:1})).toMatchObject([{kind:"coins",direction:"gain",label:"+10"},{kind:"pass",direction:"gain",label:"+2"},{kind:"skip",direction:"loss",label:"−1"}]);
  expect(inventoryStatusChanges(snapshot,{...snapshot})).toEqual([]);
 });
 it("preserves fractional coins without floating point false changes",()=>{
  expect(inventoryStatusChanges({...snapshot,coins:.3},{...snapshot,coins:.1+.2})).toEqual([]);
  expect(inventoryStatusChanges(snapshot,{...snapshot,coins:10.125})).toMatchObject([{label:"+0,125"}]);
 });
 it("administrative unlimited access never masquerades as a gift",()=>{
  expect(inventoryStatusChanges(snapshot,{...snapshot,administrative:true,passes:999999,skips:999999})).toEqual([]);
  expect(inventoryStatusChanges({...snapshot,administrative:true},{...snapshot,administrative:true,passes:999999,skips:999999})).toEqual([]);
 });
 it("shows activation and expiry only when the server status changes",()=>{
  expect(inventoryStatusChanges(snapshot,{...snapshot,superActive:true})).toMatchObject([{kind:"super",direction:"gain",label:"+SUPER"}]);
  expect(inventoryStatusChanges({...snapshot,superActive:true},snapshot)).toMatchObject([{kind:"super",direction:"loss",label:"−SUPER"}]);
  expect(inventoryStatusChanges({...snapshot,superActive:true,superExpiresAt:"2026-11-01T12:00:00Z"},{...snapshot,superActive:true,superExpiresAt:"2026-12-01T12:00:00Z"})).toMatchObject([{kind:"super",label:"+30 dias"}]);
 });
});
