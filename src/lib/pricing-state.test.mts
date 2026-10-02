import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, mock, test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { PricingScope, PriceResult, PricingFailure } from "@/lib/pricing";
import type { Product } from "@/lib/types";

mock.module("@/lib/data/mode", {namedExports:{getDataMode:()=>"supabase"}});
const requests: {scope:PricingScope;ids:string[];resolve:(data:PriceResult|PricingFailure|null)=>void}[]=[];
mock.module("@/lib/actions/pricing", {namedExports:{
  resolvePricesAction:(scope:PricingScope,ids:string[])=>new Promise<PriceResult|PricingFailure|null>(resolve=>requests.push({scope,ids,resolve})),
  quoteOrderAction:async()=>null,
}});
const require=createRequire(import.meta.url);
const {CartProvider,useCart}=require("@/lib/cart-context") as typeof import("@/lib/cart-context");
const {ShopDataProvider}=require("@/lib/shop-data-context") as typeof import("@/lib/shop-data-context");
const {useEffectivePrices}=require("@/lib/use-effective-prices") as typeof import("@/lib/use-effective-prices");
const product:Product={id:"p",sku:"P",categoryId:"c",manufacturerId:"",translations:{ar:{name:"منتج"},he:{name:"מוצר"},en:{name:"Product"}},packageType:"carton",unitsPerPackage:6,baseUnit:"bottles",wholesalePrice:10,availability:"inStock"};
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(fn=>fn());requests.length=0;dom.window.localStorage.clear();});
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,5));});}
async function until(fn:()=>boolean){for(let i=0;i<40&&!fn();i++)await flush();assert(fn(),"expected async pricing state");}
async function answer(index:number,price:string|null="7.25",status:PriceResult["prices"][number]["status"]="customer_agreement"){
  const r=requests[index];await act(async()=>r.resolve({mode:"active",prices:r.ids.map(product_id=>({product_id,status,price,vat:price===null?null:"0.18"}))}));
}
function mountCart(){
  let cart!:ReturnType<typeof useCart>;
  function Probe(){cart=useCart();return React.createElement("output",null,String(cart.priceOf("p")));}
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  // The provider's children prop is required in its TypeScript signature.
  // eslint-disable-next-line react/no-children-prop
  act(()=>root.render(React.createElement(ShopDataProvider,{products:[product],categories:[],manufacturers:[],customers:[],children:React.createElement(CartProvider,null,React.createElement(Probe))})));
  cleanups.push(()=>{act(()=>root.unmount());container.remove();});
  return {cart:()=>cart,container};
}
test("A→B→A invalidates immediately and ignores both older generations without changing basket/key",async()=>{
  const key=crypto.randomUUID();dom.window.localStorage.setItem("madaf.cart.v1",JSON.stringify({items:[{productId:"p",quantity:3}],customerId:"A",submissionKey:key}));
  const h=mountCart();await until(()=>requests.some(r=>"customerId" in r.scope&&r.scope.customerId==="A"));
  const firstA=requests.length-1;
  act(()=>h.cart().setCustomer("B"));assert.equal(h.cart().priceOf("p"),null);assert.equal(h.cart().subtotal,null);
  await until(()=>requests.length>firstA+1);const b=requests.length-1;
  act(()=>h.cart().setCustomer("A"));assert.equal(h.cart().priceOf("p"),null);
  await until(()=>requests.length>b+1);const lastA=requests.length-1;
  await answer(lastA);assert.equal(h.cart().priceOf("p"),7.25);
  await answer(firstA,"99.00");await answer(b,"88.00");assert.equal(h.cart().priceOf("p"),7.25);
  assert.deepEqual(h.cart().items,[{productId:"p",quantity:3}]);assert.equal(h.cart().submissionKey,key);
  assert.deepEqual(Object.keys(JSON.parse(dom.window.localStorage.getItem("madaf.cart.v1")!)).sort(),["customerId","items","submissionKey"]);
  assert.doesNotMatch(dom.window.localStorage.getItem("madaf.cart.v1")!,/7\.25|digest|agreement/);
});
test("denied restored customer stays distinct from unavailable and never falls back to catalog base",async()=>{
  dom.window.localStorage.setItem("madaf.cart.v1",JSON.stringify({items:[{productId:"p",quantity:1}],customerId:"foreign",submissionKey:null}));
  const h=mountCart();await until(()=>requests.some(r=>"customerId" in r.scope&&r.scope.customerId==="foreign"));
  await act(async()=>requests.at(-1)!.resolve({error:"denied"}));assert.equal(h.cart().priceOf("p"),null);assert.equal(h.cart().subtotal,null);assert.equal(h.cart().pricingReady,false);assert.equal(h.cart().pricingProblem,"denied");
  const count=requests.length;act(()=>h.cart().refreshPrices());await until(()=>requests.length>count);
  await act(async()=>requests.at(-1)!.resolve({error:"unavailable"}));assert.equal(h.cart().pricingProblem,"unavailable");assert.equal(h.cart().priceOf("p"),null);
});
test("stale package exposes no effective amount",async()=>{
  const h=mountCart();await until(()=>requests.length>0);await answer(requests.length-1,null,"stale_package");assert.equal(h.cart().priceOf("p"),null);assert.equal(h.cart().pricingProblem,"stale_package");
});
test("same-ID package/VAT/base changes synchronously invalidate pricing",async()=>{
  let state!:ReturnType<typeof useEffectivePrices>;
  function Probe({p}:{p:Product}){state=useEffectivePrices([p],{customerId:"A"});return null;}
  const container=document.createElement("div"),root=createRoot(container);cleanups.push(()=>act(()=>root.unmount()));
  act(()=>root.render(React.createElement(Probe,{p:product})));await until(()=>requests.length>0);await answer(0);assert.equal(state.priceOf("p"),7.25);
  act(()=>root.render(React.createElement(Probe,{p:{...product,wholesalePrice:11,vatRate:.1,unitsPerPackage:8}})));assert.equal(state.priceOf("p"),null);assert.equal(state.ready,false);
});
test("focus and reconnect invalidate the current price generation",async()=>{
  const h=mountCart();await until(()=>requests.length>0);await answer(requests.length-1);
  await until(()=>h.cart().priceOf("p")===7.25);assert.equal(h.cart().priceOf("p"),7.25);
  const requestCount=requests.length;
  act(()=>window.dispatchEvent(new dom.window.Event("focus")));assert.equal(h.cart().priceOf("p"),null);
  await until(()=>requests.length>requestCount);await answer(requests.length-1);
  await until(()=>h.cart().priceOf("p")===7.25);assert.equal(h.cart().priceOf("p"),7.25);
  act(()=>window.dispatchEvent(new dom.window.Event("online")));assert.equal(h.cart().priceOf("p"),null);
});
test("completion preserves a basket changed while the original submission was pending",()=>{
  const h=mountCart();act(()=>{h.cart().setCustomer("A");h.cart().addItem("p",1);});let key!:string;act(()=>{key=h.cart().ensureSubmissionKey();});
  act(()=>{h.cart().setCustomer("B");h.cart().setQuantity("p",4);});
  act(()=>h.cart().completeSubmission({customerId:"A",items:[{productId:"p",quantity:1}],submissionKey:key}));
  assert.equal(h.cart().customerId,"B");assert.equal(h.cart().quantityOf("p"),4);assert.equal(h.cart().submissionKey,null);
});
test("unavailable persistence blocks first authenticated submission-key preparation",()=>{
  const h=mountCart();const setter=mock.method(dom.window.Storage.prototype,"setItem",()=>{throw Error("blocked");});
  try{assert.throws(()=>h.cart().ensureSubmissionKey(),/blocked/);assert.equal(h.cart().submissionKey,null);}finally{setter.mock.restore();}
});
