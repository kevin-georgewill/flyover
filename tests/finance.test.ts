import { describe, expect, it } from 'vitest';
function commission(type:'PERCENTAGE'|'FIXED', value:number, gross:number) { return Number((type==='PERCENTAGE'?gross*value/100:value).toFixed(2)); }
describe('commission calculation examples',()=>{
  it('calculates percentage commission',()=>expect(commission('PERCENTAGE',10,50000)).toBe(5000));
  it('calculates fixed commission',()=>expect(commission('FIXED',2500,50000)).toBe(2500));
  it('rounds to two decimal places',()=>expect(commission('PERCENTAGE',7.5,123.45)).toBe(9.26));
});
