import { describe, expect, it } from 'vitest';
import type { MemberDoc } from '@cmt/shared-domain/setu';
import { buildPledgeCustomerName } from '../pledge-customer-name';

function member(over: Partial<MemberDoc> & { mid: string }): MemberDoc {
  // Spread FIRST, then the defaults only fill what the caller omitted - the
  // other order lets `...over` silently overwrite the explicit keys.
  return {
    firstName: 'Vaibhav',
    lastName: 'Rana',
    ...over,
  } as MemberDoc;
}

const MEMBERS = [
  member({ mid: 'CMT-HTNO0TEG-01' }),
  member({ mid: 'CMT-HTNO0TEG-02', firstName: 'Jayshree', lastName: 'Rana' }),
];

describe('buildPledgeCustomerName', () => {
  it('names the signed-in PERSON and appends the public Family ID', () => {
    // The shape Vaibhav asked for after seeing "Rana family" on the live Customer.
    expect(
      buildPledgeCustomerName({
        members: MEMBERS,
        mid: 'CMT-HTNO0TEG-01',
        publicFid: 5001,
        familyName: 'Rana family',
      }),
    ).toBe('Vaibhav Rana (5001)');
  });

  it('picks the member matching the session mid, not simply the first', () => {
    // The N=2 case: a family has several members and the manager is not always [0].
    expect(
      buildPledgeCustomerName({
        members: MEMBERS,
        mid: 'CMT-HTNO0TEG-02',
        publicFid: 5001,
        familyName: 'Rana family',
      }),
    ).toBe('Jayshree Rana (5001)');
  });

  it('omits the suffix entirely when publicFid is null - never "(null)" or "()"', () => {
    expect(
      buildPledgeCustomerName({
        members: MEMBERS,
        mid: 'CMT-HTNO0TEG-01',
        publicFid: null,
        familyName: 'Rana family',
      }),
    ).toBe('Vaibhav Rana');
  });

  it('accepts a string publicFid', () => {
    expect(
      buildPledgeCustomerName({ members: MEMBERS, mid: 'CMT-HTNO0TEG-01', publicFid: '5001', familyName: 'Rana family' }),
    ).toBe('Vaibhav Rana (5001)');
  });

  it('falls back to the family name when the mid matches no member', () => {
    expect(
      buildPledgeCustomerName({ members: MEMBERS, mid: 'CMT-NOPE-99', publicFid: 5001, familyName: 'Rana family' }),
    ).toBe('Rana family (5001)');
  });

  it('falls back to the family name when the member has no usable name', () => {
    expect(
      buildPledgeCustomerName({
        members: [member({ mid: 'm1', firstName: '  ', lastName: '' })],
        mid: 'm1',
        publicFid: 5001,
        familyName: 'Rana family',
      }),
    ).toBe('Rana family (5001)');
  });

  it('uses whichever name part exists', () => {
    expect(
      buildPledgeCustomerName({
        members: [member({ mid: 'm1', firstName: 'Vaibhav', lastName: '   ' })],
        mid: 'm1',
        publicFid: null,
        familyName: 'Rana family',
      }),
    ).toBe('Vaibhav');
  });

  it('is NEVER empty - the payment service rejects a blank name', () => {
    // Every branch exhausted: no member, no family name, no id.
    expect(
      buildPledgeCustomerName({ members: [], mid: null, publicFid: null, familyName: '   ' }),
    ).toBe('Chinmaya Mission family');
  });

  it('trims a padded name rather than passing the padding to Stripe', () => {
    expect(
      buildPledgeCustomerName({
        members: [member({ mid: 'm1', firstName: '  Vaibhav ', lastName: ' Rana  ' })],
        mid: 'm1',
        publicFid: 5001,
        familyName: 'Rana family',
      }),
    ).toBe('Vaibhav Rana (5001)');
  });
});
