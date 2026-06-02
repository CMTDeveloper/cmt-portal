import { describe, it, expect } from 'vitest';
import {
  CreateCalendarEntrySchema,
  UpdateCalendarEntrySchema,
  ClassCalendarEntryDocSchema,
  SetWeeklyScheduleSchema,
  calendarEntryId,
} from '../schemas/class-calendar';

describe('calendarEntryId', () => {
  it('builds {programKey}-{location}-{date}', () => {
    expect(calendarEntryId('bala-vihar', 'Brampton', '2025-09-07')).toBe('bala-vihar-brampton-2025-09-07');
    expect(calendarEntryId('tabla', 'Scarborough', '2026-03-15')).toBe('tabla-scarborough-2026-03-15');
  });

  it('lets two programs share a location+date without colliding', () => {
    expect(calendarEntryId('bala-vihar', 'Brampton', '2026-11-15')).not.toBe(
      calendarEntryId('tabla', 'Brampton', '2026-11-15'),
    );
  });
});

describe('CreateCalendarEntrySchema', () => {
  const classDay = { location: 'Brampton' as const, date: '2025-09-07', kind: 'class' as const, classType: 'first' as const };
  const noClassDay = { location: 'Brampton' as const, date: '2025-10-12', kind: 'no-class' as const, noClassReason: 'Thanksgiving Weekend' };

  it('accepts a class day with a classType', () => {
    expect(CreateCalendarEntrySchema.safeParse(classDay).success).toBe(true);
  });
  it('accepts a no-class day with a reason', () => {
    expect(CreateCalendarEntrySchema.safeParse(noClassDay).success).toBe(true);
  });
  it('accepts a no-class day with special events but no classType', () => {
    expect(CreateCalendarEntrySchema.safeParse({ ...noClassDay, specialEvents: 'BV Graduation' }).success).toBe(true);
  });
  it('rejects a class day without a classType', () => {
    expect(CreateCalendarEntrySchema.safeParse({ location: 'Brampton', date: '2025-09-07', kind: 'class' }).success).toBe(false);
  });
  it('rejects a no-class day that also sets a classType', () => {
    expect(CreateCalendarEntrySchema.safeParse({ ...noClassDay, classType: 'regular' }).success).toBe(false);
  });
  it('rejects a bad date format', () => {
    expect(CreateCalendarEntrySchema.safeParse({ ...classDay, date: 'Sep 7' }).success).toBe(false);
  });
  it('rejects an unknown classType', () => {
    expect(CreateCalendarEntrySchema.safeParse({ ...classDay, classType: 'makeup' }).success).toBe(false);
  });
  it('defaults enabled to true and programKey to bala-vihar', () => {
    const r = CreateCalendarEntrySchema.safeParse(classDay);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.enabled).toBe(true);
      expect(r.data.programKey).toBe('bala-vihar');
    }
  });
});

describe('UpdateCalendarEntrySchema', () => {
  it('accepts an empty patch', () => {
    expect(UpdateCalendarEntrySchema.safeParse({}).success).toBe(true);
  });
  it('accepts toggling enabled only', () => {
    expect(UpdateCalendarEntrySchema.safeParse({ enabled: false }).success).toBe(true);
  });
  it('accepts switching to no-class with a reason and null classType', () => {
    expect(UpdateCalendarEntrySchema.safeParse({ kind: 'no-class', classType: null, noClassReason: 'Winter Break' }).success).toBe(true);
  });
  it('rejects switching to class without a classType in the same patch', () => {
    expect(UpdateCalendarEntrySchema.safeParse({ kind: 'class', classType: null }).success).toBe(false);
  });
});

describe('ClassCalendarEntryDocSchema', () => {
  const valid = {
    entryId: 'brampton-2025-09-07',
    programKey: 'bala-vihar' as const,
    location: 'Brampton' as const,
    date: '2025-09-07',
    kind: 'class' as const,
    classType: 'first' as const,
    noClassReason: null,
    specialEvents: null,
    enabled: true,
    createdAt: new Date(),
    createdBy: 'uid-admin',
    updatedAt: new Date(),
    updatedBy: 'uid-admin',
  };
  it('accepts a valid entry doc', () => {
    expect(ClassCalendarEntryDocSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects a missing entryId', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { entryId, ...rest } = valid;
    expect(ClassCalendarEntryDocSchema.safeParse(rest).success).toBe(false);
  });
});

describe('SetWeeklyScheduleSchema', () => {
  it('accepts rows of time + label', () => {
    expect(
      SetWeeklyScheduleSchema.safeParse({
        location: 'Brampton',
        rows: [{ time: '10:00–10:45 am', label: 'Assembly' }, { time: '10:30–12:00', label: 'Classes' }],
      }).success,
    ).toBe(true);
  });
  it('accepts an empty rows array', () => {
    expect(SetWeeklyScheduleSchema.safeParse({ location: 'Brampton', rows: [] }).success).toBe(true);
  });
  it('rejects a row missing a label', () => {
    expect(SetWeeklyScheduleSchema.safeParse({ location: 'Brampton', rows: [{ time: '10:00' }] }).success).toBe(false);
  });
});
