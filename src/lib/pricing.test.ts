import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePriceBatches, validAgreementPrice, validQuote, type PriceResult } from "./pricing";

for (const value of ["0.01", "7.25", "9999999.00"]) test(`accept exact positive price ${value}`, () => assert.equal(validAgreementPrice(value), true));
for (const value of [null, undefined, 5, "", " ", "0", "-1", "1e2", "NaN", "Infinity", "1.001", "10000000"]) test(`reject invalid override ${String(value)}`, () => assert.equal(validAgreementPrice(value), false));
test("quote envelope accepts only supported exact keys", () => {
  assert(validQuote({version:1,digest:"a".repeat(64)}));
  assert(validQuote({mode:"replay_only"}));
  for(const q of [{version:2,digest:"a".repeat(64)},{version:1,digest:"A".repeat(64)},{version:1,digest:"a".repeat(64),total:1},{mode:"replay_only",digest:"a".repeat(64)},null]) assert.equal(validQuote(q),false);
});
const result = (ids: string[]): PriceResult => ({mode:"active",prices:ids.map(product_id=>({product_id,status:"customer_agreement",price:"7.25",vat:"0.18"}))});
test("401 candidates resolve in bounded batches, two in flight, without partial completion", async () => {
  const ids=Array.from({length:401},(_,i)=>String(i)); const batches:string[][]=[]; let active=0,max=0;
  const data=await resolvePriceBatches(ids,async batch=>{batches.push(batch);max=Math.max(max,++active);await new Promise(r=>setTimeout(r,2));active--;return result(batch);});
  assert.deepEqual(batches.map(b=>b.length),[200,200,1]);assert.equal(max,2);assert.equal(data.prices.length,401);
});
test("missing, duplicated, foreign and inconsistent batch responses fail closed", async () => {
  for(const response of [result([]),result(["a","a"]),result(["a","foreign"])]) await assert.rejects(resolvePriceBatches(["a","b"],async()=>response));
  let n=0;await assert.rejects(resolvePriceBatches(Array.from({length:201},(_,i)=>String(i)),async ids=>({...result(ids),mode:++n===1?"active":"disabled"})));
});
test("empty catalog still validates customer/state; failure never yields base",async()=>{
  let called=false;await assert.rejects(resolvePriceBatches([],async()=>{called=true;throw Error("denied");}));assert(called);
});

test("invalid or missing monetary strings never become a zero effective price",async()=>{
  for(const price of [null,"NaN","Infinity","1e2","-1.00","1.001","10000000.00"]){
    const data=result(["a"]);data.prices[0].price=price;
    await assert.rejects(resolvePriceBatches(["a"],async()=>data));
  }
});
