const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizeGeo, hasUsableGeoTarget, assertGeoMatches} = require('../src/helpers/metaGeoTargeting');
test('city, state and PIN keys survive without conversion to a point', () => {
  const geo=normalizeGeo({cities:[{key:'1019761'}],regions:[{key:'1753'}],zips:[{key:'IN:462023'}]});
  assert.deepEqual(geo,{cities:[{key:'1019761',radius:0,distance_unit:'kilometer'}],regions:[{key:'1753'}],zips:[{key:'IN:462023'}]});
  assert.ok(hasUsableGeoTarget(geo));assert.equal(geo.custom_locations,undefined);
});
test('pin retains full precision and explicit km; stale address cannot override it',()=>{
  const geo=normalizeGeo({coordinates:[{address:'Wrong city label',latitude:23.25991234,longitude:77.41261234,radius:3.5}]});
  assert.deepEqual(geo.custom_locations,[{latitude:23.25991234,longitude:77.41261234,radius:3.5,distance_unit:'kilometer'}]);
});
test('invalid radius/coordinates reject, never guess units or silently widen',()=>{
  for(const invalid of [{radius:0},{radius:5000},{radius:undefined},{radius:5,distance_unit:'meter'},{latitude:91},{longitude:-181},{latitude:null},{latitude:true},{radius:''}]) {
    assert.throws(()=>normalizeGeo({coordinates:[{latitude:23,longitude:77,radius:5,...invalid}]}));
  }
  assert.throws(()=>normalizeGeo({coordinates:[{latitude:23,longitude:77,radius:5},{latitude:'bad',longitude:77,radius:5}]}));
});
test('country-wide and local targets cannot accidentally combine',()=>{
  assert.deepEqual(normalizeGeo({countries:['in']}),{countries:['IN']});
  assert.throws(()=>normalizeGeo({countries:['IN'],cities:[{key:'1019761'}]}));
  assert.throws(()=>normalizeGeo({cities:[{key:'1019761',radius:20}]}));
  assert.throws(()=>normalizeGeo({regions:[{key:'1753',radius:10}]}));
  assert.throws(()=>normalizeGeo({}));assert.throws(()=>normalizeGeo({countries:['India']}));
});
test('Meta readback accepts identical keys/coordinates, not broader targeting',()=>{
  const geo=normalizeGeo({cities:[{key:'1019761'}],custom_locations:[{latitude:23.25,longitude:77.41,radius:5,distance_unit:'kilometer'}]});
  assert.doesNotThrow(()=>assertGeoMatches(geo,{...geo,cities:[{key:'1019761',name:'Bhopal',radius:0}],location_types:['home','recent']}));
  for(const actual of [{...geo,countries:['IN']},{...geo,cities:[{key:'1019761',radius:20}]},{...geo,cities:[{key:'wrong'}]},{...geo,custom_locations:[{latitude:23.25,longitude:77.41,radius:20}]},{...geo,location_expansion:{enabled:true}},{...geo,neighborhoods:[{key:'other'}]}]) assert.throws(()=>assertGeoMatches(geo,actual));
});
test('saved Meta targeting mismatch blocks every activation write',async()=>{
  const {deliverCampaign}=require('../src/services/adApprovalService');
  const calls=[];
  const campaign={_id:'c',approvalStatus:'APPROVED',paymentStatus:'APPROVED',submissionPageId:'p',mainAdId:'ad',facebookAdSetId:'set',externalCampiagnId:'e',location:normalizeGeo({cities:[{key:'1019761'}]})};
  const deps={api:{get:async()=>({data:{targeting:{geo_locations:{countries:['IN']}}}}),post:async()=>calls.push('ACTIVE')},models:{Business:{findById:()=>({lean:async()=>({pageId:'p'})})},External:{findById:async()=>({meta_CampaignId:'campaign'})},Campaign:{updateOne:async()=>calls.push('saved')}}};
  await assert.rejects(deliverCampaign(campaign,deps),/mismatch/);assert.deepEqual(calls,[]);
});
