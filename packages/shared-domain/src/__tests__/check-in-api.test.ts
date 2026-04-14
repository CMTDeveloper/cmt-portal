import { describe, it, expect } from 'vitest';
import type {
  SendCodeRequest,
  VerifyCodeResponseWeb,
  VerifyCodeResponseMobile,
  FamilySelfCheckInRequest,
} from '../check-in/api';

describe('API types', () => {
  it('SendCodeRequest shape', () => {
    const req: SendCodeRequest = { type: 'email', value: 'a@b.com' };
    expect(req.type).toBe('email');
  });

  it('VerifyCodeResponseWeb includes redirectTo', () => {
    const res: VerifyCodeResponseWeb = { redirectTo: '/check-in/family' };
    expect(res.redirectTo).toBe('/check-in/family');
  });

  it('VerifyCodeResponseMobile includes customToken', () => {
    const res: VerifyCodeResponseMobile = { customToken: 'ct' };
    expect(res.customToken).toBe('ct');
  });

  it('FamilySelfCheckInRequest has students map', () => {
    const req: FamilySelfCheckInRequest = { students: { '1': true, '2': false } };
    expect(Object.keys(req.students)).toHaveLength(2);
  });
});
