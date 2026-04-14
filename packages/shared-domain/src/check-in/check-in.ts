export type CheckedInBy = 'sevak' | 'family' | 'teacher' | 'guest';
export type CheckInStatus = 'present' | 'absent';

export interface CheckInEvent {
  checkInId: string;
  fid: string;
  sid: string;
  status: CheckInStatus;
  checkedInBy: CheckedInBy;
  checkedInAt: string;
  recordedByUid?: string;
}

export interface CheckInHistoryEntry {
  checkInId: string;
  sid: string;
  firstName: string;
  lastName: string;
  status: CheckInStatus;
  checkedInAt: string;
  checkedInBy: CheckedInBy;
}
